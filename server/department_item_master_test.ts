import { assertEquals, assertThrows } from '@std/assert';
import { DEPARTMENT_ITEM_MASTER, parseDepartmentItemMasterCsv } from './department_item_master.ts';

const HEADER =
  'key,department,department_name,category,category_name,item,item_name,gender,age_group,sport_category,spike';

Deno.test('fixed master CSV contains all approved mappings', () => {
  assertEquals(Object.keys(DEPARTMENT_ITEM_MASTER).length, 551);
  assertEquals(DEPARTMENT_ITEM_MASTER['30212'], {
    gender: 'Male',
    ageGroup: 'Adult',
    sportCategory: 'Ski',
    spike: '',
  });
});

Deno.test('fixed master CSV rejects duplicate keys', () => {
  const row = '30212,302,部門,1,品種,2,品目,Male,Adult,Ski,';
  assertThrows(
    () => parseDepartmentItemMasterCsv(`${HEADER}\n${row}\n${row}`),
    Error,
    'key「30212」が重複しています',
  );
});

Deno.test('fixed master CSV rejects a key that does not match its codes', () => {
  const row = '99999,302,部門,1,品種,2,品目,Male,Adult,Ski,';
  assertThrows(
    () => parseDepartmentItemMasterCsv(`${HEADER}\n${row}`),
    Error,
    'keyが部門・品種・品目と一致しません',
  );
});
