/**
 * Who may see or act on a booking: its signed-in owner, or whoever holds the booking's token
 * (guests). Answers false for unknown ids too, so a stranger can't tell a booking exists.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createBookingAccess({ payments, holds }) {
  return async function mayAccess(request, bookingId, token) {
    if (!UUID.test(String(bookingId))) return false;
    const owner = await payments.bookingOwner(bookingId);
    if (!owner) return false;
    if (owner.user_id && request.user?.id === owner.user_id) return true;
    return holds.tokenMatches(bookingId, token);
  };
}

module.exports = { createBookingAccess, UUID };
