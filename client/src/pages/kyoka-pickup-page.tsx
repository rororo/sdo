import { PickupListPage, type PickupListPageProps } from './pickup-list-page.tsx';

export function KyokaPickupPage(props: Omit<PickupListPageProps, 'mode'>) {
  return <PickupListPage {...props} mode='kyoka' />;
}
