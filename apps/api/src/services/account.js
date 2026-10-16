/**
 * The traveller's account: export and deletion (Kenya Data Protection Act 2019), and referral
 * codes. A referral gives the new traveller a discount on their first booking, once, and the
 * referrer a one-use code of the same value once that booking confirms.
 */
const crypto = require('node:crypto');
const { asUser } = require('../lib/roles');

const REFERRAL_KES = 500;
const REFERRAL_MAX_USES = 10;
const REFERRAL_DAYS = 180;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class AccountError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function newCode(length = 8) {
  return Array.from(crypto.randomBytes(length), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function createAccountService({ db, supabase, log }) {
  return {
    /** Everything we hold about this person, as JSON they can keep. */
    async exportData(userId) {
      const one = async (sql) => (await db.query(sql, [userId])).rows;
      const [profile, consents, bookings, payments, reviews, referrals, notifications] = await Promise.all([
        one(`select email, phone, name, roles::text[], language, low_data, created_at from profiles where user_id = $1`),
        one(`select purpose::text, granted_at, withdrawn_at, notice_version from consents where user_id = $1`),
        one(`select ref, status::text, start_date::text, end_date::text, travellers, total_kes, paid_kes, discount_kes, created_at from bookings where user_id = $1 order by created_at`),
        one(`select b.ref, p.amount_kes, p.status::text, p.mpesa_receipt, p.confirmed_at from payments p join bookings b on b.id = p.booking_id where b.user_id = $1 and p.status = 'succeeded' order by p.confirmed_at`),
        one(`select rating, body, status::text, created_at from reviews where user_id = $1`),
        one(`select code, discount_kes, max_uses, expires_at, (select count(*) from referral_redemptions rr where rr.referral_id = r.id) as used from referrals r where owner_id = $1`),
        one(`select channel::text, template, status::text, sent_at from notifications where user_id = $1 order by created_at desc limit 200`),
      ]);
      return { exportedAt: new Date().toISOString(), profile: profile[0] || null, consents, bookings, payments, reviews, referrals, notifications };
    },

    /**
     * Deletes the account. Booking and payment records stay (tax and consumer law, 7 years)
     * without the link to the person; everything else goes, then the sign-in itself.
     */
    async deleteAccount(userId) {
      await asUser(db, userId, (client) => client.query('select anonymise_account($1)', [userId]));
      if (supabase) {
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) log.error({ err: error, userId }, 'auth user could not be deleted after anonymising');
      }
    },

    /** The traveller's own referral code (made on first ask). */
    async myReferral(userId) {
      let { rows } = await db.query(
        `select id, code, discount_kes, max_uses, expires_at, (select count(*)::int from referral_redemptions rr where rr.referral_id = r.id) as used
         from referrals r where owner_id = $1 and max_uses > 1 order by created_at desc limit 1`,
        [userId],
      );
      if (!rows[0]) {
        for (let tries = 0; tries < 5 && !rows[0]; tries++) {
          const inserted = await db.query(
            `insert into referrals (owner_id, code, discount_kes, max_uses, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5))
             on conflict (code) do nothing returning id, code, discount_kes, max_uses, expires_at, 0 as used`,
            [userId, newCode(), REFERRAL_KES, REFERRAL_MAX_USES, REFERRAL_DAYS],
          );
          rows = inserted.rows;
        }
      }
      const r = rows[0];
      const rewards = await db.query(
        `select code, discount_kes, expires_at from referrals where owner_id = $1 and max_uses = 1 and expires_at > now()
           and not exists (select 1 from referral_redemptions rr where rr.referral_id = referrals.id) order by created_at desc`,
        [userId],
      );
      return { code: r.code, discountKes: r.discount_kes, usesLeft: r.max_uses - r.used, expiresAt: r.expires_at, rewards: rewards.rows.map((x) => ({ code: x.code, discountKes: x.discount_kes, expiresAt: x.expires_at })) };
    },

    /**
     * Can this code discount this user's booking? Null when it cannot (wrong code, expired, used
     * up, their own code, or they already booked / redeemed before: it is for new travellers).
     */
    async referralFor(code, userId) {
      if (!code) return null;
      const { rows } = await db.query(
        `select r.id, r.owner_id, r.discount_kes from referrals r
         where r.code = upper($1) and r.expires_at > now()
           and (select count(*) from referral_redemptions rr where rr.referral_id = r.id) < r.max_uses`,
        [code],
      );
      const r = rows[0];
      if (!r || !userId || r.owner_id === userId) return null;
      const prior = await db.query(
        `select 1 from referral_redemptions where user_id = $1
         union all select 1 from bookings where user_id = $1 and status in ('confirmed', 'fully_paid', 'completed') limit 1`,
        [userId],
      );
      return prior.rowCount ? null : { referralId: r.id, ownerId: r.owner_id, discountKes: r.discount_kes };
    },

    /** Records the redemption when a discounted quote is held (unique per user: once ever). */
    async redeem({ quoteId, bookingId, userId }) {
      const { rows } = await db.query('select referral_id, discount_kes from quotes where id = $1', [quoteId]);
      const q = rows[0];
      if (!q?.referral_id || !userId) return false;
      const res = await db.query(
        `insert into referral_redemptions (referral_id, user_id, booking_id, discount_kes) values ($1, $2, $3, $4) on conflict (user_id) do nothing returning id`,
        [q.referral_id, userId, bookingId, q.discount_kes],
      );
      return res.rowCount === 1;
    },

    /** Once the referred booking confirms, the referrer gets a one-use code worth the same. */
    async rewardOnConfirm(bookingId) {
      const { rows } = await db.query(
        `select rr.id, r.owner_id, r.discount_kes from referral_redemptions rr join referrals r on r.id = rr.referral_id
         where rr.booking_id = $1 and rr.rewarded_at is null`,
        [bookingId],
      );
      for (const rr of rows) {
        const reward = await db.query(
          `insert into referrals (owner_id, code, discount_kes, max_uses, expires_at) values ($1, $2, $3, 1, now() + make_interval(days => $4)) returning id`,
          [rr.owner_id, newCode(), rr.discount_kes, REFERRAL_DAYS],
        );
        await db.query('update referral_redemptions set rewarded_at = now(), reward_referral_id = $2 where id = $1', [rr.id, reward.rows[0].id]);
      }
      return rows.length;
    },

    REFERRAL_KES,
  };
}

module.exports = { createAccountService, AccountError };
