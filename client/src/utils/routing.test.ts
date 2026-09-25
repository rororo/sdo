import { assertEquals } from '@std/assert';
import { VIEW_PATHS, viewFromPathname } from './routing.ts';

Deno.test('画面ごとにURLを割り当てる', () => {
  assertEquals(VIEW_PATHS.products, '/products');
  assertEquals(VIEW_PATHS.pickup, '/pickup-list');
  assertEquals(viewFromPathname('/products'), 'products');
  assertEquals(viewFromPathname('/pickup-list'), 'pickup');
});

Deno.test('末尾のスラッシュを許容し、未定義のURLを判別する', () => {
  assertEquals(viewFromPathname('/products/'), 'products');
  assertEquals(viewFromPathname('/pickup-list/'), 'pickup');
  assertEquals(viewFromPathname('/'), null);
  assertEquals(viewFromPathname('/unknown'), null);
});
