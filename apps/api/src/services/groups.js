/**
 * Group split (Slice 3c). The organiser splits a held booking into shares; each friend pays
 * their own share by M-PESA from an invite link (no app needed). The booking confirms when
 * paid shares cover the deposit; the rest is due by the final due date. A friend who doesn't
 * pay can be covered by the organiser (their unpaid amount moves to the organiser's share).
 */
const crypto = require('node:crypto');
const { DEFAULTS, GROUP_HOLD_MINUTES, buildSchedule, checkShares, splitEqually, todayInKenya } = require('@safiri/shared');

const SPLIT_ERRORS = {
  booking_not_found: 404,
  not_splittable: 409,
  hold_expired: 410,
  already_paid: 409,
  too_many_people: 422,
  organiser_is_friend: 422,
  no_shares: 422,
  invalid_share: 422,
  share_over_limit: 422,
  shares_do_not_add_up: 422,
  member_not_found: 404,
  not_coverable: 409,
  payment_in_progress: 409,
};

class GroupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.status = SPLIT_ERRORS[code] || 400;
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** 12 random characters: unguessable, and short enough to read in a WhatsApp message. */
function inviteCode() {
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

const maskPhone = (msisdn) => `0${msisdn.slice(3, 6)} *** ${msisdn.slice(-3)}`;

function createGroupService({ db, baseUrl, now = () => new Date() }) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const inviteUrl = (code) => `${base}/i/${code}`;

  async function createSplit({ bookingId, organiserName, friends, shares }) {
    const client = await db.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `select b.*, b.start_date::text as start_iso, (b.hold_expires_at > now()) as hold_live,
                coalesce(p.deposit_pct, $2) as deposit_pct, coalesce(p.instalments, $3) as instalment_count,
                coalesce(p.final_due_days, $4) as final_due_days, coalesce(p.grace_days, 2) as grace_days
         from bookings b left join packages p on p.id = b.package_id where b.id = $1 for update of b`,
        [bookingId, DEFAULTS.DEPOSIT_PCT, DEFAULTS.INSTALMENT_COUNT, DEFAULTS.FINAL_DUE_DAYS],
      );
      const b = rows[0];
      if (!b) throw new GroupError('booking_not_found');
      if (b.status !== 'held' || b.is_group) throw new GroupError('not_splittable');
      if (!b.hold_live) throw new GroupError('hold_expired');
      if (b.paid_kes > 0) throw new GroupError('already_paid');
      const pending = await client.query(`select 1 from payments where booking_id = $1 and status in ('initiated', 'pending')`, [bookingId]);
      if (pending.rowCount) throw new GroupError('payment_in_progress');
      if (friends.length + 1 > b.travellers) throw new GroupError('too_many_people');
      if (friends.some((f) => f.phone === b.phone)) throw new GroupError('organiser_is_friend');

      const amounts = shares || splitEqually(b.total_kes, friends.length + 1);
      const problem = checkShares(amounts, b.total_kes);
      if (problem) throw new GroupError(problem);

      // Confirm on the deposit as for a normal booking; too close to travel, everyone pays in full.
      const today = todayInKenya(now());
      const schedule = buildSchedule({
        totalKes: b.total_kes, depositPct: b.deposit_pct, instalmentCount: b.instalment_count,
        today, startDate: b.start_iso, finalDueDays: b.final_due_days,
      });
      await client.query(
        `insert into payment_plans (booking_id, deposit_kes, instalment_count, final_due_date, grace_days) values ($1, $2, 0, $3, $4)`,
        [bookingId, schedule.depositKes, schedule.finalDueDate, b.grace_days],
      );

      const people = [{ name: organiserName, phone: b.phone, organiser: true, userId: b.user_id }, ...friends.map((f) => ({ ...f, organiser: false, userId: null }))];
      for (const [i, person] of people.entries()) {
        await client.query(
          `insert into group_members (booking_id, user_id, name, phone, share_kes, invite_code, is_organiser)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [bookingId, person.userId, person.name, person.phone, amounts[i], inviteCode(), person.organiser],
        );
      }
      // Friends need time to pay: the hold grows from 15 to 60 minutes.
      await client.query(
        `update bookings set is_group = true, hold_expires_at = greatest(hold_expires_at, now() + make_interval(mins => $2)) where id = $1`,
        [bookingId, GROUP_HOLD_MINUTES],
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return groupStatus(bookingId);
  }

  /** The organiser's live view: who has paid what, and each friend's invite link. */
  async function groupStatus(bookingId) {
    const { rows } = await db.query(
      `select b.ref, b.status, b.total_kes, b.paid_kes, b.travellers, b.hold_expires_at,
              b.start_date::text as start_date, b.end_date::text as end_date, coalesce(p.title, d.name) as title,
              pp.deposit_kes, pp.final_due_date::text as final_due_date
       from bookings b
       left join packages p on p.id = b.package_id
       left join quotes q on q.id = b.quote_id
       left join destinations d on d.id = q.destination_id
       left join payment_plans pp on pp.booking_id = b.id
       where b.id = $1 and b.is_group`,
      [bookingId],
    );
    const g = rows[0];
    if (!g) return null;
    const members = await db.query(
      `select id, name, phone, share_kes, paid_kes, status, is_organiser, invite_code
       from group_members where booking_id = $1 order by is_organiser desc, created_at`,
      [bookingId],
    );
    return {
      bookingId,
      ref: g.ref,
      title: g.title,
      status: g.status,
      startDate: g.start_date,
      endDate: g.end_date,
      travellers: g.travellers,
      totalKes: g.total_kes,
      paidKes: g.paid_kes,
      depositKes: g.deposit_kes,
      // Before confirmation the deadline is the hold; after, the final due date.
      deadline: g.status === 'held' ? g.hold_expires_at?.toISOString() ?? null : g.final_due_date,
      members: members.rows.map((m) => ({
        id: m.id,
        name: m.name,
        phone: maskPhone(m.phone),
        shareKes: m.share_kes,
        paidKes: m.paid_kes,
        status: m.paid_kes >= m.share_kes && m.share_kes > 0 ? 'paid' : m.status === 'removed' ? 'removed' : 'not_paid',
        isOrganiser: m.is_organiser,
        inviteUrl: inviteUrl(m.invite_code),
      })),
    };
  }

  /** What a friend sees when they open their invite link. */
  async function inviteTarget(code) {
    if (!/^[A-Za-z0-9]{8,16}$/.test(String(code || ''))) return null;
    const { rows } = await db.query(
      `select m.id as member_id, m.name, m.phone, m.share_kes, m.paid_kes, m.status as member_status, m.is_organiser,
              b.id as booking_id, b.ref, b.status, b.hold_expires_at, (b.hold_expires_at > now()) as hold_live,
              b.start_date::text as start_date, b.end_date::text as end_date, coalesce(p.title, d.name) as title,
              (select name from group_members o where o.booking_id = b.id and o.is_organiser) as organiser_name,
              pp.final_due_date::text as final_due_date
       from group_members m
       join bookings b on b.id = m.booking_id
       left join packages p on p.id = b.package_id
       left join quotes q on q.id = b.quote_id
       left join destinations d on d.id = q.destination_id
       left join payment_plans pp on pp.booking_id = b.id
       where m.invite_code = $1`,
      [code],
    );
    const t = rows[0];
    if (!t) return null;
    const leftKes = Math.max(0, t.share_kes - t.paid_kes);
    const open = (t.status === 'held' && t.hold_live) || t.status === 'confirmed';
    return {
      memberId: t.member_id,
      bookingId: t.booking_id,
      ref: t.ref,
      title: t.title,
      startDate: t.start_date,
      endDate: t.end_date,
      organiserName: t.organiser_name,
      name: t.name,
      isOrganiser: t.is_organiser,
      msisdn: t.phone,
      phone: maskPhone(t.phone),
      shareKes: t.share_kes,
      paidKes: t.paid_kes,
      leftKes,
      bookingStatus: t.status,
      deadline: t.status === 'held' ? t.hold_expires_at?.toISOString() ?? null : t.final_due_date,
      payable: open && t.member_status !== 'removed' && leftKes > 0,
    };
  }

  async function cover(bookingId, memberId) {
    const { rows } = await db.query('select booking_id from group_members where id = $1', [memberId]);
    if (rows[0]?.booking_id !== bookingId) throw new GroupError('member_not_found');
    try {
      return (await db.query('select cover_share($1) as moved', [memberId])).rows[0].moved;
    } catch (err) {
      if (SPLIT_ERRORS[err.message]) throw new GroupError(err.message);
      throw err;
    }
  }

  return { createSplit, groupStatus, inviteTarget, cover };
}

module.exports = { createGroupService, GroupError };
