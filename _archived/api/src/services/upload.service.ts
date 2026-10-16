import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/env.js';
import crypto from 'crypto';

// Configure Cloudinary
cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
});

// ----------------------- Types

export interface UploadResult {
    publicId: string;
    url: string;
    secureUrl: string;
    size: number;
    format: string;
    resourceType: string;
}

export interface UploadOptions {
    folder?: string;
    transformation?: any;
    resourceType?: 'image' | 'video' | 'raw' | 'auto';
}

// --------------------- Constants 

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// ----------------------- Helper Functions 

// Generate unique public ID
function generatePublicId(userId: string, type: string): string {
    const hash = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now();
    return `${type}/${userId}/${timestamp}-${hash}`;
}

// Validate file buffer
function validateFile(buffer: Buffer, mimeType: string): void {
    if (buffer.length > MAX_AVATAR_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_AVATAR_SIZE / 1024 / 1024}MB`);
    }

    if (!ALLOWED_AVATAR_TYPES.includes(mimeType)) {
        throw new Error(`Invalid file type. Allowed types: ${ALLOWED_AVATAR_TYPES.join(', ')}`);
    }
}

// ----------------------- Public Functions 

// Upload avatar image to Cloudinary
export async function uploadAvatar(
    buffer: Buffer,
    mimeType: string,
    userId: string
): Promise<UploadResult> {
    // Validate
    validateFile(buffer, mimeType);

    // Generate unique public ID
    const publicId = generatePublicId(userId, 'avatars');

    // Upload to Cloudinary using buffer
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                public_id: publicId,
                folder: 'free2talk/avatars',
                resource_type: 'image',
                transformation: [
                    { width: 400, height: 400, crop: 'fill', gravity: 'face' },
                    { quality: 'auto', fetch_format: 'auto' },
                ],
                overwrite: true,
            },
            (error, result) => {
                if (error) {
                    reject(new Error(`Cloudinary upload failed: ${error.message}`));
                    return;
                }

                if (!result) {
                    reject(new Error('Cloudinary upload failed: No result returned'));
                    return;
                }

                resolve({
                    publicId: result.public_id,
                    url: result.url,
                    secureUrl: result.secure_url,
                    size: result.bytes,
                    format: result.format,
                    resourceType: result.resource_type,
                });
            }
        );

        // Write buffer to stream
        uploadStream.end(buffer);
    });
}


// Delete avatar from Cloudinary
export async function deleteAvatar(publicId: string): Promise<void> {
    try {
        await cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
        });
    } catch (error) {
        // Log but don't throw - asset might already be deleted
        console.error('Cloudinary delete error:', error);
    }
}


// Extract public ID from Cloudinary URL
export function extractPublicId(url: string): string | null {
    try {
        // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{transformations}/{public_id}.{format}
        const match = url.match(/\/upload\/(?:v\d+\/)?(.*?)(?:\.[^.]+)?$/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}
