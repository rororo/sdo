import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseCsv } from '../utils/csv.ts';

export const STORE_INVENTORY_HEADERS = [
  'スキャンコード',
  '部門コード',
  '部門名',
  '３桁',
  '自社メーカー品番',
  'ブランド名',
  '商品名',
  '品種名',
  '品目名',
  '自社品番',
  'サイズ名',
  '店舗コード',
  '店舗名',
] as const;

export const SAFE_SIZE_HEADERS = [
  'EAN',
  'SAFESIZE ARTICLE',
  'BRAND',
  'Manufacturer shoe model ID with color code',
  'Commercial name of the shoe',
  'Female, Male, Unisex',
  'Adult, Child',
  'Size ',
  'SizeSys',
  'Sport category',
  'Season',
  'Style ID / Model Id / Article',
  'Retailer internal code',
  'SPIKE',
] as const;

// The zero-width spaces are present in the approved submission workbook headers.
export const PICKUP_LIST_HEADERS = [
  '部門',
  '部門名',
  '3桁',
  'メーカー品番',
  'ブランド\u200B',
  '商品名',
  '品種名\u200B',
  '品目名\u200B',
  '自社品番\u200B',
  '店舗',
  '店舗名',
] as const;

export const PICKUP_SUBMISSION_HEADERS = [
  'コメント',
  'ピックアップ',
  'スキャン',
  'データ登録',
  '返却',
  '完了済',
  'No.',
  ...PICKUP_LIST_HEADERS,
] as const;

export const TARGET_STORE_CODES = new Set(['10309', '10319', '10604']);

const OUTPUT_SHEET_NAME = 'ピックアップ';
const SUMMARY_SHEET_NAME = '集計表';
const TEMPLATE_FIRST_DATA_ROW = 3;
const TEMPLATE_LAST_DATA_ROW = 814;
const TEMPLATE_MAX_RECORDS = TEMPLATE_LAST_DATA_ROW - TEMPLATE_FIRST_DATA_ROW + 1;
const DUPLICATE_FORMATTING_RANGE = 'P1:P816 P893:P1048576';
const EMPTY_DUPLICATE_FORMATTING = `<conditionalFormatting sqref="${DUPLICATE_FORMATTING_RANGE}"/>`;
const DUPLICATE_FORMATTING = `<conditionalFormatting sqref="${DUPLICATE_FORMATTING_RANGE}">` +
  '<cfRule type="duplicateValues" dxfId="0" priority="1"/>' +
  '</conditionalFormatting>';

export interface StoreInventoryRecord {
  ean: string;
  department: string;
  departmentName: string;
  threeDigitCode: string;
  manufacturerModel: string;
  brand: string;
  productName: string;
  categoryName: string;
  itemName: string;
  internalCode: string;
  sizeName: string;
  storeCode: string;
  storeName: string;
}

export interface PickupListRecord {
  department: string;
  departmentName: string;
  threeDigitCode: string;
  manufacturerModel: string;
  brand: string;
  productName: string;
  categoryName: string;
  itemName: string;
  internalCode: string;
  storeCode: string;
  storeName: string;
}

export interface SafeSizeErrorData {
  eans: ReadonlySet<string>;
  inputRows: number;
  sheetName: string;
}

