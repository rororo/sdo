import { useCallback, useEffect, useState } from 'react';
import type { ToastMessage, ToolbarAction } from '../components/app-shell.tsx';
import { apiUrl } from '../utils/api.ts';
import { downloadResponseFile } from '../utils/download-file.ts';

const PAGE_SIZE = 50;

interface ShoeProductRecord {
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
}

interface ShoeDataResponse {
  records: ShoeProductRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  metadata: {
    lastModified: string | null;
    loadedAt: string;
  };
}

type RequestStatus =
  | { kind: 'idle'; message: '' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

interface ProductsPageProps {
  active: boolean;
  onUnauthorized: () => void;
  onToolbarChange: (action: ToolbarAction) => void;
  showToast: (message: string, kind?: ToastMessage['kind']) => void;
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
] as const satisfies readonly [keyof ShoeProductRecord, string][];

const SHOE_COLUMN_WIDTHS = [62, 116, 62, 116, 62, 130, 112, 132, 142, 128, 230, 60, 74];

function formatDate(value: string | null): string {
  if (!value) return '取得できません';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function RefreshIcon() {
  return (
    <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
      <path d='M13.5 7.5a5.5 5.5 0 0 0-9.9-3.1M2.5 8.5a5.5 5.5 0 0 0 9.9 3.1M3.2 2v2.6h2.6M12.8 14v-2.6h-2.6' />
    </svg>
  );
}

export function ProductsPage({
  active,
  onUnauthorized,
  onToolbarChange,
  showToast,
}: ProductsPageProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ShoeDataResponse | null>(null);
  const [dataStatus, setDataStatus] = useState<RequestStatus>({ kind: 'idle', message: '' });
  const [downloadStatus, setDownloadStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });

  const loadData = useCallback(async (requestedPage: number) => {
    setDataStatus({ kind: 'loading', message: '商品データを読み込んでいます…' });
    try {
      const query = new URLSearchParams({
        page: String(requestedPage),
        pageSize: String(PAGE_SIZE),
      });
      const response = await fetch(apiUrl(`api/shoes?${query}`));
      if (response.status === 401) {
        onUnauthorized();
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      const body = await response.json() as ShoeDataResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? '商品データを取得できませんでした。');
      setData(body);
      setPage(body.page);
      setDataStatus({ kind: 'success', message: '' });
    } catch (error) {
      setDataStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '商品データを取得できませんでした。',
      });
    }
  }, [onUnauthorized]);

  useEffect(() => {
    if (!active) return;
    void loadData(page);
    const timer = globalThis.setInterval(() => void loadData(page), 60 * 60 * 1000);
    return () => globalThis.clearInterval(timer);
  }, [active, loadData, page]);

  const downloadExcel = useCallback(async () => {
    if (downloadStatus.kind === 'loading') return;
    setDownloadStatus({ kind: 'loading', message: 'Excelを生成しています…' });
    try {
      const response = await fetch(apiUrl('api/shoes.xlsx'));
      if (response.status === 401) {
        onUnauthorized();
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Excelを生成できませんでした。');
      }
      await downloadResponseFile(response, 'shoe_master.xlsx');
      const count = Number(response.headers.get('X-Processed-Rows') ?? data?.total ?? 0);
      setDownloadStatus({
        kind: 'success',
        message: `${count.toLocaleString('ja-JP')}件のExcelをダウンロードしました。`,
      });
      showToast('商品一覧のExcelをダウンロードしました。');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Excelを生成できませんでした。';
      setDownloadStatus({ kind: 'error', message });
      showToast(message, 'error');
    }
  }, [data?.total, downloadStatus.kind, onUnauthorized, showToast]);

  useEffect(() => {
    onToolbarChange({
      disabled: !data || downloadStatus.kind === 'loading',
      loading: downloadStatus.kind === 'loading',
      title: '表示中の商品データをExcelでダウンロード',
      label: 'Excelダウンロード',
      loadingLabel: 'Excel生成中',
      onClick: () => void downloadExcel(),
    });
  }, [data, downloadExcel, downloadStatus.kind, onToolbarChange]);

  const productStatus = dataStatus.kind === 'error'
    ? '取得失敗'
    : dataStatus.kind === 'loading'
    ? data ? 'ページ更新中' : '取得中'
    : downloadStatus.kind === 'loading'
    ? 'Excel生成中'
    : data
    ? '取得済'
    : '取得中';
  const shownPages = data
    ? Array.from({ length: data.pageCount }, (_, index) => index + 1).filter((candidate) =>
      candidate === 1 || candidate === data.pageCount || Math.abs(candidate - data.page) <= 1
    )
    : [];

  return (
    <div className='products-page' hidden={!active}>
      <section className='data-panel' aria-label='商品一覧'>
        {!data && dataStatus.kind === 'error' && (
          <div className='empty-state error-state' role='alert'>
            <span className='state-icon' aria-hidden='true'>!</span>
            <strong>商品データを取得できませんでした</strong>
            <p>{dataStatus.message}</p>
            <button
              className='secondary-button'
              type='button'
              onClick={() =>
                void loadData(1)}
            >
              <RefreshIcon />
              <span>再試行</span>
            </button>
          </div>
        )}

        {!data && dataStatus.kind !== 'error' && (
          <div className='loading-table' aria-busy='true' aria-live='polite'>
            <div className='skeleton-heading'>データを読み込み中</div>
            {Array.from({ length: 13 }, (_, row) => (
              <div className='skeleton-row' key={row}>
                {[56, 92, 48, 104, 120, 76, 132, 60].map((width, column) => (
                  <span key={column} style={{ width: width - row % 3 * 6 }} />
                ))}
              </div>
            ))}
          </div>
        )}

        {data && data.records.length === 0 && dataStatus.kind !== 'loading' && (
          <div className='empty-state'>
            <span className='empty-table-icon' aria-hidden='true' />
            <strong>表示できる商品データがありません</strong>
            <p>
              取得は正常に完了しましたが、該当する商品がありませんでした。時間をおいて再度確認してください。
            </p>
          </div>
        )}

        {data && data.records.length > 0 && (
          <div className='table-scroll' aria-busy={dataStatus.kind === 'loading'}>
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
                {data.records.map((record, rowIndex) => (
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
          </div>
        )}

        {data && dataStatus.kind === 'loading' && (
          <div className='paging-progress' role='status' aria-label='ページを更新中'>
            <span />
          </div>
        )}
      </section>

      <footer className='sheet-footer'>
        <div className='sheet-meta'>
          <span>
            商品件数 {data ? data.total.toLocaleString('ja-JP') : '—'} 件
            {data && data.total > 0 && (
              <>
                （{((data.page - 1) * data.pageSize + 1).toLocaleString('ja-JP')}–
                {Math.min(data.page * data.pageSize, data.total).toLocaleString('ja-JP')} 表示）
              </>
            )}
          </span>
          <span>最終更新 {formatDate(data?.metadata.lastModified ?? null)}</span>
          <span
            className={`status-badge${dataStatus.kind === 'error' ? ' error' : ''}`}
            role='status'
            aria-live='polite'
          >
            {productStatus}
          </span>
        </div>

        {data && data.pageCount > 0 && (
          <nav className='pagination' aria-label='商品一覧のページ切り替え'>
            <button
              type='button'
              onClick={() =>
                setPage(1)}
              disabled={data.page <= 1 || dataStatus.kind === 'loading'}
              aria-label='最初のページ'
            >
              <span aria-hidden='true'>«</span>
              <span className='pager-label'>最初</span>
            </button>
            <button
              type='button'
              onClick={() =>
                setPage((current) => Math.max(1, current - 1))}
              disabled={data.page <= 1 || dataStatus.kind === 'loading'}
              aria-label='前のページ'
            >
              <span aria-hidden='true'>‹</span>
              <span className='pager-label'>前</span>
            </button>
            {shownPages.map((shownPage, index) => (
              <span className='page-number-group' key={shownPage}>
                {index > 0 && shownPage - (shownPages[index - 1] ?? 0) > 1 && (
                  <span className='pagination-gap' aria-hidden='true'>…</span>
                )}
                <button
                  type='button'
                  className={shownPage === data.page ? 'current' : ''}
                  aria-current={shownPage === data.page ? 'page' : undefined}
                  aria-label={`${shownPage}ページ目`}
                  onClick={() =>
                    setPage(shownPage)}
                  disabled={dataStatus.kind === 'loading' && shownPage !== data.page}
                >
                  {shownPage}
                </button>
              </span>
            ))}
            <button
              type='button'
              onClick={() => setPage((current) => Math.min(data.pageCount, current + 1))}
              disabled={data.page >= data.pageCount || dataStatus.kind === 'loading'}
              aria-label='次のページ'
            >
              <span className='pager-label'>次</span>
              <span aria-hidden='true'>›</span>
            </button>
            <button
              type='button'
              onClick={() => setPage(data.pageCount)}
              disabled={data.page >= data.pageCount || dataStatus.kind === 'loading'}
              aria-label='最後のページ'
            >
              <span className='pager-label'>最後</span>
              <span aria-hidden='true'>»</span>
            </button>
          </nav>
        )}
      </footer>
    </div>
  );
}
