/**
 * M-PESA payments (Slice 3a: pay a deposit or in full).
 *
 * Flow: checkout options -> start (payment row + STK push) -> Daraja callback -> STK Query
 * confirms -> confirm_payment() in the database (idempotent: ledger, booking confirmed,
 * rooms booked, payment plan). If a callback never comes, the reconcile job and the app's
 * status polling settle the payment with STK Query instead.
 */
const { DEFAULTS, MPESA_MAX_TRANSACTION_KES, buildSchedule, formatAmount, todayInKenya } = require('@safiri/shared');
const { parseStkCallback } = require('../integrations/daraja');
const { translator } = require('../web/i18n');

const PAYMENT_ERRORS = {
  booking_not_found: 404,
  hold_expired: 410,
  not_payable: 409,
  payment_in_progress: 409,
  deposit_not_available: 422,
  amount_over_limit: 422,
  mpesa_not_configured: 503,
  mpesa_unavailable: 502,
};

class PaymentError extends Error {
  constructor(code, details) {
    super(code);
    this.code = code;
    this.status = PAYMENT_ERRORS[code] || 400;
    this.details = details;
  }
}

const FAIL_STATUS = { cancelled: 'cancelled', timed_out: 'timed_out', failed: 'failed' };
const PENDING_GIVE_UP_MINUTES = 30;
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};
const shortDate = (iso, lang) => `${Number(iso.slice(8, 10))} ${(MONTHS[lang] || MONTHS.en)[Number(iso.slice(5, 7)) - 1]}`;