export class PickupListValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PickupListValidationError';
  }
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === 'object') {
    if ('result' in value) return textValue(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((run) =>
        typeof run === 'object' && run !== null && 'text' in run ? String(run.text) : ''
      ).join('');
    }
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

function normalizedHeader(value: unknown): string {
  return textValue(value)
    .normalize('NFKC')
    .replaceAll('\u200B', '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeEan(value: unknown, rowLabel: string): string {
  const source = textValue(value).normalize('NFKC').trim();
  const match = /^(\d+)(?:\.0+)?$/.exec(source);
  if (!match?.[1]) {
    throw new PickupListValidationError(`${rowLabel}のEANは数字のみで入力してください。`);
  }
  return match[1].padStart(13, '0');
}

export function parseStoreInventoryCsv(text: string): StoreInventoryRecord[] {
  const rows = parseCsv(text, '店舗在庫CSV');
  const header = rows.shift();
  if (
    !header || header.length !== STORE_INVENTORY_HEADERS.length ||
    header.some((value, index) =>
      normalizedHeader(value) !== normalizedHeader(STORE_INVENTORY_HEADERS[index])
    )
  ) {
    throw new PickupListValidationError(
      `店舗在庫CSVのヘッダーは「${STORE_INVENTORY_HEADERS.join('、')}」の順にしてください。`,
    );
  }

  const records: StoreInventoryRecord[] = [];
  rows.forEach((row, index) => {
    const csvRow = index + 2;
    if (row.length !== STORE_INVENTORY_HEADERS.length) {
      throw new PickupListValidationError(
        `店舗在庫CSVの${csvRow}行目は${STORE_INVENTORY_HEADERS.length}列必要です。`,
      );
    }
    const storeCode = row[11]!.trim();
    if (!TARGET_STORE_CODES.has(storeCode)) return;
    const internalCode = row[9]!.trim();
    if (!internalCode) {
      throw new PickupListValidationError(
        `店舗在庫CSVの${csvRow}行目に自社品番がありません。`,
      );
    }
    records.push({
      ean: normalizeEan(row[0], `店舗在庫CSVの${csvRow}行目`),
      department: row[1]!,
      departmentName: row[2]!,
      threeDigitCode: row[3]!,
      manufacturerModel: row[4]!,
      brand: row[5]!,
      productName: row[6]!,
      categoryName: row[7]!,
      itemName: row[8]!,
      internalCode,
      sizeName: row[10]!,
      storeCode,
      storeName: row[12]!,
    });
  });

  if (records.length === 0) {
    throw new PickupListValidationError('店舗在庫CSVに対象店舗のデータがありません。');
  }
  return records;
}

interface PickupInputHeader {
  sheet: ExcelJS.Worksheet;
  rowNumber: number;
  column: number;
}

const EAN_INPUT_HEADERS = new Set([
  'ean',
  'jan',
  'janコード',
  'スキャンコード',
  'スキャンコード(jan)',
]);

type PickupInputKind = 'ean' | 'internalCode';
const INTERNAL_CODE_INPUT_HEADERS = new Set(['自社品番', 'retailer internal code']);

function findPickupHeader(
  workbook: ExcelJS.Workbook,
  kind: PickupInputKind,
): PickupInputHeader | null {
  const headers = kind === 'ean' ? EAN_INPUT_HEADERS : INTERNAL_CODE_INPUT_HEADERS;
  const label = kind === 'ean' ? 'EAN・JAN' : '自社品番';
  let emptySingleColumn: PickupInputHeader | null = null;
  let scanCodeHeader: PickupInputHeader | null = null;
  for (const sheet of workbook.worksheets) {
    if (sheet.actualColumnCount === 1) {
      let firstRow: number | undefined;
      let column = 1;
      let hasData = false;
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, columnNumber) => {
          if (textValue(cell.value).trim() === '') return;
          if (firstRow === undefined) {
            firstRow = rowNumber;
            column = columnNumber;
          } else hasData = true;
        });
      });
      if (firstRow !== undefined && firstRow <= 100) {
        const candidate = { sheet, rowNumber: firstRow, column };
        if (hasData) return candidate;
        // Skip a header-only notes sheet when another sheet contains the list.
        emptySingleColumn ??= candidate;
      }
      continue;
    }
    const lastCandidateRow = Math.min(sheet.rowCount, 100);
    for (let rowNumber = 1; rowNumber <= lastCandidateRow; rowNumber++) {
      const columns: number[] = [];
      sheet.getRow(rowNumber).eachCell((cell, columnNumber) => {
        if (headers.has(normalizedHeader(cell.value))) columns.push(columnNumber);
      });
      if (columns.length > 1) {
        throw new PickupListValidationError(
          `「${sheet.name}」シートの${rowNumber}行目に${label}の候補列が複数あります。照合する列を1列にしてください。`,
        );
      }
      if (columns[0] !== undefined) {
        const candidate = { sheet, rowNumber, column: columns[0] };
        const name = normalizedHeader(sheet.getCell(rowNumber, columns[0]).value);
        // Workbooks may also contain inventory/source sheets. Prefer the EAN/JAN input list.
        if (kind === 'internalCode' || !name.startsWith('スキャンコード')) return candidate;
        scanCodeHeader ??= candidate;
        break;
      }
    }
  }
  return scanCodeHeader ?? emptySingleColumn;
}

