import { Redirect } from 'expo-router';

/** The app opens on Explore. */
export default function Index() {
  return <Redirect href="/explore" />;
}
