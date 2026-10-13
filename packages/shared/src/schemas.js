/** Request and form schemas shared by the app (react-hook-form) and the API (Fastify). */
const { z } = require('zod');
const { normalizeMsisdn } = require('./phone');
const { CONSENT_PURPOSES, LANGUAGES, REQUIRED_CONSENTS } = require('./constants');

/** Accepts any way of typing a Kenyan number and outputs 2547XXXXXXXX. */
const msisdnSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normal = normalizeMsisdn(value);
    if (!normal) {
      ctx.addIssue({ code: 'custom', message: 'phone.invalid' });
      return z.NEVER;
    }
    return normal;
  });

const otpSchema = z.string().trim().regex(/^\d{6}$/, 'otp.invalid');

const languageSchema = z.enum(LANGUAGES);

const consentsSchema = z
  .partialRecord(z.enum(Object.values(CONSENT_PURPOSES)), z.boolean())
  .refine((c) => REQUIRED_CONSENTS.every((p) => c[p] === true), { message: 'consent.required' });

const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    language: languageSchema.optional(),
    lowData: z.boolean().optional(),
  })
  .strict();

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date.invalid');

/**
 * Ask the API for a price. Either a package (its items are fixed) or a custom trip from the
 * builder (a destination, a number of nights, and chosen listings with the day they happen).
 */
const quoteRequestSchema = z
  .object({
    packageSlug: slugSchema.optional(),
    destinationSlug: slugSchema.optional(),
    nights: z.number().int().min(0).max(14).optional(),
    items: z
      .array(z.object({ listingId: z.uuid(), day: z.number().int().min(1).max(15), qty: z.number().int().min(1).max(14) }))
      .max(20)
      .optional(),
    startDate: isoDateSchema,
    travellers: z.number().int().min(1).max(20),
  })
  .strict()
  .refine((r) => Boolean(r.packageSlug) !== Boolean(r.destinationSlug), { message: 'quote.packageOrDestination' })
  .refine((r) => !r.destinationSlug || (r.items?.length && r.nights !== undefined), { message: 'quote.customNeedsItems' });

const holdRequestSchema = z.object({ quoteId: z.uuid(), phone: msisdnSchema }).strict();

module.exports = {
  msisdnSchema,
  otpSchema,
  languageSchema,
  consentsSchema,
  profileUpdateSchema,
  quoteRequestSchema,
  holdRequestSchema,
  z,
};