async function parsePickupInputWorkbook(bytes: Uint8Array, kind: PickupInputKind) {
  const label = kind === 'ean' ? 'EAN' : '自社品番';
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch (error) {
    throw new PickupListValidationError(
      'リストを読み込めません。Excel（.xlsx）ファイルを確認してください。',
      { cause: error },
    );
  }

  const header = findPickupHeader(workbook, kind);
  if (!header) {
    throw new PickupListValidationError(
      kind === 'ean'
        ? 'エラーリストのヘッダーが見つかりません。EAN、JAN、JANコード、スキャンコード、スキャンコード(jan)のいずれかをヘッダーに指定してください。1列形式の場合はヘッダー名は任意です。'
        : '自社品番のヘッダーが見つかりません。「自社品番」または「Retailer internal code」を指定してください。1列形式の場合はヘッダー名は任意です。',
    );
  }

  const codes = new Set<string>();
  let inputRows = 0;
  const lastRow = header.sheet.rowCount;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= lastRow; rowNumber++) {
    const value = header.sheet.getCell(rowNumber, header.column).value;
    if (textValue(value).trim() === '') continue;
    const rowLabel = `「${header.sheet.name}」シートの${rowNumber}行目`;
    codes.add(
      kind === 'ean' ? normalizeEan(value, rowLabel) : normalizeInternalCode(value, rowLabel),
    );
    inputRows++;
  }
  if (inputRows === 0) {
    throw new PickupListValidationError(
      kind === 'ean'
        ? 'エラーリストにEANのデータ行がありません。'
        : `リストに${label}のデータ行がありません。`,
    );
  }
  return { codes, inputRows, sheetName: header.sheet.name };
}

function normalizeInternalCode(value: unknown, rowLabel: string): string {
  const source = textValue(value).normalize('NFKC').trim();
  const match = /^(\d+)(?:\.0+)?$/.exec(source);
  if (!match?.[1]) {
    throw new PickupListValidationError(`${rowLabel}の自社品番は数字のみで入力してください。`);
  }
  return match[1];
}

export async function parseSafeSizeWorkbook(bytes: Uint8Array): Promise<SafeSizeErrorData> {
  const { codes, ...metadata } = await parsePickupInputWorkbook(bytes, 'ean');
  return { eans: codes, ...metadata };
}

export async function parseInternalCodeWorkbook(bytes: Uint8Array) {
  const { codes, ...metadata } = await parsePickupInputWorkbook(bytes, 'internalCode');
  return { internalCodes: codes, ...metadata };
}

export function step1JoinInventoryWithErrors(
  inventory: readonly StoreInventoryRecord[],
  errorEans: ReadonlySet<string>,
): PickupListRecord[] {
  return joinInventory(inventory, (item) => errorEans.has(item.ean));
}

export function joinInventoryByInternalCodes(
  inventory: readonly StoreInventoryRecord[],
  internalCodes: ReadonlySet<string>,
): PickupListRecord[] {
  return joinInventory(
    inventory,
    (item) => internalCodes.has(item.internalCode.normalize('NFKC').trim()),
  );
}

function joinInventory(
  inventory: readonly StoreInventoryRecord[],
  matches: (item: StoreInventoryRecord) => boolean,
): PickupListRecord[] {
  const records: PickupListRecord[] = [];
  for (const item of inventory) {
    if (!TARGET_STORE_CODES.has(item.storeCode) || !matches(item)) continue;
    records.push({
      department: item.department,
      departmentName: item.departmentName,
      threeDigitCode: item.threeDigitCode,
      manufacturerModel: item.manufacturerModel,
      brand: item.brand,
      productName: item.productName,
      categoryName: item.categoryName,
      itemName: item.itemName,
      internalCode: item.internalCode,
      storeCode: item.storeCode,
      storeName: item.storeName,
    });
  }
  return records;
}

export function step2RemoveDuplicateProducts(
  joinedRecords: readonly PickupListRecord[],
): PickupListRecord[] {
  const records: PickupListRecord[] = [];
  const seenInternalCodes = new Set<string>();
  for (const record of joinedRecords) {
    if (seenInternalCodes.has(record.internalCode)) continue;
    seenInternalCodes.add(record.internalCode);
    records.push(record);
  }
  return records;
}

