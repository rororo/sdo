import archiver from 'archiver';
import { Buffer } from 'node:buffer';
import { PassThrough } from 'node:stream';
import { DEPARTMENT_ITEM_MASTER } from '../repositories/department-item-master-repository.ts';
import { parseCsv } from '../utils/csv.ts';

const OUTPUT_SHEET_NAME = 'Master Data2026FW②';

export const LEGACY_SOURCE_HEADERS = [
  '部門',
  '部門名',
  '品種',
  '品種名',
  '品目',
  '品目名',
  '自社品番',
  'ブランド',
  'スキャンコード(jan)',
  'メーカー品番',
  '商品名(en)',
  'size',
  'sizesys',
] as const;

export const SOURCE_HEADERS = [...LEGACY_SOURCE_HEADERS, 'EC-ID', 'EC-URL'] as const;

export const OUTPUT_HEADERS = [
  'BRAND',
  'EAN',
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
  'Retailer Size Sys',
  'Retailer Size',
  'Retailer Display Size',
  'Custom Filter1',
  'Custom Filter2',
  'Custom Filter3',
  'FEDAS',
  'FEDAS Colour Code',
  'EC-ID',
  'EC-URL',
] as const;

const TEMPLATE_NOTES = [
  null,
  null,
  null,
  null,
  null,
  null,
  'Size - Provide all existing sizes for a specific model in the format seen below.  ',
  "Brand 's native Size System. (you may also write the size system and sizes that you use instore , to the Optional columns on the right)",
  null,
  null,
  "Style's unique identifier. Example :different SKU's that fall under the same model/style/article",
  'You  may use your own internal code on the feet scanners and API integrations ',
  'Custom Filter1\n“✓ in SPIKE column indicates shoes with spikes.\nThese shoes should NOT be displayed in the Lifestyle category.”',
  'You may use the size systems that you use instore, on the feet scanners and API integrations.',
  null,
  null,
  'We can show the values under these custom fields as filters on the Product listing page of the Scanner UI. Like the filters on your web shop. You can add new columns if required. (e.g. product category or material etc) ',
  null,
  null,
  'Product Classification Key',
  null,
  null,
  null,
] as const;

const OUTPUT_WIDTHS = [
  15,
  18,
  57,
  39,
  22,
  17,
  12,
  14,
  18,
  16,
  32,
  24,
  12,
  22,
  16,
  24,
  20,
  20,
  20,
  16,
  22,
  24,
  70,
] as const;

type OutputValue = string | number | boolean | Date | null;

export type ShoeMasterRow = readonly OutputValue[];

export interface ShoeProductRecord {
  department: string;
  departmentName: string;
  category: string;
  categoryName: string;
  item: string;
  itemName: string;
  internalCode: string;
  brand: string;
  ean: string;
  manufacturerModel: string;
  commercialName: string;
  size: string;
  sizeSystem: string;
  ecId: string;
  ecUrl: string;
}

export const SHOE_PRODUCT_FIELDS = [
  { key: 'department', label: '部門' },
  { key: 'departmentName', label: '部門名' },
  { key: 'category', label: '品種' },
  { key: 'categoryName', label: '品種名' },
  { key: 'item', label: '品目' },
  { key: 'itemName', label: '品目名' },
  { key: 'internalCode', label: '自社品番' },
  { key: 'brand', label: 'ブランド' },
  { key: 'ean', label: 'スキャンコード(JAN)' },
  { key: 'manufacturerModel', label: 'メーカー品番' },
  { key: 'commercialName', label: '商品名(EN)' },
  { key: 'size', label: 'Size' },
  { key: 'sizeSystem', label: 'SizeSys' },
  { key: 'ecId', label: 'EC-ID' },
  { key: 'ecUrl', label: 'EC-URL' },
] as const satisfies readonly { key: keyof ShoeProductRecord; label: string }[];

export class WorkbookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookValidationError';
  }
}

function scalarValue(value: unknown): OutputValue {
  if (
    value === null || typeof value === 'string' || typeof value === 'number' ||
    typeof value === 'boolean' || value instanceof Date
  ) return value;
  return String(value);
}

function excelString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return String(value);
  return String(value);
}

