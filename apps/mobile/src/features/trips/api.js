/**
 * The traveller's trips: from their account when signed in, plus guest bookings this phone
 * holds a token for. Cached for offline (the list is useful on travel day).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { holdTokens } from '../build/api';
import { useSession } from '../auth/session';

const SHOWN = ['confirmed', 'fully_paid', 'completed', 'cancelled'];

export function useMyTrips() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['trips', session?.user.id || 'guest'],
    queryFn: async () => {
      const byId = new Map();
      if (session) {
        for (const trip of (await api('/v1/me/bookings')).trips) byId.set(trip.bookingId, trip);
      }
      const guestIds = holdTokens.all().filter((id) => !byId.has(id));
      const guest = await Promise.all(
        guestIds.map((id) =>
          api(`/v1/bookings/${id}?token=${encodeURIComponent(holdTokens.get(id))}`).catch(() => null)),
      );
      for (const trip of guest) if (trip) byId.set(trip.bookingId, trip);
      return [...byId.values()]
        .filter((trip) => SHOWN.includes(trip.status))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    },
  });
}