function recordValues(record: PickupListRecord): string[] {
  return [
    record.department,
    record.departmentName,
    record.threeDigitCode,
    record.manufacturerModel,
    record.brand,
    record.productName,
    record.categoryName,
    record.itemName,
    record.internalCode,
    record.storeCode,
    record.storeName,
  ];
}

export function createPickupSubmissionRows(
  records: readonly PickupListRecord[],
): Array<Array<string | number>> {
  return records.map((record, index) => [
    '',
    '',
    '',
    '',
    '',
    '',
    index + 1,
    ...recordValues(record),
  ]);
}

async function loadPickupTemplate(templateBytes?: Uint8Array): Promise<ExcelJS.Workbook> {
  let bytes = templateBytes;
  if (!bytes) {
    const candidates = [
      new URL('./data/pickup-list-template.xlsx', import.meta.url),
      new URL('../data/pickup-list-template.xlsx', import.meta.url),
    ];
    for (const candidate of candidates) {
      try {
        bytes = await Deno.readFile(candidate);
        break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
  if (!bytes) throw new Error('Pickup-list submission template was not found.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

function requireSubmissionSheets(workbook: ExcelJS.Workbook): {
  summary: ExcelJS.Worksheet;
  output: ExcelJS.Worksheet;
} {
  const summary = workbook.getWorksheet(SUMMARY_SHEET_NAME);
  const output = workbook.getWorksheet(OUTPUT_SHEET_NAME);
  if (!summary || !output) {
    throw new Error('Pickup-list submission template sheets are invalid.');
  }
  const headers = Array.from(
    { length: PICKUP_SUBMISSION_HEADERS.length },
    (_, index) => textValue(output.getCell(2, index + 1).value),
  );
  if (headers.some((header, index) => header !== PICKUP_SUBMISSION_HEADERS[index])) {
    throw new Error('Pickup-list submission template headers are invalid.');
  }
  return { summary, output };
}

function restoreDuplicateFormatting(bytes: Uint8Array): Uint8Array {
  const archive = unzipSync(bytes);
  let restored = false;

  for (const [path, content] of Object.entries(archive)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const xml = strFromU8(content);
    if (!xml.includes(EMPTY_DUPLICATE_FORMATTING)) continue;
    archive[path] = strToU8(xml.replace(EMPTY_DUPLICATE_FORMATTING, DUPLICATE_FORMATTING));
    restored = true;
  }

  if (!restored) {
    throw new Error('Pickup-list submission template formatting could not be restored.');
  }

  return zipSync(archive, { level: 6 });
}

export async function step3CreateSubmissionWorkbook(
  records: readonly PickupListRecord[],
  templateBytes?: Uint8Array,
): Promise<Uint8Array> {
  if (records.length > TEMPLATE_MAX_RECORDS) {
    throw new PickupListValidationError(
      `提出フォーマットへ出力できる商品は${TEMPLATE_MAX_RECORDS}件までです。`,
    );
  }

  const workbook = await loadPickupTemplate(templateBytes);
  const { summary, output } = requireSubmissionSheets(workbook);

  for (let row = TEMPLATE_FIRST_DATA_ROW; row <= TEMPLATE_LAST_DATA_ROW; row++) {
    output.getCell(row, 7).value = null;
    for (let column = 8; column <= PICKUP_SUBMISSION_HEADERS.length; column++) {
      output.getCell(row, column).value = null;
    }
  }

  records.forEach((record, index) => {
    const rowNumber = TEMPLATE_FIRST_DATA_ROW + index;
    output.getCell(rowNumber, 7).value = index === 0
      ? 1
      : { formula: `G${rowNumber - 1}+1`, result: index + 1 };
    recordValues(record).forEach((value, valueIndex) => {
      output.getCell(rowNumber, valueIndex + 8).value = value;
    });
  });

  const totalFormula = summary.getCell('B5').formula;
  const remainingFormula = summary.getCell('B7').formula;
  if (!totalFormula || !remainingFormula) {
    throw new Error('Pickup-list submission template formulas are invalid.');
  }
  summary.getCell('B5').value = { formula: totalFormula, result: records.length };
  summary.getCell('B7').value = { formula: remainingFormula, result: records.length };

  const workbookOutput = await workbook.xlsx.writeBuffer();
  return restoreDuplicateFormatting(
    Uint8Array.from(workbookOutput as unknown as Uint8Array),
  );
}
