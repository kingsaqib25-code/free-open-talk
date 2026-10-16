CREATE TYPE "public"."auth_provider" AS ENUM('email', 'google', 'google+email');--> statement-breakpoint
CREATE TABLE "call_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"rating_from_user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"feedback" text,
	"reported_as_abuse" boolean DEFAULT false,
	"report_reason" varchar(200),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "random_call_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user1_id" uuid NOT NULL,
	"user2_id" uuid NOT NULL,
	"matched_language" varchar(50),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"connected_at" timestamp,
	"ended_at" timestamp,
	"duration_seconds" integer,
	"connection_type" varchar(20),
	"end_reason" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_call_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"preferred_languages" text[],
	"language_preference_enabled" boolean DEFAULT false,
	"blocked_users" text[] DEFAULT '{}',
	"total_calls_completed" integer DEFAULT 0,
	"total_call_minutes" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_call_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_email" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_picture_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" "auth_provider" DEFAULT 'email';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "call_ratings" ADD CONSTRAINT "call_ratings_session_id_random_call_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."random_call_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_ratings" ADD CONSTRAINT "call_ratings_rating_from_user_id_users_id_fk" FOREIGN KEY ("rating_from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_call_sessions" ADD CONSTRAINT "random_call_sessions_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_call_sessions" ADD CONSTRAINT "random_call_sessions_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_call_preferences" ADD CONSTRAINT "user_call_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE("google_id");