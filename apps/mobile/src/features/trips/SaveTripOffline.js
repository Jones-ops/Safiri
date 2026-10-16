/**
 * Renders nothing; makes a confirmed trip ready for a day without signal: saves the
 * itinerary, schedules the day-of reminders, and starts the map download on Wi-Fi.
 * Placed on the receipt screen (the moment a trip confirms) and once per upcoming trip in Trips.
 */
import { useItinerary, useTripReminders } from './offline';
import { useOfflineMap } from './offlineMap';

export function SaveTripOffline({ bookingId }) {
  const { data } = useItinerary(bookingId);
  useTripReminders(data?.itinerary);
  useOfflineMap(data?.itinerary);
  return null;
}
