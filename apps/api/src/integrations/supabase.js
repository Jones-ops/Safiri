/**
 * Supabase with the service-role key. This key bypasses RLS, so it lives only here, in the API,
 * and never in the app bundle.
 */
const { createClient } = require('@supabase/supabase-js');

function createSupabaseAdmin({ url, serviceRoleKey }) {
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Verifies a user's access token and returns its claims (sub = user id), or null. */
function createTokenVerifier(supabase) {
  return async function verifyToken(token) {
    if (!supabase || !token) return null;
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims;
  };
}

module.exports = { createSupabaseAdmin, createTokenVerifier };
