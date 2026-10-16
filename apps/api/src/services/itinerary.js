/**
 * The travel-day itinerary (Slice 4): day by day with times, the people to call (driver, guide,
 * lodge), where to go (map bounds for the offline map), and emergency numbers. The app saves it
 * on the phone as soon as the trip is confirmed, so it all works in airplane mode.
 * Provider phone numbers are shared only for confirmed trips: they are private otherwise.
 */
const { EMERGENCY_NUMBERS, addDays } = require('@safiri/shared');

const OPEN = ['confirmed', 'fully_paid', 'completed'];
const MAP_MARGIN_DEG = 0.25; // about 25 km around the destination and providers

class ItineraryError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function createItineraryService({ db, supportPhone }) {
  return {
    async forBooking(bookingId) {
      const { rows } = await db.query(
        `select b.id, b.ref, b.status, b.travellers, b.is_group, b.start_date::text as start_date, b.end_date::text as end_date,
                coalesce(p.title, d.name) as title, d.name as destination, d.region, d.lat, d.lng, d.slug as destination_slug
         from bookings b
         left join packages p on p.id = b.package_id
         left join quotes q on q.id = b.quote_id
         join destinations d on d.id = coalesce(p.destination_id, q.destination_id)
         where b.id = $1`,
        [bookingId],
      );
      const b = rows[0];
      if (!b) throw new ItineraryError('not_found', 404);
      if (!OPEN.includes(b.status)) throw new ItineraryError('not_confirmed', 409);

      // One line per listing per date, with the package's start time on the item's first day.
      const lines = await db.query(
        `select bi.date::text as date, l.title, l.kind, pr.id as provider_id, pr.name as provider,
                to_char(pi.start_time, 'HH24:MI') as time
         from booking_items bi
         join listings l on l.id = bi.listing_id
         join providers pr on pr.id = bi.provider_id
         join bookings b on b.id = bi.booking_id
         left join package_items pi on pi.package_id = b.package_id and pi.listing_id = bi.listing_id
                                    and pi.day = (bi.date - b.start_date + 1)
         where bi.booking_id = $1
         group by bi.date, l.title, l.kind, pr.id, pr.name, pi.start_time
         order by bi.date, pi.start_time nulls last, l.title`,
        [bookingId],
      );
      const providers = await db.query(
        `select distinct pr.id, pr.name, pr.type, pr.whatsapp_msisdn as phone, pr.lat, pr.lng
         from booking_items bi join providers pr on pr.id = bi.provider_id
         where bi.booking_id = $1 order by pr.type, pr.name`,
        [bookingId],
      );

      // Every day of the trip, including one with nothing booked (often the day home).
      const days = [];
      for (let d = b.start_date; d <= b.end_date; d = addDays(d, 1)) days.push({ date: d, items: [] });
      for (const line of lines.rows) {
        days.find((day) => day.date === line.date)?.items.push({ time: line.time, title: line.title, kind: line.kind, provider: line.provider });
      }

      const points = [[Number(b.lng), Number(b.lat)], ...providers.rows.filter((p) => p.lat != null).map((p) => [Number(p.lng), Number(p.lat)])];
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);

      return {
        bookingId: b.id,
        ref: b.ref,
        status: b.status,
        isGroup: b.is_group,
        title: b.title,
        travellers: b.travellers,
        startDate: b.start_date,
        endDate: b.end_date,
        destination: { name: b.destination, region: b.region, slug: b.destination_slug, lat: Number(b.lat), lng: Number(b.lng) },
        mapBounds: [Math.min(...lngs) - MAP_MARGIN_DEG, Math.min(...lats) - MAP_MARGIN_DEG, Math.max(...lngs) + MAP_MARGIN_DEG, Math.max(...lats) + MAP_MARGIN_DEG],
        days,
        contacts: providers.rows.map((p) => ({ name: p.name, role: p.type, phone: p.phone })),
        emergency: [...EMERGENCY_NUMBERS, ...(supportPhone ? [{ key: 'support', phone: supportPhone }] : [])],
      };
    },
  };
}

module.exports = { createItineraryService, ItineraryError };
