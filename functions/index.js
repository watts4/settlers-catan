import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

initializeApp();

const TTL_HOURS = 24;

/**
 * Runs every hour. Deletes game rooms that have not been updated in
 * TTL_HOURS hours, regardless of status. This covers:
 *   - Abandoned 'waiting' rooms where the host never started
 *   - Finished games still sitting in Firestore
 *   - In-progress games where all players left without clicking Leave
 */
export const cleanupStaleRooms = onSchedule('every 1 hours', async () => {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(Date.now() - TTL_HOURS * 60 * 60 * 1000);

  const stale = await db
    .collection('games')
    .where('updatedAt', '<', cutoff.toMillis())
    .get();

  if (stale.empty) {
    console.log('cleanupStaleRooms: nothing to delete');
    return;
  }

  // Delete in batches of 500 (Firestore batch limit)
  const BATCH_SIZE = 500;
  let deleted = 0;
  for (let i = 0; i < stale.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    stale.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(BATCH_SIZE, stale.docs.length - i);
  }

  console.log(`cleanupStaleRooms: deleted ${deleted} stale room(s)`);
});
