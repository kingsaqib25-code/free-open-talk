import { pgTable, uuid, varchar, text, boolean, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const roomParticipantRole = pgEnum('room_participant_role', ['owner', 'participant']);

// Auth provider enum
export const authProviderEnum = pgEnum('auth_provider', ['email', 'google', 'google+email']);

// Users Table
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    username: varchar('username', { length: 50 }).unique().notNull(),
    displayName: varchar('display_name', { length: 100 }),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'), // Nullable for OAuth-only users
    bio: text('bio'),
    nativeLanguages: text('native_languages').array().default([]),
    learningLanguages: text('learning_languages').array().default([]),
    isOnline: boolean('is_online').default(false),
    lastSeenAt: timestamp('last_seen_at'),

    // Google OAuth fields
    googleId: varchar('google_id', { length: 255 }).unique(),
    googleEmail: varchar('google_email', { length: 255 }),
    googlePictureUrl: text('google_picture_url'),
    authProvider: authProviderEnum('auth_provider').default('email'),
    lastLoginProvider: varchar('last_login_provider', { length: 50 }),
    emailVerified: boolean('email_verified').default(false),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Rooms Table
export const rooms = pgTable('rooms', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).unique(),
    ownerId: uuid('owner_id').references(() => users.id).notNull(),
    topic: varchar('topic', { length: 200 }),
    languages: text('languages').array().default([]),
    maxParticipants: integer('max_participants').default(12).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    closedAt: timestamp('closed_at'),
});

// Room Participants Table
export const roomParticipants = pgTable('room_participants', {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    role: roomParticipantRole('role').default('participant').notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
});

// Refresh Tokens Table
export const refreshTokens = pgTable('refresh_tokens', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    token: text('token').unique().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Random Call Sessions Table (for analytics)
export const randomCallSessions = pgTable('random_call_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    user1Id: uuid('user1_id').references(() => users.id).notNull(),
    user2Id: uuid('user2_id').references(() => users.id).notNull(),
    // Language matched (null = random global match) 
    matchedLanguage: varchar('matched_language', { length: 50 }),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    connectedAt: timestamp('connected_at'),
    endedAt: timestamp('ended_at'),
    // Duration in seconds
    durationSeconds: integer('duration_seconds'),
    // WebRTC connection type used
    connectionType: varchar('connection_type', { length: 20 }),
    // Reason for call ending
    endReason: varchar('end_reason', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// User Call Preferences Table
export const userCallPreferences = pgTable('user_call_preferences', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id).notNull().unique(),
    // Selected languages for preference matching
    preferredLanguages: text('preferred_languages').array(),
    // Whether language preference is enabled
    languagePreferenceEnabled: boolean('language_preference_enabled').default(false),
    // Users blocked from matching
    blockedUsers: text('blocked_users').array().default([]),
    // Stats
    totalCallsCompleted: integer('total_calls_completed').default(0),
    totalCallMinutes: integer('total_call_minutes').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Call Ratings Table
export const callRatings = pgTable('call_ratings', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => randomCallSessions.id).notNull(),
    // User who gave the rating
    ratingFromUserId: uuid('rating_from_user_id').references(() => users.id).notNull(),
    // Rating 1-5 stars
    rating: integer('rating').notNull(),
    // Optional feedback text
    feedback: text('feedback'),
    // Was this reported as abuse
    reportedAsAbuse: boolean('reported_as_abuse').default(false),
    // Report reason if reported
    reportReason: varchar('report_reason', { length: 200 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});



//------------------------ Relations

export const usersRelations = relations(users, ({ many }) => ({
    ownedRooms: many(rooms),
    roomParticipations: many(roomParticipants),
    refreshTokens: many(refreshTokens, { relationName: 'refreshTokens' }),
    randomCallsAsUser1: many(randomCallSessions, { relationName: 'user1Calls' }),
    randomCallsAsUser2: many(randomCallSessions, { relationName: 'user2Calls' }),
    callRatingsGiven: many(callRatings, { relationName: 'ratingsGiven' }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
    user: one(users, {
        fields: [refreshTokens.userId],
        references: [users.id],
        relationName: 'refreshTokens',
    }),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
    owner: one(users, {
        fields: [rooms.ownerId],
        references: [users.id],
    }),
    participants: many(roomParticipants),
}));

export const roomParticipantsRelations = relations(roomParticipants, ({ one }) => ({
    room: one(rooms, {
        fields: [roomParticipants.roomId],
        references: [rooms.id],
    }),
    user: one(users, {
        fields: [roomParticipants.userId],
        references: [users.id],
    }),
}));

// Random Call Relations
export const randomCallSessionsRelations = relations(randomCallSessions, ({ one, many }) => ({
    user1: one(users, {
        fields: [randomCallSessions.user1Id],
        references: [users.id],
        relationName: 'user1Calls',
    }),
    user2: one(users, {
        fields: [randomCallSessions.user2Id],
        references: [users.id],
        relationName: 'user2Calls',
    }),
    ratings: many(callRatings),
}));

export const userCallPreferencesRelations = relations(userCallPreferences, ({ one }) => ({
    user: one(users, {
        fields: [userCallPreferences.userId],
        references: [users.id],
    }),
}));

export const callRatingsRelations = relations(callRatings, ({ one }) => ({
    session: one(randomCallSessions, {
        fields: [callRatings.sessionId],
        references: [randomCallSessions.id],
    }),
    ratingFromUser: one(users, {
        fields: [callRatings.ratingFromUserId],
        references: [users.id],
        relationName: 'ratingsGiven',
    }),
}));
