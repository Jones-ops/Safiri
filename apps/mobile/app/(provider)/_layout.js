/** Provider mode: Requests, Calendar, Prices, Payouts. */
import { ModeTabs } from '../../src/components/ModeTabs';

const TABS = [
  { name: 'requests', icon: 'notifications' },
  { name: 'calendar', icon: 'calendar' },
  { name: 'prices', icon: 'pricetag' },
  { name: 'payouts', icon: 'cash' },
];

export default function ProviderTabs() {
  return <ModeTabs tabs={TABS} hidden={['index']} />;
}
