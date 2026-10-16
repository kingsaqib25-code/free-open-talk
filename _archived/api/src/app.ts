import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authRouter } from './routes/auth.routes.js';
import { userRouter } from './routes/user.routes.js';
import { uploadRouter } from './routes/upload.routes.js';
import { errorHandler } from './middleware/error.middleware.js';
import { roomRouter } from './routes/room.routes.js';
import { voiceRouter } from './routes/voice.routes.js';
import randomRouter from './routes/random.routes.js';
import cookieParser from 'cookie-parser';
import { apiRateLimiter } from './middleware/rate-limiter.middleware.js';

export const app = express();

// Trust proxy (imp for rate limiting behind reverse proxy like Render)
app.set('trust proxy', 1);

// Middlewares

app.use(helmet());
app.use(
    cors({
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        // origin: 'https://freetotalk.vercel.app',
        // origin: 'http://localhost:3000',
        credentials: true,
    })
);
app.use(express.json());
app.use(cookieParser())
app.use(morgan('dev'));

// general rate limiting to all API routes
app.use('/api', apiRateLimiter);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// API Routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/rooms', roomRouter);
app.use('/api/v1/voice', voiceRouter);
app.use('/api/v1/random', randomRouter);

// Error handler
app.use(errorHandler);
