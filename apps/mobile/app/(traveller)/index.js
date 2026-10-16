import { Redirect } from 'expo-router';
import { useSettings } from '../../src/state/settings';

/** The app opens on the tabs of the mode last used (the root layout sends signed-out users to sign-in). */
export default function Index() {
  const mode = useSettings((s) => s.mode);
  if (mode === 'provider') return <Redirect href="/requests" />;
  if (mode === 'agency') return <Redirect href="/packages" />;
  return <Redirect href="/explore" />;
}