function createPaymentService({ db, daraja, sms, log, now = () => new Date() }) {
  function need() {
    if (!db) throw new PaymentError('mpesa_not_configured');
    return db;
  }

  async function loadBooking(client, bookingId, { lock = false } = {}) {
    const { rows } = await client.query(
      `select b.*, b.start_date::text as start_iso, b.end_date::text as end_iso, (b.hold_expires_at > now()) as hold_live,
              coalesce(p.deposit_pct, $2) as deposit_pct, coalesce(p.instalments, $3) as instalment_count,
              coalesce(p.final_due_days, $4) as final_due_days, coalesce(p.cancel_policy, $5::jsonb) as cancel_policy,
              p.title as package_title, p.slug as package_slug
       from bookings b left join packages p on p.id = b.package_id
       where b.id = $1 ${lock ? 'for update of b' : ''}`,
      [bookingId, DEFAULTS.DEPOSIT_PCT, DEFAULTS.INSTALMENT_COUNT, DEFAULTS.FINAL_DUE_DAYS,
        JSON.stringify([{ days_before: 30, refund_pct: 100 }, { days_before: 14, refund_pct: 50 }, { days_before: 0, refund_pct: 0 }])],
    );
    return rows[0] || null;
  }

  function scheduleFor(b) {
    return buildSchedule({
      totalKes: b.total_kes,
      depositPct: b.deposit_pct,
      instalmentCount: b.instalment_count,
      today: todayInKenya(now()),
      startDate: b.start_iso,
      finalDueDays: b.final_due_days,
    });
  }

  /** What the checkout screen offers: deposit (with its schedule) and/or pay in full. */
  function optionsFor(b) {
    const schedule = scheduleFor(b);
    const options = [];
    if (!schedule.payInFullOnly) options.push({ option: 'deposit', amountKes: schedule.depositKes, schedule: schedule.payments });
    options.push({ option: 'full', amountKes: b.total_kes });
    return options.map((o) => ({ ...o, overLimit: o.amountKes > MPESA_MAX_TRANSACTION_KES }));
  }

  async function startPayment({ bookingId, option, phone }) {
    const client = await need().connect();
    let payment;
    let booking;
    try {
      await client.query('begin');
      booking = await loadBooking(client, bookingId, { lock: true });
      if (!booking) throw new PaymentError('booking_not_found');

      // deposit / full start a held booking; instalment / balance pay down a confirmed one.
      const checkout = option === 'deposit' || option === 'full';
      if (checkout) {
        if (booking.status !== 'held') throw new PaymentError('not_payable', { status: booking.status });
        if (!booking.hold_live) throw new PaymentError('hold_expired');
      } else if (booking.status !== 'confirmed') {
        throw new PaymentError('not_payable', { status: booking.status });
      }

      const recent = await client.query(
        `select 1 from payments where booking_id = $1 and status in ('initiated', 'pending') and created_at > now() - interval '2 minutes'`,
        [bookingId],
      );
      if (recent.rowCount) throw new PaymentError('payment_in_progress');

      let amountKes;
      let chosen = null;
      if (checkout) {
        const schedule = scheduleFor(booking);
        if (option === 'deposit' && schedule.payInFullOnly) throw new PaymentError('deposit_not_available');
        amountKes = option === 'deposit' ? schedule.depositKes : booking.total_kes;
        chosen = option === 'deposit'
          ? schedule
          : { payInFullOnly: true, depositKes: booking.total_kes, finalDueDate: todayInKenya(now()), payments: [{ seq: 0, amountKes: booking.total_kes, dueDate: todayInKenya(now()) }] };
      } else if (option === 'instalment') {
        const next = await client.query(
          `select amount_kes - paid_kes as left_kes from instalments
           where booking_id = $1 and status in ('due', 'overdue') order by seq limit 1`,
          [bookingId],
        );
        if (!next.rowCount) throw new PaymentError('not_payable', { status: 'nothing_due' });
        amountKes = next.rows[0].left_kes;
      } else {
        amountKes = booking.total_kes - booking.paid_kes;
      }
      if (amountKes <= 0) throw new PaymentError('not_payable', { status: 'nothing_due' });
      if (amountKes > MPESA_MAX_TRANSACTION_KES) throw new PaymentError('amount_over_limit', { maxKes: MPESA_MAX_TRANSACTION_KES });

      const { rows } = await client.query(
        `insert into payments (booking_id, msisdn, amount_kes, status, purpose, schedule)
         values ($1, $2, $3, 'initiated', $4, $5) returning id`,
        [bookingId, phone, amountKes, option, JSON.stringify(chosen)],
      );
      payment = { id: rows[0].id, amountKes };
      // Keep the rooms while the traveller is entering their PIN.
      if (checkout) {
        await client.query(`update bookings set hold_expires_at = greatest(hold_expires_at, now() + interval '3 minutes') where id = $1`, [bookingId]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (!daraja.configured) {
      await db.query(`update payments set status = 'failed', result_desc = 'M-PESA is not configured' where id = $1`, [payment.id]);
      throw new PaymentError('mpesa_not_configured');
    }
    try {
      const push = await daraja.stkPush({
        msisdn: phone,
        amountKes: payment.amountKes,
        accountReference: booking.ref,
        description: { deposit: 'Safiri deposit', instalment: 'Instalment', balance: 'Balance' }[option] || 'Safiri trip',
      });
      await db.query(
        `update payments set status = 'pending', merchant_request_id = $2, checkout_request_id = $3 where id = $1`,
        [payment.id, push.merchantRequestId, push.checkoutRequestId],
      );
      return { paymentId: payment.id, status: 'pending', amountKes: payment.amountKes, customerMessage: push.customerMessage };
    } catch (err) {
      log.error({ err, body: err.body }, 'STK push failed');
      await db.query(`update payments set status = 'failed', result_desc = $2 where id = $1`, [payment.id, String(err.message).slice(0, 200)]);
      throw new PaymentError('mpesa_unavailable');
    }
  }

  /** After confirm_payment: text the traveller a receipt (and record it). Never throws. */
  async function sendReceipt(checkoutRequestId, outcome) {
    try {
      const { rows } = await db.query(
        `select p.amount_kes, p.mpesa_receipt, p.msisdn, b.id as booking_id, b.ref, b.status, b.user_id,
                coalesce(pr.language, 'en') as language,
                (select row_to_json(i) from (select amount_kes - paid_kes as amount, due_date::text as due
                   from instalments where booking_id = b.id and status in ('due', 'overdue') order by seq limit 1) i) as next
         from payments p join bookings b on b.id = p.booking_id
         left join profiles pr on pr.phone = b.phone
         where p.checkout_request_id = $1`,
        [checkoutRequestId],
      );
      const r = rows[0];
      if (!r) return;
      const t = translator(r.language);
      const vars = { amount: formatAmount(r.amount_kes), receipt: r.mpesa_receipt, ref: r.ref };
      let message;
      if (outcome === 'refund_due') message = t('sms.refundDue', vars);
      else {
        message = t('sms.paymentConfirmed', vars);
        message += ' ' + (r.next ? t('sms.nextPayment', { amount: formatAmount(r.next.amount), date: shortDate(r.next.due, r.language) }) : t('sms.fullyPaid'));
      }
      const sent = await sms.send(`+${r.msisdn}`, message).catch((err) => ({ error: err.message }));
      await db.query(
        `insert into notifications (user_id, phone, booking_id, channel, template, payload, status, provider_message_id, sent_at, error)
         values ($1, $2, $3, 'sms', $4, $5, $6::notification_status, $7, case when $6::text = 'sent' then now() end, $8)`,
        [r.user_id, r.msisdn, r.booking_id, outcome === 'refund_due' ? 'refund_due' : 'payment_received',
          JSON.stringify({ message }), sent.error ? 'failed' : 'sent', sent.id || null, sent.error || null],
      );
    } catch (err) {
      log.error({ err }, 'receipt SMS failed');
    }
  }

  /**
   * Asks Safaricom for the truth about a pending payment and records it.
   * The receipt number only comes in the callback, so it is taken from a stored callback when there is one.
   */
  async function settle(payment) {
    const result = await daraja.stkQuery(payment.checkout_request_id);
    await db.query('update payments set query_attempts = query_attempts + 1 where id = $1', [payment.id]);
    if (result.state === 'succeeded') {
      const receipt = parseStkCallback(payment.callback)?.receipt || null;
      const outcome = (await db.query('select confirm_payment($1, $2) as o', [payment.checkout_request_id, receipt])).rows[0].o;
      if (outcome !== 'already_confirmed') await sendReceipt(payment.checkout_request_id, outcome);
      return outcome;
    }
    if (result.state === 'pending') {
      const ageMinutes = (Date.now() - new Date(payment.created_at).getTime()) / 60000;
      if (ageMinutes < PENDING_GIVE_UP_MINUTES) return 'pending';
      result.state = 'timed_out';
    }
    return (await db.query('select fail_payment($1, $2, $3, $4) as o', [payment.checkout_request_id, FAIL_STATUS[result.state], result.resultCode, result.resultDesc])).rows[0].o;
  }

  /** Daraja's callback. Always "accepted" to Daraja; the real decision is ours. */
  async function handleCallback(body) {
    const cb = parseStkCallback(body);
    const logged = await need().query(
      'insert into mpesa_callbacks (checkout_request_id, body) values ($1, $2) returning id',
      [cb?.checkoutRequestId || null, JSON.stringify(body ?? null)],
    );
    const setOutcome = (outcome) => db.query('update mpesa_callbacks set outcome = $2 where id = $1', [logged.rows[0].id, outcome]).then(() => outcome);
    if (!cb) return setOutcome('ignored');

    const { rows } = await db.query('select * from payments where checkout_request_id = $1', [cb.checkoutRequestId]);
    const payment = rows[0];
    if (!payment) return setOutcome('unknown_payment'); // not ours, or forged
    if (payment.status === 'succeeded') {
      await db.query('select confirm_payment($1, $2, $3)', [cb.checkoutRequestId, cb.receipt, JSON.stringify(body)]);
      return setOutcome('already_confirmed');
    }
    if (!['initiated', 'pending'].includes(payment.status)) return setOutcome('ignored');

    if (cb.state !== 'succeeded') {
      await db.query('select fail_payment($1, $2, $3, $4, $5)', [cb.checkoutRequestId, FAIL_STATUS[cb.state], cb.resultCode, cb.resultDesc, JSON.stringify(body)]);
      return setOutcome('failed');
    }
    if (cb.amountKes !== null && cb.amountKes !== payment.amount_kes) {
      log.error({ paymentId: payment.id, expected: payment.amount_kes, got: cb.amountKes }, 'M-PESA callback amount mismatch');
      return setOutcome('amount_mismatch');
    }

    // Keep the callback (it carries the receipt), then let Safaricom confirm it.
    await db.query('update payments set callback = $2 where id = $1', [payment.id, JSON.stringify(body)]);
    const outcome = await settle({ ...payment, callback: body });
    return setOutcome(outcome === 'pending' ? 'awaiting_query' : outcome === 'failed' ? 'not_confirmed_by_query' : outcome);
  }

  async function getPayment(paymentId) {
    const { rows } = await need().query(
      `select p.*, b.status as booking_status, b.ref, b.user_id as booking_user_id,
              extract(epoch from (now() - p.updated_at)) as idle_seconds,
              extract(epoch from (now() - p.created_at)) as age_seconds
       from payments p join bookings b on b.id = p.booking_id where p.id = $1`,
      [paymentId],
    );
    let p = rows[0];
    if (!p) return null;
    // STK Query fallback: if the callback is slow, ask Safaricom (at most every 10 seconds).
    if (p.status === 'pending' && daraja.configured && p.age_seconds > 20 && p.idle_seconds > 10) {
      await settle(p).catch((err) => log.warn({ err }, 'STK query failed'));
      p = (await db.query(`select p.*, b.status as booking_status, b.ref from payments p join bookings b on b.id = p.booking_id where p.id = $1`, [paymentId])).rows[0];
    }
    return p;
  }

  /** Job: settle payments still pending after 90 seconds. */
  async function reconcilePending() {
    if (!daraja.configured) return 0;
    const { rows } = await need().query(
      `select * from payments where status = 'pending' and created_at < now() - interval '90 seconds' order by created_at limit 20`,
    );
    for (const p of rows) await settle(p).catch((err) => log.warn({ err, paymentId: p.id }, 'reconcile failed'));
    return rows.length;
  }

  async function bookingSummary(bookingId) {
    const b = await loadBooking(need(), bookingId);
    if (!b) return null;
    const [payments, instalments] = await Promise.all([
      db.query(
        `select id, amount_kes, status, mpesa_receipt, confirmed_at, purpose from payments
         where booking_id = $1 and status = 'succeeded' order by confirmed_at`,
        [bookingId],
      ),
      db.query(`select seq, amount_kes, paid_kes, due_date::text, status from instalments where booking_id = $1 order by seq`, [bookingId]),
    ]);
    return {
      bookingId: b.id,
      ref: b.ref,
      status: b.status,
      userId: b.user_id,
      title: b.package_title,
      packageSlug: b.package_slug,
      startDate: b.start_iso,
      endDate: b.end_iso,
      travellers: b.travellers,
      phone: b.phone, // the owner's own M-PESA number (only owners and token holders see a summary)
      totalKes: b.total_kes,
      paidKes: b.paid_kes,
      holdExpiresAt: b.status === 'held' && b.hold_expires_at ? b.hold_expires_at.toISOString() : null,
      cancelPolicy: b.cancel_policy,
      options: b.status === 'held' && b.hold_live ? optionsFor(b) : [],
      payments: payments.rows.map((p) => ({
        id: p.id, amountKes: p.amount_kes, receipt: p.mpesa_receipt?.startsWith('UNKNOWN-') ? null : p.mpesa_receipt,
        paidAt: p.confirmed_at?.toISOString() ?? null, purpose: p.purpose,
      })),
      instalments: instalments.rows.map((i) => ({ seq: i.seq, amountKes: i.amount_kes, paidKes: i.paid_kes, dueDate: i.due_date, status: i.status })),
      nextPayment: (() => {
        const next = instalments.rows.find((i) => i.status === 'due' || i.status === 'overdue');
        return next ? { amountKes: next.amount_kes - next.paid_kes, dueDate: next.due_date } : null;
      })(),
    };
  }

  /** "Create account after payment": attach a guest booking to the signed-in traveller with the same phone. */
  async function claimBooking(bookingId, user) {
    const { rowCount } = await need().query(
      `update bookings set user_id = $2 where id = $1 and user_id is null and phone = $3`,
      [bookingId, user.id, String(user.phone || '').replace(/^\+/, '')],
    );
    return rowCount === 1;
  }

  async function bookingOwner(bookingId) {
    const { rows } = await need().query('select id, user_id from bookings where id = $1', [bookingId]);
    return rows[0] || null;
  }

  /** Which booking a payment belongs to (to check access before anything else). */
  async function paymentBookingId(paymentId) {
    const { rows } = await need().query('select booking_id from payments where id = $1', [paymentId]);
    return rows[0]?.booking_id || null;
  }

  return { startPayment, handleCallback, getPayment, reconcilePending, bookingSummary, claimBooking, bookingOwner, paymentBookingId, settle };
}

module.exports = { createPaymentService, PaymentError };
