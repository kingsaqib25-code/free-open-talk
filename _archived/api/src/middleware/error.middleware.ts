
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/app-error';
import fs from 'fs';
import path from 'path';

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
) {

    // Log error to file (append)
    // const logPath = path.join(__dirname, '../../logs/error.log');
    // const logMsg = `[${new Date().toISOString()}] ${err.stack || err.message}\n`;
    // try {
    //     fs.mkdirSync(path.dirname(logPath), { recursive: true });
    //     fs.appendFileSync(logPath, logMsg);
    // } catch (e) {
    //     // Fallback to console if file logging fails
    //     console.error('Failed to write error log:', e);
    // }

    // Always log to console in development
    if (process.env.NODE_ENV !== 'production') {
        console.error('Error:', err);
    }


    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({
            error: {
                message: 'Invalid JSON payload',
            },
        });
    }

    // Zod validation error
    if (err instanceof z.ZodError) {
        return res.status(400).json({
            error: {
                message: 'Validation error',
                details: err.issues,
            },
        });
    }

    // Custom application error
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: {
                message: err.message,
                details: err.details,
                ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
            },
        });
    }

    // Unknown/unexpected error
    res.status(500).json({
        error: {
            message: 'Internal server error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        },
    });
}
