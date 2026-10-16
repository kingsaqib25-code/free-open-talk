import z from "zod";

// Validation schemas for updates
export const updateRoomSchema = z.object({
    name: z.string().min(3).max(100).optional(),
    topic: z.string().max(200).optional(),
    maxParticipants: z.number().int().min(2).max(12).optional(),
});

export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    language: z.string().optional(),
});