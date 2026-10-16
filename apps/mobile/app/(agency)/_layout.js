/** Agency (and admin) mode: Packages, Bookings, Providers, Payouts. */
import { ModeTabs } from '../../src/components/ModeTabs';

const TABS = [
  { name: 'packages', icon: 'briefcase' },
  { name: 'bookings', icon: 'list' },
  { name: 'providers', icon: 'people' },
  { name: 'agency-payouts', icon: 'cash' },
];

export default function AgencyTabs() {
  return <ModeTabs tabs={TABS} hidden={['index']} />;
}
