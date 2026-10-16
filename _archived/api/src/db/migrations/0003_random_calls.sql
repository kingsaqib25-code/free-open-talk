-- Random Call Sessions Migration
-- Creates tables for random voice call feature

-- Random Call Sessions Table (for analytics/history)
CREATE TABLE IF NOT EXISTS random_call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL REFERENCES users(id),
    user2_id UUID NOT NULL REFERENCES users(id),
    matched_language VARCHAR(50),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    connected_at TIMESTAMP,
    ended_at TIMESTAMP,
    duration_seconds INTEGER,
    connection_type VARCHAR(20),
    end_reason VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- User Call Preferences Table
CREATE TABLE IF NOT EXISTS user_call_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id),
    preferred_languages TEXT[],
    language_preference_enabled BOOLEAN DEFAULT FALSE,
    blocked_users TEXT[] DEFAULT '{}',
    total_calls_completed INTEGER DEFAULT 0,
    total_call_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Call Ratings Table
CREATE TABLE IF NOT EXISTS call_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES random_call_sessions(id),
    rating_from_user_id UUID NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT,
    reported_as_abuse BOOLEAN DEFAULT FALSE,
    report_reason VARCHAR(200),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_random_calls_user1 ON random_call_sessions(user1_id);
CREATE INDEX IF NOT EXISTS idx_random_calls_user2 ON random_call_sessions(user2_id);
CREATE INDEX IF NOT EXISTS idx_random_calls_started ON random_call_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_random_calls_language ON random_call_sessions(matched_language);
CREATE INDEX IF NOT EXISTS idx_call_ratings_session ON call_ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_call_ratings_user ON call_ratings(rating_from_user_id);
CREATE INDEX IF NOT EXISTS idx_user_call_prefs_user ON user_call_preferences(user_id);
