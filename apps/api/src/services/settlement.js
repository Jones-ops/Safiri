/**
 * Money leaving the platform: trips that have ended are recognised (the prepayment becomes
 * provider, agency and platform money), providers are paid what they are owed by M-PESA B2C,
 * and approved refunds go back to travellers by B2C. Daraja reports B2C outcomes later on a
 * result callback, matched by ConversationID; only then is the ledger updated.
 */
const { parseB2cResult } = require('../integrations/daraja');

function createSettlementService({ db, daraja, log }) {
  return {
    /** Job (daily): fully paid trips whose last day has passed become completed. */
    async completeEndedTrips({ today }) {
      const { rows } = await db.query(`select id from bookings where status = 'fully_paid' and end_date < $1::date`, [today]);
      let done = 0;
      for (const b of rows) {
        const outcome = (await db.query('select complete_booking($1) as o', [b.id])).rows[0].o;
        if (outcome === 'completed') done += 1;
      }
      return done;
    },

    /** Job (weekly): one B2C payment per provider with a balance owed. */
    async runPayouts() {
      if (!daraja.b2cConfigured) return 0;
      const { rows } = await db.query(
        `select pr.id, pr.name, pr.payout_msisdn, pb.owed_kes
           - coalesce((select sum(amount_kes) from payouts po where po.provider_id = pr.id and po.status in ('scheduled', 'processing')), 0)::int as due_kes
         from providers pr join private.provider_balances pb on pb.provider_id = pr.id
         where pr.payout_msisdn is not null`,
      );
      let sent = 0;
      for (const p of rows.filter((r) => r.due_kes > 0)) {
        const payout = await db.query(
          `insert into payouts (provider_id, amount_kes, method, msisdn, status) values ($1, $2, 'mpesa_b2c', $3, 'processing') returning id`,
          [p.id, p.due_kes, p.payout_msisdn],
        );
        const id = payout.rows[0].id;
        try {
          const r = await daraja.b2cPay({ msisdn: p.payout_msisdn, amountKes: p.due_kes, reference: id, remarks: `Safiri payout ${p.name}`, occasion: 'payout' });
          await db.query(`update payouts set conversation_id = $2 where id = $1`, [id, r.conversationId]);
          sent += 1;
        } catch (err) {
          log.error({ err, payoutId: id }, 'B2C payout request failed');
          await db.query(`update payouts set status = 'failed', failure_reason = $2 where id = $1`, [id, String(err.message).slice(0, 200)]);
        }
      }
      return sent;
    },

    /** Job (every 30 minutes): approved refunds go back by B2C. */
    async runRefunds() {
      if (!daraja.b2cConfigured) return 0;
      const { rows } = await db.query(`select id, amount_kes, msisdn from refunds where status = 'pending' and msisdn is not null order by created_at limit 50`);
      let sent = 0;
      for (const r of rows) {
        await db.query(`update refunds set status = 'processing' where id = $1`, [r.id]);
        try {
          const res = await daraja.b2cPay({ msisdn: r.msisdn, amountKes: r.amount_kes, reference: r.id, remarks: 'Safiri refund', occasion: 'refund' });
          await db.query(`update refunds set conversation_id = $2 where id = $1`, [r.id, res.conversationId]);
          sent += 1;
        } catch (err) {
          log.error({ err, refundId: r.id }, 'B2C refund request failed');
          await db.query(`update refunds set status = 'pending' where id = $1`, [r.id]); // try again next run
        }
      }
      return sent;
    },

    /** Daraja's B2C result callback (payouts and refunds). Idempotent. */
    async handleB2cResult(body) {
      const result = parseB2cResult(body);
      const logged = await db.query('insert into mpesa_b2c_results (conversation_id, body) values ($1, $2) returning id', [result?.conversationId || null, JSON.stringify(body ?? null)]);
      const setOutcome = (o) => db.query('update mpesa_b2c_results set outcome = $2 where id = $1', [logged.rows[0].id, o]).then(() => o);
      if (!result) return setOutcome('ignored');

      const payout = await db.query(`select id, status from payouts where conversation_id = $1 or id::text = $2`, [result.conversationId, result.originatorConversationId || '']);
      if (payout.rows[0]) {
        if (result.succeeded) return setOutcome(await settle('payout', payout.rows[0].id, result.receipt));
        await db.query(`update payouts set status = 'failed', failure_reason = $2 where id = $1 and status <> 'paid'`, [payout.rows[0].id, result.resultDesc]);
        return setOutcome('payout_failed');
      }
      const refund = await db.query(`select id, status from refunds where conversation_id = $1 or id::text = $2`, [result.conversationId, result.originatorConversationId || '']);
      if (refund.rows[0]) {
        if (result.succeeded) return setOutcome(await settle('refund', refund.rows[0].id, result.receipt));
        await db.query(`update refunds set status = 'failed' where id = $1 and status <> 'paid'`, [refund.rows[0].id]);
        return setOutcome('refund_failed');
      }
      return setOutcome('unknown');

      async function settle(kind, id, receipt) {
        const fn = kind === 'payout' ? 'settle_payout' : 'settle_refund';
        const o = (await db.query(`select ${fn}($1, $2) as o`, [id, receipt || `UNKNOWN-${result.conversationId}`])).rows[0].o;
        return `${kind}_${o}`;
      }
    },
  };
}

module.exports = { createSettlementService };
