/** Profile reads for the API (service role). */
function createProfilesService(supabase) {
  return {
    async getByUserId(userId) {
      if (!supabase) throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, email, phone, name, roles, language, low_data')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

module.exports = { createProfilesService };
