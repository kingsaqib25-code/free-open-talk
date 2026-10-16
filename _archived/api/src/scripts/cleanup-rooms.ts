import 'dotenv/config';
import { db } from '../db/index.js';
import { rooms, roomParticipants, users } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';

async function cleanup() {
    console.log('Checking for stale rooms...\n');

    // Get all active rooms
    const activeRooms = await db.query.rooms.findMany({
        where: eq(rooms.isActive, true),
    });

    console.log(`Found ${activeRooms.length} active room(s)`);

    for (const room of activeRooms) {
        // Get active participants
        const participants = await db.query.roomParticipants.findMany({
            where: and(
                eq(roomParticipants.roomId, room.id),
                isNull(roomParticipants.leftAt)
            ),
        });

        console.log(`\nRoom: ${room.name} (${room.id})`);
        console.log(`  Active participants: ${participants.length}`);

        // Check if participants are actually online
        let reallyActiveCount = 0;
        for (const p of participants) {
            const user = await db.query.users.findFirst({
                where: eq(users.id, p.userId),
            });
            const isOnline = user?.isOnline ?? false;
            console.log(`     - User: ${p.userId}, Role: ${p.role}, Online: ${isOnline}`);
            if (isOnline) reallyActiveCount++;
        }

        if (participants.length === 0 || reallyActiveCount === 0) {
            console.log('  -> Closing room (no active online participants)...');

            // Mark all participants as left
            await db
                .update(roomParticipants)
                .set({ leftAt: new Date() })
                .where(and(
                    eq(roomParticipants.roomId, room.id),
                    isNull(roomParticipants.leftAt)
                ));

            // Close the room
            await db
                .update(rooms)
                .set({ isActive: false, closedAt: new Date() })
                .where(eq(rooms.id, room.id));

            console.log('Room closed');
        } else {
            console.log(`  -> Room has ${reallyActiveCount} online participant(s), keeping active`);
        }
    }

    console.log('\nCleanup complete');
    process.exit(0);
}

cleanup().catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
});
