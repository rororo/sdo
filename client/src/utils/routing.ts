export type View = 'products' | 'pickup' | 'kyoka' | 'kyokaProducts';

export const VIEW_PATHS: Record<View, string> = {
  products: '/products',
  kyokaProducts: '/kyoka-products',
  pickup: '/pickup-list',
  kyoka: '/kyoka-pickup-list',
};

export function viewFromPathname(pathname: string): View | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (normalized === VIEW_PATHS.kyokaProducts) return 'kyokaProducts';
  if (normalized === VIEW_PATHS.products) return 'products';
  if (normalized === VIEW_PATHS.pickup) return 'pickup';
  if (normalized === VIEW_PATHS.kyoka) return 'kyoka';
  return null;
}
