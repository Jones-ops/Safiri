/**
 * After sign-in, copy what the user chose on the phone (consents, language, data saver)
 * to their account. RLS lets a user write only their own rows.
 */
import { supabase } from '../../lib/supabase';
import { useSettings } from '../../state/settings';
import { currentLanguage } from '../../i18n';

export async function syncAfterSignIn(userId) {
  if (!supabase) return;
  const { consents, lowData } = useSettings.getState();
  const now = new Date().toISOString();

  const { data: existing, error } = await supabase.from('consents').select('id, purpose, withdrawn_at, granted_at');
  if (error) throw error;
  const byPurpose = Object.fromEntries((existing || []).map((row) => [row.purpose, row]));

  for (const [purpose, granted] of Object.entries(consents)) {
    const row = byPurpose[purpose];
    if (!row) {
      if (granted) {
        const res = await supabase.from('consents').insert({ purpose, granted_at: now });
        if (res.error) throw res.error;
      }
      continue;
    }
    const currentlyGranted = Boolean(row.granted_at) && !row.withdrawn_at;
    if (currentlyGranted === granted) continue;
    const change = granted ? { granted_at: now, withdrawn_at: null } : { withdrawn_at: now };
    const res = await supabase.from('consents').update(change).eq('id', row.id);
    if (res.error) throw res.error;
  }

  const res = await supabase
    .from('profiles')
    .update({ language: currentLanguage(), low_data: lowData })
    .eq('user_id', userId);
  if (res.error) throw res.error;
}
