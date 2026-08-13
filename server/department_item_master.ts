import { parseCsv } from './csv.ts';

export interface DepartmentItemAttributes {
  gender: string;
  ageGroup: string;
  sportCategory: string;
  spike: string;
}

const CSV_HEADERS = [
  'key',
  'department',
  'department_name',
  'category',
  'category_name',
  'item',
  'item_name',
  'gender',
  'age_group',
  'sport_category',
  'spike',
] as const;

export function parseDepartmentItemMasterCsv(
  text: string,
): Readonly<Record<string, DepartmentItemAttributes>> {
  const records = parseCsv(text, '固定マスタCSV');
  const header = records.shift();
  if (
    !header || header.length !== CSV_HEADERS.length ||
    header.some((value, index) => value !== CSV_HEADERS[index])
  ) {
    throw new Error(`固定マスタCSVのヘッダーは「${CSV_HEADERS.join(',')}」にしてください。`);
  }

  const master: Record<string, DepartmentItemAttributes> = {};
  records.forEach((record, index) => {
    const csvRow = index + 2;
    if (record.length !== CSV_HEADERS.length) {
      throw new Error(`固定マスタCSVの${csvRow}行目は${CSV_HEADERS.length}列必要です。`);
    }
    const [key, department, , category, , item, , gender, ageGroup, sportCategory, spike] = record;
    if (!key || !department || !category || !item || !gender || !ageGroup || !sportCategory) {
      throw new Error(`固定マスタCSVの${csvRow}行目に必須項目の空欄があります。`);
    }
    if (![key, department, category, item].every((value) => /^\d+$/.test(value!))) {
      throw new Error(`固定マスタCSVの${csvRow}行目のコードは数字で入力してください。`);
    }
    if (key !== `${department}${category}${item}`) {
      throw new Error(`固定マスタCSVの${csvRow}行目のkeyが部門・品種・品目と一致しません。`);
    }
    if (master[key]) {
      throw new Error(`固定マスタCSVの${csvRow}行目でkey「${key}」が重複しています。`);
    }
    master[key] = Object.freeze({
      gender,
      ageGroup,
      sportCategory,
      spike: spike ?? '',
    });
  });

  if (Object.keys(master).length === 0) throw new Error('固定マスタCSVにデータがありません。');
  return Object.freeze(master);
}

const masterCsvUrl = new URL('./data/department_item_master.csv', import.meta.url);
export const DEPARTMENT_ITEM_MASTER = parseDepartmentItemMasterCsv(
  Deno.readTextFileSync(masterCsvUrl),
);
