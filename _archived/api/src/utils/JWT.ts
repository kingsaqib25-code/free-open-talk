import jwt, { type SignOptions, type Secret } from 'jsonwebtoken';
import { config } from '../config/env';
import { AppError } from './app-error';


export interface TokenPayload {
    userId: string;
    email: string;
    username: string;
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

// Generate access token (short-lived: 15 min)
export const generateAccessToken = (payload: TokenPayload): string => {
    const options: SignOptions = {
        expiresIn: '15m',
        issuer: 'free2talk'
    };
    return jwt.sign(payload, config.jwtSecret as Secret, options);
};
// Generate refresh token (long-lived: 7 days)
export const generateRefreshToken = (payload: TokenPayload): string => {
    const options: SignOptions = {
        expiresIn: '7d',
        issuer: 'free2talk'
    };
    return jwt.sign(payload, config.jwtSecret as Secret, options);
};

// Generate both tokens
export const generateTokenPair = (payload: TokenPayload): TokenPair => {
    return {
        accessToken: generateAccessToken(payload),
        refreshToken: generateRefreshToken(payload)
    };
};

// Verify access token
export const verifyAccessToken = (token: string): TokenPayload => {
    try {
        return jwt.verify(token, config.jwtSecret) as TokenPayload;
    } catch (error) {
        console.error('Access Token Verification Error:', error);
        // Re-throw the original error to preserve the error type (TokenExpiredError, JsonWebTokenError, etc.)
        throw error;
    }
};

// Verify refresh token
export const verifyRefreshToken = (token: string): TokenPayload => {
    try {
        return jwt.verify(token, config.jwtSecret) as TokenPayload;
    } catch (error) {
        console.error('Refresh Token Verification Error:', error);
        // Re-throw the original error to preserve the error type
        throw error;
    }
};