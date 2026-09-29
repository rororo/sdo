const PICKUP_COLUMN_WIDTHS = [
  54,
  54,
  54,
  54,
  54,
  54,
  54,
  58,
  112,
  54,
  126,
  128,
  210,
  112,
  126,
  110,
  58,
  118,
];

export interface PickupConfirmation {
  filename: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  stats: { inputRows: number; matchedRows: number; outputRows: number };
  workbookBase64: string;
}

export function PickupPreview({ result }: { result: PickupConfirmation }) {
  return (
    <div className='table-scroll'>
      <table className='pickup-preview-table'>
        <thead>
          <tr>
            {result.headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                scope='col'
                style={{
                  width: PICKUP_COLUMN_WIDTHS[index],
                  minWidth: PICKUP_COLUMN_WIDTHS[index],
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={`pickup-output-${rowIndex}`} tabIndex={0}>
              {row.map((value, columnIndex) => (
                <td
                  key={`${rowIndex}-${columnIndex}`}
                  title={String(value)}
                  className={[6, 7, 9, 10, 15, 16].includes(columnIndex) ? 'mono-cell' : ''}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
