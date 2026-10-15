/**
 * Sends a traveller message on every channel that applies, once:
 *   push      to the traveller's devices, when they are signed in on the app
 *   whatsapp  approved template, once WhatsApp is configured
 *   sms       backup: whenever WhatsApp isn't configured or fails
 * Each message is recorded in notifications first; unique indexes (per instalment, or per
 * booking for group reminders) make a second attempt a no-op, so jobs can run as often as they like.
 */
function createNotifier({ db, sms, push, whatsapp, log }) {
  /** Claims the right to send; false if this message already went out on this channel. */
  async function claim({ userId, phone, bookingId, instalmentId, kind, channel, template, payload }) {
    const { rows } = await db.query(
      `insert into notifications (user_id, phone, booking_id, instalment_id, kind, channel, template, payload, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
       on conflict do nothing
       returning id`,
      [userId, phone, bookingId, instalmentId, kind, channel, template, JSON.stringify(payload)],
    );
    return rows[0]?.id || null;
  }

  const record = (id, { error, providerId }) =>
    db.query(
      `update notifications set status = $2::notification_status, sent_at = case when $2::text = 'sent' then now() end,
              error = $3, provider_message_id = $4 where id = $1`,
      [id, error ? 'failed' : 'sent', error || null, providerId || null],
    );

  /**
   * @param {object} m
   * @param {string} m.kind  reminder_3d | reminder_1d | overdue | cancelled
   * @param {{ title: string, body: string, data: object }} m.push
   * @param {{ template: string, params: string[] }} m.whatsapp
   * @param {string} m.sms   full SMS text
   * @returns {string[]} channels that were sent
   */
  async function notify(m) {
    const base = { userId: m.userId, phone: m.phone, bookingId: m.bookingId, instalmentId: m.instalmentId, kind: m.kind };
    const sent = [];

    if (m.userId) {
      const tokens = (await db.query(`select token from push_tokens where user_id = $1 and disabled_at is null`, [m.userId])).rows.map((r) => r.token);
      if (tokens.length) {
        const id = await claim({ ...base, channel: 'push', template: m.kind, payload: m.push });
        if (id) {
          try {
            const result = await push.send({ to: tokens, ...m.push });
            if (result.deadTokens.length) await db.query(`update push_tokens set disabled_at = now() where token = any($1)`, [result.deadTokens]);
            await record(id, { error: result.sent ? null : 'no device accepted the push' });
            if (result.sent) sent.push('push');
          } catch (err) {
            await record(id, { error: err.message });
          }
        }
      }
    }

    let whatsappSent = false;
    if (whatsapp.configured) {
      const id = await claim({ ...base, channel: 'whatsapp', template: m.whatsapp.template, payload: m.whatsapp });
      if (id) {
        try {
          const r = await whatsapp.sendTemplate({ to: m.phone, template: m.whatsapp.template, language: m.language, params: m.whatsapp.params });
          await record(id, { providerId: r.id });
          whatsappSent = true;
          sent.push('whatsapp');
        } catch (err) {
          await record(id, { error: err.message });
          log.warn({ err }, 'WhatsApp failed; sending SMS instead');
        }
      } else {
        whatsappSent = true; // already went out on WhatsApp earlier
      }
    }

    if (!whatsappSent) {
      const id = await claim({ ...base, channel: 'sms', template: m.kind, payload: { message: m.sms } });
      if (id) {
        try {
          const r = await sms.send(`+${m.phone}`, m.sms);
          await record(id, { providerId: r.id });
          sent.push('sms');
        } catch (err) {
          await record(id, { error: err.message });
        }
      }
    }
    return sent;
  }

  return { notify };
}

module.exports = { createNotifier };
