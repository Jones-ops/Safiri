/**
 * Runs payment plans. tick({ today }) is called by a daily job (08:00 Nairobi) and does:
 *   1. instalments past their due date become overdue
 *   2. reminders 3 days and 1 day before each due date, and once when overdue, each with a
 *      one-tap M-PESA pay link (push + WhatsApp, SMS backup)
 *   3. bookings whose final payment is still missing after the grace period are cancelled:
 *      rooms go back on sale and the refund the cancellation policy allows is recorded
 * "today" is passed in, never read from the clock, so tests can fast-forward a whole plan.
 */
const { daysBetween, formatAmount, refundFor } = require('@safiri/shared');
const { translator } = require('../web/i18n');

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};
const shortDate = (iso, lang) => `${Number(iso.slice(8, 10))} ${(MONTHS[lang] || MONTHS.en)[Number(iso.slice(5, 7)) - 1]}`;

// WhatsApp template names, as submitted for approval (PAPERWORK.md).
const TEMPLATES = { reminder_3d: 'payment_reminder', reminder_1d: 'payment_reminder', overdue: 'payment_overdue', cancelled: 'booking_cancelled' };

function createPlanRunner({ db, notifier, payLinks, baseUrl, log }) {
  const base = String(baseUrl || '').replace(/\/$/, '');

  async function markOverdue(today) {
    const { rowCount } = await db.query(
      `update instalments i set status = 'overdue'
       from bookings b
       where b.id = i.booking_id and b.status = 'confirmed' and i.status = 'due' and i.due_date < $1::date`,
      [today],
    );
    return rowCount;
  }

  async function sendReminders(today) {
    const { rows } = await db.query(
      `select i.id, i.amount_kes - i.paid_kes as amount, i.due_date::text as due, i.status,
              (i.due_date - $1::date) as days_left,
              b.id as booking_id, b.ref, b.phone, b.user_id, coalesce(pr.language, 'en') as language,
              (pp.final_due_date + pp.grace_days)::text as deadline
       from instalments i
       join bookings b on b.id = i.booking_id and b.status = 'confirmed'
       join payment_plans pp on pp.id = i.plan_id
       left join profiles pr on pr.phone = b.phone
       where (i.status = 'due' and (i.due_date - $1::date) in (3, 1))
          or i.status = 'overdue'
       order by i.due_date`,
      [today],
    );
    let sent = 0;
    for (const r of rows) {
      const kind = r.status === 'overdue' ? 'overdue' : r.days_left === 3 ? 'reminder_3d' : 'reminder_1d';
      const t = translator(r.language);
      const link = `${base}/pay/${payLinks.codeFor(r.id)}`;
      const vars = {
        amount: formatAmount(r.amount),
        ref: r.ref,
        date: shortDate(r.due, r.language),
        deadline: shortDate(r.deadline, r.language),
        link,
      };
      const channels = await notifier.notify({
        kind,
        language: r.language,
        userId: r.user_id,
        phone: r.phone,
        bookingId: r.booking_id,
        instalmentId: r.id,
        sms: t(kind === 'overdue' ? 'sms.overdue' : 'sms.reminder', vars),
        whatsapp: { template: TEMPLATES[kind], params: kind === 'overdue' ? [vars.amount, vars.ref, vars.date, vars.deadline, link] : [vars.amount, vars.ref, vars.date, link] },
        push: {
          title: t(kind === 'overdue' ? 'push.overdueTitle' : 'push.reminderTitle', vars),
          body: t(kind === 'overdue' ? 'push.overdueBody' : 'push.reminderBody', vars),
          data: { url: link, bookingId: r.booking_id },
        },
      });
      sent += channels.length;
    }
    return sent;
  }

  /** Group trips: 3 days and 1 day before the final due date, tell the organiser who still owes. */
  async function sendGroupReminders(today) {
    const { rows } = await db.query(
      `select b.id as booking_id, b.ref, b.phone, b.user_id, coalesce(pr.language, 'en') as language,
              pp.final_due_date::text as due, (pp.final_due_date - $1::date) as days_left,
              count(m.id)::int as owing, sum(m.share_kes - m.paid_kes)::int as amount
       from bookings b
       join payment_plans pp on pp.booking_id = b.id
       join group_members m on m.booking_id = b.id and not m.is_organiser and m.status <> 'removed' and m.paid_kes < m.share_kes
       left join profiles pr on pr.phone = b.phone
       where b.is_group and b.status = 'confirmed' and (pp.final_due_date - $1::date) in (3, 1)
       group by b.id, pr.language, pp.final_due_date`,
      [today],
    );
    let sent = 0;
    for (const r of rows) {
      const t = translator(r.language);
      const vars = { n: r.owing, amount: formatAmount(r.amount), ref: r.ref, date: shortDate(r.due, r.language) };
      const channels = await notifier.notify({
        kind: r.days_left === 3 ? 'group_unpaid_3d' : 'group_unpaid_1d',
        language: r.language,
        userId: r.user_id,
        phone: r.phone,
        bookingId: r.booking_id,
        instalmentId: null,
        sms: t('sms.groupUnpaid', vars),
        whatsapp: { template: 'share_unpaid', params: [String(r.owing), vars.amount, r.ref, vars.date] },
        push: { title: t('push.groupUnpaidTitle'), body: t('push.groupUnpaidBody', vars), data: { bookingId: r.booking_id, group: true } },
      });
      sent += channels.length;
    }
    return sent;
  }

  async function cancelMissed(today) {
    const { rows } = await db.query(
      `select b.id, b.ref, b.phone, b.user_id, b.paid_kes, b.start_date::text as start,
              (pp.final_due_date + pp.grace_days)::text as deadline,
              coalesce(p.cancel_policy, '[]'::jsonb) as policy, coalesce(pr.language, 'en') as language
       from bookings b
       join payment_plans pp on pp.booking_id = b.id
       left join packages p on p.id = b.package_id
       left join profiles pr on pr.phone = b.phone
       where b.status = 'confirmed' and b.paid_kes < b.total_kes
         and pp.final_due_date + pp.grace_days < $1::date`,
      [today],
    );
    let cancelled = 0;
    for (const b of rows) {
      // Refund per policy, counted from the day of cancellation to travel.
      const { refundKes } = refundFor(b.policy, daysBetween(today, b.start), b.paid_kes);
      const outcome = (await db.query('select cancel_booking($1, $2, $3) as o', [b.id, 'Final payment not made after the grace period', refundKes])).rows[0].o;
      if (outcome !== 'cancelled') continue;
      cancelled += 1;
      const t = translator(b.language);
      const vars = { ref: b.ref, deadline: shortDate(b.deadline, b.language), refund: formatAmount(refundKes) };
      await notifier.notify({
        kind: 'cancelled',
        language: b.language,
        userId: b.user_id,
        phone: b.phone,
        bookingId: b.id,
        instalmentId: null,
        sms: t('sms.cancelled', vars),
        whatsapp: { template: TEMPLATES.cancelled, params: [vars.ref, vars.deadline, vars.refund] },
        push: { title: t('push.cancelledTitle'), body: t('push.cancelledBody', vars), data: { bookingId: b.id } },
      }).catch((err) => log.error({ err, bookingId: b.id }, 'cancellation notice failed'));
    }
    return cancelled;
  }

  return {
    async tick({ today }) {
      const overdue = await markOverdue(today);
      const reminders = (await sendReminders(today)) + (await sendGroupReminders(today));
      const cancelled = await cancelMissed(today);
      return { today, overdue, reminders, cancelled };
    },
    /** The instalment a pay link points at (and the booking it belongs to). */
    async payLinkTarget(instalmentId) {
      const { rows } = await db.query(
        `select i.id, i.seq, i.status, i.due_date::text as due, b.id as booking_id, b.ref, b.status as booking_status, b.phone,
                b.start_date::text as start, b.end_date::text as end, coalesce(p.title, d.name) as title,
                (select amount_kes - paid_kes from instalments n where n.booking_id = b.id and n.status in ('due', 'overdue') order by n.seq limit 1) as next_kes,
                b.total_kes - b.paid_kes as balance_kes
         from instalments i
         join bookings b on b.id = i.booking_id
         left join packages p on p.id = b.package_id
         left join quotes q on q.id = b.quote_id
         left join destinations d on d.id = q.destination_id
         where i.id = $1`,
        [instalmentId],
      );
      return rows[0] || null;
    },
  };
}

module.exports = { createPlanRunner };
