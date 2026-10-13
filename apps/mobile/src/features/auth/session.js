/**
 * Signed-in state. Browsing never needs an account; sign-in (phone OTP) is offered after
 * payment and from Profile, as the design specifies.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { identify, resetAnalytics } from '../../analytics';
import { syncAfterSignIn } from './sync';

const SessionContext = createContext({ session: null, ready: true });

export function SessionProvider({ children }) {
  const [state, setState] = useState({ session: null, ready: !supabase });

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, ready: true });
      if (event === 'SIGNED_IN' && session) {
        identify(session.user.id);
        // Fire and forget: it retries on the next sign-in if the network drops.
        syncAfterSignIn(session.user.id).catch(() => {});
      }
      if (event === 'SIGNED_OUT') resetAnalytics();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
