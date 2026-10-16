/**
 * A review written offline waits on the phone and posts when the connection returns (the
 * traveller is often back on the Nairobi road with patchy signal when they feel like writing).
 */
import { useEffect } from 'react';
import { tripStore } from '../../lib/storage';
import { useIsOnline } from '../../lib/network';
import { api } from '../../lib/api';
import { uploadAll } from './upload';
import { queryClient } from '../../lib/queryClient';

const KEY = 'pending-reviews';

const read = () => {
  try {
    return JSON.parse(tripStore.getString(KEY) || '[]');
  } catch {
    return [];
  }
};
const write = (list) => tripStore.set(KEY, JSON.stringify(list));

export const pendingReviews = {
  all: read,
  has: (bookingId) => read().some((r) => r.bookingId === bookingId),
  add(review) {
    write([...read().filter((r) => r.bookingId !== review.bookingId), review]);
  },
  remove(bookingId) {
    write(read().filter((r) => r.bookingId !== bookingId));
  },
};

let flushing = false;

/** Posts every waiting review (uploads first). Each one is removed only once the API accepted it. */
export async function flushPendingReviews() {
  if (flushing) return;
  flushing = true;
  try {
    for (const r of read()) {
      try {
        if (r.assets?.length) await uploadAll(r.assets, r.mediaPaths);
        await api('/v1/me/reviews', { method: 'POST', body: { bookingId: r.bookingId, rating: r.rating, body: r.body || undefined, mediaPaths: r.mediaPaths?.length ? r.mediaPaths : undefined } });
        pendingReviews.remove(r.bookingId);
        queryClient.invalidateQueries({ queryKey: ['trips'] });
      } catch (err) {
        // Already reviewed or no longer reviewable: nothing more to do with this one.
        if (err.status === 409 || err.status === 400) pendingReviews.remove(r.bookingId);
        // Otherwise (offline, server down) leave it for the next attempt.
      }
    }
  } finally {
    flushing = false;
  }
}

export function usePendingReviewFlush() {
  const online = useIsOnline();
  useEffect(() => {
    if (online && read().length) flushPendingReviews();
  }, [online]);
}
