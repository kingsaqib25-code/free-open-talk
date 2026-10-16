import { OAuth2Client, TokenPayload as GoogleTokenPayload } from 'google-auth-library';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';
import { AppError } from '../utils/app-error.js';
import { generateTokenPair, TokenPayload } from '../utils/JWT.js';
import { SessionCache, UserCache } from './cache.service.js';
import { CACHE_TTL } from '../db/redis.js';
import { config } from '../config/env.js';

// Google OAuth client
const googleClient = new OAuth2Client(config.google.clientId);


// Google user info structure from userinfo endpoint

interface GoogleUserInfo {
    sub: string;
    email: string;
    email_verified: boolean;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    locale?: string;
}

// Verify Google ID token and extract payload

export async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload> {
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: config.google.clientId,
        });

        const payload = ticket.getPayload();
        if (!payload) {
            throw new AppError('Invalid Google token payload', 401);
        }

        return payload;
    } catch (error) {
        console.error('Google token verification error:', error);
        throw new AppError('Failed to verify Google token', 401);
    }
}


// Verify Google access token by fetching user info
export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleUserInfo> {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            throw new AppError('Invalid Google access token', 401);
        }

        const userInfo = await response.json() as GoogleUserInfo;

        if (!userInfo.email || !userInfo.sub) {
            throw new AppError('Invalid user info from Google', 401);
        }

        return userInfo;
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error('Google access token verification error:', error);
        throw new AppError('Failed to verify Google access token', 401);
    }
}


// Generate a unique username from Google email
// Handles collisions by appending random numbers 
async function generateUniqueUsername(email: string): Promise<string> {
    const baseUsername = email
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 20);

    let username = baseUsername || 'user';
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
        const existing = await db.query.users.findFirst({
            where: eq(users.username, username)
        });

        if (!existing) {
            return username;
        }

        // Add random suffix for collision handling
        const suffix = Math.floor(Math.random() * 9999);
        username = `${baseUsername.slice(0, 15)}_${suffix}`;
        attempts++;
    }

    // Fallback to timestamp-based username
    return `user_${Date.now()}`;
}

// Unified Google payload interface
interface UnifiedGooglePayload {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
    given_name?: string;
    picture?: string;
}

// Handle Google OAuth sign-in/sign-up
// Supports both ID token and access token flows 
export async function googleAuthService(idToken?: string, accessToken?: string) {
    let googlePayload: UnifiedGooglePayload;

    // Verify token - prefer ID token if both provided
    if (idToken) {
        const tokenPayload = await verifyGoogleToken(idToken);
        if (!tokenPayload.email || !tokenPayload.sub) {
            throw new AppError('Invalid Google token - missing required fields', 401);
        }
        googlePayload = {
            sub: tokenPayload.sub,
            email: tokenPayload.email,
            email_verified: tokenPayload.email_verified,
            name: tokenPayload.name,
            given_name: tokenPayload.given_name,
            picture: tokenPayload.picture,
        };
    } else if (accessToken) {
        googlePayload = await verifyGoogleAccessToken(accessToken);
    } else {
        throw new AppError('Google ID token or access token is required', 400);
    }

    if (!googlePayload.email) {
        throw new AppError('Email not provided by Google', 400);
    }

    if (!googlePayload.email_verified) {
        throw new AppError('Please verify your email with Google first', 400);
    }

    // Check if user exists by googleId or email
    let user = await db.query.users.findFirst({
        where: or(
            eq(users.googleId, googlePayload.sub),
            eq(users.email, googlePayload.email)
        )
    });

    const isFirstTime = !user;
    let needsUsername = false;

    if (!user) {
        // Create new user from Google data
        const username = await generateUniqueUsername(googlePayload.email);

        const [newUser] = await db
            .insert(users)
            .values({
                email: googlePayload.email,
                username,
                googleId: googlePayload.sub,
                googleEmail: googlePayload.email,
                displayName: googlePayload.name || googlePayload.given_name || null,
                avatarUrl: googlePayload.picture || null,
                googlePictureUrl: googlePayload.picture || null,
                authProvider: 'google',
                lastLoginProvider: 'google',
                emailVerified: true,
                passwordHash: null, // OAuth-only user has no password
            })
            .returning();

        user = newUser!;
        needsUsername = true; // New users should set their preferred username
    } else {
        // User exists - link Google account if not already linked
        const updateData: Record<string, unknown> = {
            lastLoginProvider: 'google',
            updatedAt: new Date(),
        };

        // Link Google account if not already linked
        if (!user.googleId) {
            updateData.googleId = googlePayload.sub;
            updateData.googleEmail = googlePayload.email;
            updateData.googlePictureUrl = googlePayload.picture || null;
            updateData.emailVerified = true;
            // Update auth provider based on existing state
            updateData.authProvider = user.passwordHash ? 'google+email' : 'google';
        }

        // Update avatar if user doesn't have one
        if (!user.avatarUrl && googlePayload.picture) {
            updateData.avatarUrl = googlePayload.picture;
        }

        // Update display name if user doesn't have one
        if (!user.displayName && (googlePayload.name || googlePayload.given_name)) {
            updateData.displayName = googlePayload.name || googlePayload.given_name;
        }

        await db
            .update(users)
            .set(updateData)
            .where(eq(users.id, user.id));

        // Refetch to get updated data
        user = (await db.query.users.findFirst({
            where: eq(users.id, user.id)
        }))!;
    }

    // Generate JWT tokens (same as regular auth)
    const tokenPayload: TokenPayload = {
        userId: String(user.id),
        email: user.email,
        username: user.username
    };

    const tokens = generateTokenPair(tokenPayload);

    // Store refresh token in Redis (convert UUID to string)
    await SessionCache.storeRefreshToken(String(user.id), tokens.refreshToken, CACHE_TTL.SESSION);

    // Update online status
    await db.update(users)
        .set({ isOnline: true })
        .where(eq(users.id, user.id));

    // Set online in Redis (convert UUID to string)
    await UserCache.setOnline(String(user.id));

    return {
        user: {
            id: user.id,
            email: user.email,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            authProvider: user.authProvider,
        },
        tokens: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        },
        isFirstTime,
        needsUsername,
    };
}


// Check if a user can set a password (OAuth-only users)
export async function canSetPassword(userId: string): Promise<boolean> {
    const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
    });

    if (!user) {
        throw new AppError('User not found', 404);
    }

    // User can set password if they don't have one (OAuth-only)
    return !user.passwordHash;
}


// Link email/password to existing OAuth account 
export async function linkEmailPassword(userId: string, passwordHash: string) {
    const user = await db.query.users.findFirst({
        where: eq(users.id, userId)
    });

    if (!user) {
        throw new AppError('User not found', 404);
    }

    if (user.passwordHash) {
        throw new AppError('Password already set', 400);
    }

    await db
        .update(users)
        .set({
            passwordHash,
            authProvider: user.googleId ? 'google+email' : 'email',
            updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
}
