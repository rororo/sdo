export type View = 'products' | 'pickup';

export const VIEW_PATHS: Record<View, string> = {
  products: '/products',
  pickup: '/pickup-list',
};

export function viewFromPathname(pathname: string): View | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (normalized === VIEW_PATHS.products) return 'products';
  if (normalized === VIEW_PATHS.pickup) return 'pickup';
  return null;
}
