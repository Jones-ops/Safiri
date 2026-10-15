/**
 * The payment schedule a traveller signs up to at checkout, fitted to the time left before
 * travel. The final payment is due finalDueDays before the trip; instalments are at least a
 * week apart, so a trip booked close to the date has fewer instalments, and one booked inside
 * a week of the final due date is paid in full.
 */
const { paymentSchedule } = require('./money');
const { addDays, daysBetween } = require('./trip');

const MIN_DAYS_BETWEEN_PAYMENTS = 7;

/**
 * @returns {{ payInFullOnly: boolean, depositKes: number, finalDueDate: string,
 *             payments: { seq: number, amountKes: number, dueDate: string }[] }}
 *   payments[0] is what is paid today (the deposit, or everything).
 */
function buildSchedule({ totalKes, depositPct, instalmentCount, today, startDate, finalDueDays }) {
  const finalDueDate = addDays(startDate, -finalDueDays);
  const daysToFinal = daysBetween(today, finalDueDate);
  const count = Math.min(instalmentCount, Math.max(0, Math.floor(daysToFinal / MIN_DAYS_BETWEEN_PAYMENTS)));

  if (count === 0) {
    return { payInFullOnly: true, depositKes: totalKes, finalDueDate: today, payments: [{ seq: 0, amountKes: totalKes, dueDate: today }] };
  }
  const plan = paymentSchedule({ totalKes, depositPct, instalmentCount: count });
  return {
    payInFullOnly: false,
    depositKes: plan.depositKes,
    finalDueDate,
    payments: [
      { seq: 0, amountKes: plan.depositKes, dueDate: today },
      ...plan.instalments.map((amountKes, i) => ({
        seq: i + 1,
        amountKes,
        dueDate: addDays(today, Math.round(((i + 1) * daysToFinal) / count)),
      })),
    ],
  };
}

module.exports = { buildSchedule, MIN_DAYS_BETWEEN_PAYMENTS };
