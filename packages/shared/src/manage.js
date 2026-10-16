/** Rules for managing the catalogue (admin, agencies) and provider self-service. */
const { z } = require('zod');
const { msisdnSchema } = require('./schemas');

/** "Naivasha Lakeside Weekend!" -> "naivasha-lakeside-weekend" */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'trip';
}

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).optional();

const cancelTierSchema = z.object({ days_before: z.number().int().min(0).max(365), refund_pct: z.number().int().min(0).max(100) });

const packageItemSchema = z.object({
  listingId: z.uuid(),
  day: z.number().int().min(1).max(15),
  qty: z.number().int().min(1).max(14),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
});

/** Create or edit a package. Everything the traveller sees plus the agency's pricing terms. */
const packageInputSchema = z
  .object({
    agencyId: z.uuid().optional(), // admins pick; agencies always use their own
    destinationId: z.uuid(),
    title: text(80),
    summary: optionalText(400),
    nights: z.number().int().min(0).max(14),
    marginBps: z.number().int().min(0).max(5000),
    depositPct: z.number().int().min(1).max(100),
    instalments: z.number().int().min(0).max(12),
    finalDueDays: z.number().int().min(0).max(60),
    graceDays: z.number().int().min(0).max(14),
    cancelPolicy: z.array(cancelTierSchema).min(1).max(5),
    inclusions: z.array(text(80)).max(20),
    exclusions: z.array(text(80)).max(20),
    heroImage: optionalText(80).nullable(),
    items: z.array(packageItemSchema).min(1).max(20),
    sw: z.object({ title: optionalText(80), summary: optionalText(400) }).optional(),
  })
  .strict()
  .refine((p) => p.items.every((i) => i.day <= p.nights + 1), { message: 'items.outsideTrip' })
  .refine((p) => p.cancelPolicy.some((t) => t.days_before === 0), { message: 'cancelPolicy.needsFinalTier' });

const destinationInputSchema = z
  .object({
    name: text(60),
    region: text(60),
    lat: z.number().min(-5).max(5),
    lng: z.number().min(33).max(42),
    summary: optionalText(400),
    bestTime: optionalText(200),
    gettingThere: optionalText(300),
    driveHours: z.number().min(0.5).max(24).nullable().optional(),
    heroImage: optionalText(80).nullable().optional(),
    faq: z.array(z.object({ q: text(200), a: text(600) })).max(10).optional(),
    sw: z.object({ summary: optionalText(400), bestTime: optionalText(200), gettingThere: optionalText(300) }).optional(),
  })
  .strict();

/** A provider signing up from the app: 6 short steps, saved as they go. */
const providerOnboardSchema = z
  .object({
    type: z.enum(['lodge', 'guide', 'driver', 'activity']),
    name: text(80),
    destinationId: z.uuid(),
    locationName: optionalText(120),
    lat: z.number().min(-5).max(5).optional(),
    lng: z.number().min(33).max(42).optional(),
    whatsappPhone: msisdnSchema,
    payoutPhone: msisdnSchema,
    licenceNo: optionalText(40),
    listing: z.object({
      title: text(80),
      kind: z.enum(['stay', 'activity', 'transport']),
      unit: z.enum(['night', 'person', 'day']),
      capacity: z.number().int().min(1).max(500),
      netKes: z.number().int().min(100).max(500000),
    }),
  })
  .strict();

const priceSeasonSchema = z
  .object({
    seasonStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    seasonEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    netKes: z.number().int().min(100).max(500000),
  })
  .refine((s) => s.seasonEnd >= s.seasonStart, { message: 'season.endBeforeStart' });

const blockDatesSchema = z
  .object({ dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(62), blocked: z.boolean() })
  .strict();

const rolesSchema = z.array(z.enum(['traveller', 'provider', 'agency', 'admin'])).min(1);

module.exports = {
  slugify,
  packageInputSchema,
  destinationInputSchema,
  providerOnboardSchema,
  priceSeasonSchema,
  blockDatesSchema,
  rolesSchema,
};
