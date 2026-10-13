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

module.exports = { msisdnSchema, otpSchema, languageSchema, consentsSchema, profileUpdateSchema, z };