function normalizedHeader(value: unknown): string {
  return excelString(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function codePart(value: unknown, label: string, sheetRow: number): string {
  const text = excelString(value).trim();
  const match = /^(\d+)(?:\.0+)?$/.exec(text);
  if (!match?.[1]) {
    throw new WorkbookValidationError(
      `${sheetRow}行目の「${label}」は整数で入力してください。`,
    );
  }
  return match[1].replace(/^0+(?=\d)/, '');
}

function formatEan(value: unknown, sheetRow: number): string {
  let digits: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new WorkbookValidationError(
        `${sheetRow}行目の「スキャンコード(jan)」は整数で入力してください。`,
      );
    }
    digits = value.toFixed(0);
  } else {
    digits = excelString(value).trim();
    if (!/^\d+$/.test(digits)) {
      throw new WorkbookValidationError(
        `${sheetRow}行目の「スキャンコード(jan)」は数字のみで入力してください。`,
      );
    }
  }
  return digits.padStart(13, '0');
}

function convertedValues(values: readonly unknown[], rowNumber: number): OutputValue[] {
  const department = codePart(values[0], SOURCE_HEADERS[0], rowNumber);
  const category = codePart(values[2], SOURCE_HEADERS[2], rowNumber);
  const item = codePart(values[4], SOURCE_HEADERS[4], rowNumber);
  const masterKey = `${department}${category}${item}`;
  const attributes = DEPARTMENT_ITEM_MASTER[masterKey] ?? {
    gender: '',
    ageGroup: '',
    sportCategory: '',
    spike: '',
  };

  const manufacturerModel = scalarValue(values[9]);
  return [
    scalarValue(values[7]),
    formatEan(values[8], rowNumber),
    manufacturerModel,
    scalarValue(values[10]),
    attributes.gender,
    attributes.ageGroup,
    scalarValue(values[11]),
    excelString(values[12]),
    attributes.sportCategory,
    null,
    `${excelString(manufacturerModel)}${attributes.gender}${attributes.ageGroup}`,
    scalarValue(values[6]),
    attributes.spike,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    excelString(values[13]),
    excelString(values[14]),
  ];
}

function sourceValues(record: ShoeProductRecord): OutputValue[] {
  const numericSize = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(record.size.trim())
    ? Number(record.size)
    : record.size;
  return [
    record.department,
    record.departmentName,
    record.category,
    record.categoryName,
    record.item,
    record.itemName,
    record.internalCode,
    record.brand,
    record.ean,
    record.manufacturerModel,
    record.commercialName,
    numericSize,
    record.sizeSystem,
    record.ecId,
    record.ecUrl,
  ];
}

export function parseShoeProductCsv(text: string): ShoeProductRecord[] {
  const records = parseCsv(text, '商品CSV');
  const header = records.shift();
  const expectedHeaders = header?.length === LEGACY_SOURCE_HEADERS.length
    ? LEGACY_SOURCE_HEADERS
    : SOURCE_HEADERS;
  if (
    !header || header.length !== expectedHeaders.length ||
    header.some((value, index) =>
      normalizedHeader(value) !== normalizedHeader(expectedHeaders[index])
    )
  ) {
    throw new WorkbookValidationError(
      `商品CSVのヘッダーは「${
        SOURCE_HEADERS.join('、')
      }」の順にしてください（旧形式の先頭13列のみも利用できます）。`,
    );
  }

  const products: ShoeProductRecord[] = [];
  records.forEach((record, index) => {
    const csvRow = index + 2;
    if (record.length !== expectedHeaders.length) {
      throw new WorkbookValidationError(
        `商品CSVの${csvRow}行目は${expectedHeaders.length}列必要です。`,
      );
    }
    const [
      department,
      departmentName,
      category,
      categoryName,
      item,
      itemName,
      internalCode,
      brand,
      ean,
      manufacturerModel,
      commercialName,
      size,
      sizeSystem,
      ecId = '',
      ecUrl = '',
    ] = record;
    products.push({
      department: department!,
      departmentName: departmentName!,
      category: category!,
      categoryName: categoryName!,
      item: item!,
      itemName: itemName!,
      internalCode: internalCode!,
      brand: brand!,
      ean: ean!,
      manufacturerModel: manufacturerModel!,
      commercialName: commercialName!,
      size: size!,
      sizeSystem: sizeSystem!,
      ecId,
      ecUrl,
    });
  });

  if (products.length === 0) {
    throw new WorkbookValidationError('商品CSVに変換対象のデータ行がありません。');
  }
  return products;
}

