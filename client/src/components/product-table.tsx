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

const SHOE_FIELDS = [
  ['department', '部門'],
  ['departmentName', '部門名'],
  ['category', '品種'],
  ['categoryName', '品種名'],
  ['item', '品目'],
  ['itemName', '品目名'],
  ['internalCode', '自社品番'],
  ['brand', 'ブランド'],
  ['ean', 'スキャンコード(JAN)'],
  ['manufacturerModel', 'メーカー品番'],
  ['commercialName', '商品名(EN)'],
  ['size', 'Size'],
  ['sizeSystem', 'SizeSys'],
  ['ecId', 'EC-ID'],
  ['ecUrl', 'EC-URL'],
] as const satisfies readonly [keyof ShoeProductRecord, string][];

const SHOE_COLUMN_WIDTHS = [62, 116, 62, 116, 62, 130, 112, 132, 142, 128, 230, 60, 74, 140, 360];

export function ProductTable({ records }: { records: readonly ShoeProductRecord[] }) {
  return (
    <table className='product-table'>
      <thead>
        <tr>
          {SHOE_FIELDS.map(([, label], index) => (
            <th
              key={label}
              scope='col'
              style={{
                width: SHOE_COLUMN_WIDTHS[index],
                minWidth: SHOE_COLUMN_WIDTHS[index],
              }}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record, rowIndex) => (
          <tr key={`${record.internalCode}-${record.ean}-${rowIndex}`} tabIndex={0}>
            {SHOE_FIELDS.map(([key], columnIndex) => (
              <td
                key={key}
                title={record[key] || '—'}
                className={[0, 2, 4, 6, 8, 9, 11].includes(columnIndex) ? 'mono-cell' : ''}
              >
                {record[key] || '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
