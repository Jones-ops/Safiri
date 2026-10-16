/**
 * A traveller cancels a confirmed trip. The refund follows the package's cancellation policy,
 * counted from today to the first day of travel; the traveller sees the exact figure before
 * confirming. The rooms go back on sale and the providers are told.
 */
const { daysBetween, formatAmount, refundFor, todayInKenya } = require('@safiri/shared');
const { translator } = require('../web/i18n');
const { asUser } = require('../lib/roles');

class CancelError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function createCancellationService({ db, notifier, log, now = () => new Date() }) {
  async function load(bookingId) {
    const { rows } = await db.query(
      `select b.id, b.ref, b.status, b.paid_kes, b.total_kes, b.start_date::text as start,
              coalesce(p.cancel_policy, '[{"days_before":0,"refund_pct":0}]'::jsonb) as policy
       from bookings b left join packages p on p.id = b.package_id where b.id = $1`,
      [bookingId],
    );
    return rows[0] || null;
  }

  function figures(b) {
    const daysBefore = daysBetween(todayInKenya(now()), b.start);
    const { refundPct, refundKes } = refundFor(b.policy, daysBefore, b.paid_kes);
    return { daysBefore, refundPct, refundKes, keptKes: b.paid_kes - refundKes };
  }

  return {
    async preview(bookingId) {
      const b = await load(bookingId);
      if (!b) throw new CancelError('not_found', 404);
      const cancellable = ['confirmed', 'fully_paid'].includes(b.status);
      return { bookingId: b.id, ref: b.ref, status: b.status, cancellable, paidKes: b.paid_kes, ...figures(b) };
    },

    async cancel(bookingId, userId) {
      const b = await load(bookingId);
      if (!b) throw new CancelError('not_found', 404);
      if (!['confirmed', 'fully_paid'].includes(b.status)) throw new CancelError('not_cancellable');
      const f = figures(b);
      const reason = `Traveller cancelled ${f.daysBefore} days before travel: ${f.refundPct}% refund`;
      const run = (client) => client.query('select cancel_booking($1, $2, $3) as o', [bookingId, reason, f.refundKes]);
      const outcome = (userId ? await asUser(db, userId, run) : await run(db)).rows[0].o;

      // Tell the providers their dates are free again.
      const providers = await db.query(
        `select distinct pr.id, pr.name, pr.whatsapp_msisdn as phone, pr.owner_id, coalesce(prof.language, 'en') as language
         from booking_items bi join providers pr on pr.id = bi.provider_id left join profiles prof on prof.user_id = pr.owner_id
         where bi.booking_id = $1 and pr.whatsapp_msisdn is not null`,
        [bookingId],
      );
      for (const p of providers.rows) {
        const t = translator(p.language);
        const vars = { ref: b.ref, date: b.start };
        await notifier.notify({
          kind: `booking_cancelled_provider:${p.id}`, language: p.language, userId: p.owner_id, phone: p.phone, bookingId, instalmentId: null,
          sms: t('sms.providerCancelled', vars), whatsapp: { template: 'booking_cancelled', params: [vars.ref, p.name, vars.date] },
          push: { title: t('push.providerCancelledTitle'), body: t('push.providerCancelledBody', vars), data: { url: '/requests' } },
        }).catch((err) => log.warn({ err }, 'provider cancel notice failed'));
      }
      return { outcome, ...f, refundText: formatAmount(f.refundKes) };
    },
  };
}

module.exports = { createCancellationService, CancelError };