function escapeXml(value: string): string {
  const withoutControlCharacters = [...value].filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 || code === 9 || code === 10 || code === 13;
  }).join('');
  return withoutControlCharacters
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnLetter(column: number): string {
  let result = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  }
  return result;
}

function cellXml(row: number, column: number, value: OutputValue, style?: number): string {
  if (value === null) return '';
  const address = `${columnLetter(column)}${row}`;
  const styleAttribute = style === undefined ? '' : ` s="${style}"`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${address}"${styleAttribute}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${address}"${styleAttribute} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (text === '') return `<c r="${address}"${styleAttribute} t="str"><v></v></c>`;
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${address}"${styleAttribute} t="inlineStr"><is><t${preserve}>${
    escapeXml(text)
  }</t></is></c>`;
}

function rowXml(rowNumber: number, values: readonly OutputValue[], options?: {
  height?: number;
  header?: boolean;
}): string {
  const height = options?.height === undefined ? '' : ` ht="${options.height}" customHeight="1"`;
  const cells = values.map((value, index) => {
    let style: number | undefined;
    if (options?.header) {
      style = index < 4 ? 1 : index < 10 ? 2 : 3;
    }
    return cellXml(rowNumber, index + 1, value, style);
  }).join('');
  return `<row r="${rowNumber}"${height}>${cells}</row>`;
}

function worksheetXml(rows: readonly ShoeMasterRow[]): string {
  const lastColumn = columnLetter(OUTPUT_HEADERS.length);
  const dataRows = rows.map((values, index) => rowXml(index + 5, values)).join('');
  const widths = OUTPUT_WIDTHS.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join('');
  const categories: OutputValue[] = Array(OUTPUT_HEADERS.length).fill(null);
  categories[0] = 'Mandatory values to be filled.';
  categories[10] = 'Optional data';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${rows.length + 4}"/>
  <sheetViews><sheetView workbookViewId="0" zoomScale="70" zoomScaleNormal="70"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${widths}</cols>
  <sheetData>
    <row r="1"/>
    ${rowXml(2, categories)}
    ${rowXml(3, [...TEMPLATE_NOTES], { height: 120 })}
    ${rowXml(4, [...OUTPUT_HEADERS], { height: 36, header: true })}
    ${dataRows}
  </sheetData>
  <autoFilter ref="A4:${lastColumn}${rows.length + 4}"/>
  <mergeCells count="2"><mergeCell ref="A2:J2"/><mergeCell ref="K2:${lastColumn}2"/></mergeCells>
</worksheet>`;
}

async function createOutputWorkbook(rows: readonly ShoeMasterRow[]): Promise<Uint8Array> {
  const files = new Map<string, string>();
  files.set(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );
  files.set(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  files.set(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets><sheet name="${escapeXml(OUTPUT_SHEET_NAME)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );
  files.set(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  files.set(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="13"/><color rgb="FFFF0000"/><name val="Meiryo UI"/></font>
    <font><b/><sz val="11"/><color rgb="FF000000"/><name val="Meiryo UI"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF808080"/></left><right style="thin"><color rgb="FF808080"/></right><top style="thin"><color rgb="FF808080"/></top><bottom style="thin"><color rgb="FF808080"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  );
  files.set('xl/worksheets/sheet1.xml', worksheetXml(rows));

  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<void>((resolve, reject) => {
    output.once('end', resolve);
    output.once('error', reject);
  });
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.once('error', (error: Error) => output.destroy(error));
  zip.pipe(output);
  for (const [name, content] of files) zip.append(content, { name });
  await zip.finalize();
  await complete;
  return new Uint8Array(Buffer.concat(chunks));
}

export function step1ConvertSourceRows(
  products: readonly ShoeProductRecord[],
): ShoeMasterRow[] {
  if (products.length === 0) {
    throw new WorkbookValidationError('商品CSVに変換対象のデータ行がありません。');
  }
  return products.map((product, index) => convertedValues(sourceValues(product), index + 2));
}

export async function step2CreateMasterWorkbook(
  rows: readonly ShoeMasterRow[],
): Promise<Uint8Array> {
  return await createOutputWorkbook(rows);
}

export function validateShoeProducts(products: readonly ShoeProductRecord[]): void {
  step1ConvertSourceRows(products);
}
