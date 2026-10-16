import { useCallback, useEffect, useRef, useState } from 'react';
import type { PickupListPageProps } from './pickup-list-page.tsx';
import { ProductTable, type ShoeProductRecord } from '../components/product-table.tsx';
import { apiUrl } from '../utils/api.ts';
import { downloadBlobFile, responseFilename } from '../utils/download-file.ts';

interface Result {
  records: ShoeProductRecord[];
  total: number;
  page: number;
  pageCount: number;
  version: string;
  stats: { inputRows: number; uniqueCodes: number; matchedCodes: number };
  unmatchedCodes: string[];
  metadata: { lastModified: string | null; period: string | null };
}

export function KyokaProductsPage(
  { active, pendingDrop, onUnauthorized, onToolbarChange, showToast }: Omit<
    PickupListPageProps,
    'mode'
  >,
) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ sequence: number; controller?: AbortController }>({ sequence: 0 });
  const handledDrop = useRef(0);

  const cancelRequest = useCallback(() => {
    request.current.controller?.abort();
    request.current = { sequence: request.current.sequence + 1 };
  }, []);
  useEffect(() => () => cancelRequest(), [cancelRequest]);

  const selectFiles = useCallback((files: File[]) => {
    cancelRequest();
    setBusy(false);
    setResult(null);
    setError('');
    setFile(null);
    if (files.length === 0) return;
    if (files.length !== 1) {
      setError('Excelファイルを1件だけ選択してください。');
      return;
    }
    const selected = files[0]!;
    if (!selected.name.toLowerCase().endsWith('.xlsx')) {
      setError('Excel（.xlsx）ファイルを選択してください。');
      return;
    }
    if (selected.size === 0) {
      setError('空のファイルはアップロードできません。');
      return;
    }
    if (selected.size > 20 * 1024 * 1024) {
      setError('アップロードできるExcelファイルは20MBまでです。');
      return;
    }
    setFile(selected);
  }, [cancelRequest]);

  useEffect(() => {
    if (!pendingDrop || handledDrop.current === pendingDrop.id) return;
    handledDrop.current = pendingDrop.id;
    selectFiles(pendingDrop.files);
  }, [pendingDrop, selectFiles]);

  const run = useCallback(async (page: number, version?: string, download = false) => {
    if (!file) return;
    cancelRequest();
    const sequence = request.current.sequence;
    const controller = new AbortController();
    request.current.controller = controller;
    setBusy(true);
    setError('');
    if (!version) setResult(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const query = new URLSearchParams({ page: String(page) });
      if (version) query.set('version', version);
      const response = await fetch(
        apiUrl(`api/kyoka-products${download ? '.xlsx' : ''}?${query}`),
        {
          method: 'POST',
          body: form,
          signal: controller.signal,
        },
      );
      if (sequence !== request.current.sequence) return;
      if (response.status === 401) {
        onUnauthorized();
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? '商品データを取得できませんでした。');
      }
      if (download) {
        const blob = await response.blob();
        if (sequence !== request.current.sequence) return;
        downloadBlobFile(blob, responseFilename(response, 'kyoka_shoe_master.xlsx'));
        showToast('強化品番の商品一覧をExcelでダウンロードしました。');
      } else {
        const body = await response.json() as Result;
        if (sequence !== request.current.sequence) return;
        setResult(body);
      }
    } catch (cause) {
      if (sequence !== request.current.sequence) return;
      setResult(null);
      setError(cause instanceof Error ? cause.message : '処理に失敗しました。');
    } finally {
      if (sequence === request.current.sequence) setBusy(false);
    }
  }, [file, cancelRequest, onUnauthorized, showToast]);

  useEffect(() => {
    onToolbarChange({
      disabled: !result || result.total === 0 || busy,
      loading: busy,
      title: '絞り込んだ全商品の登録用Excelをダウンロード',
      label: 'Excelダウンロード',
      loadingLabel: '処理中',
      onClick: () => {
        if (result) void run(1, result.version, true);
      },
    });
  }, [result, busy, run, onToolbarChange]);

  return (
    <div className='products-page kyoka-products-page' hidden={!active}>
      <section className='upload-panel' aria-labelledby='kyoka-products-title'>
        <h1 id='kyoka-products-title'>強化品番商品一覧</h1>
        <p>
          自社品番リストで、現在の商品一覧と同じ対象期の商品を絞り込みます。各JAN・サイズをすべて表示します。
        </p>
        <p>
          1列ならヘッダー名は任意。複数列は「自社品番」または「Retailer internal
          code」を指定してください。.xlsx、1ファイル、20MBまで。
        </p>
        <div className='upload-actions'>
          <label className='file-button'>
            <span>{file ? '別ファイルを選ぶ' : 'ファイルを選択'}</span>
            <input
              type='file'
              accept='.xlsx'
              onChange={(event) => {
                selectFiles(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </label>
          <button
            className='confirm-button'
            type='button'
            disabled={!file || busy}
            onClick={() => void run(1)}
          >
            {busy ? '処理中' : 'アップロードを確定'}
          </button>
          {file && (
            <button
              className='secondary-button'
              type='button'
              onClick={() => selectFiles([])}
            >
              選択解除
            </button>
          )}
        </div>
        {file && (
          <div className='selected-file'>
            <strong>{file.name}</strong>
          </div>
        )}
        {error && <p className='alert-message' role='alert'>{error}</p>}
      </section>
      {result && (
        <>
          <div className='kyoka-products-summary' aria-label='抽出結果'>
            <span>入力行数 {result.stats.inputRows}</span>
            <span>入力品番数 {result.stats.uniqueCodes}</span>
            <span>一致品番数 {result.stats.matchedCodes}</span>
            <span>商品行数 {result.total}</span>
            <span>対象期 {result.metadata.period ?? '商品一覧と同じ'}</span>
            <span>
              商品データ更新 {result.metadata.lastModified
                ? new Date(result.metadata.lastModified).toLocaleString('ja-JP', {
                  timeZone: 'Asia/Tokyo',
                })
                : '不明'}
            </span>
          </div>
          {result.unmatchedCodes.length > 0 && (
            <details className='kyoka-products-unmatched'>
              <summary>未一致品番 {result.unmatchedCodes.length}件</summary>
              <p>対象期の商品データに含まれていない品番です。</p>
              <div>{result.unmatchedCodes.join('、')}</div>
            </details>
          )}
        </>
      )}
      <section className='data-panel' aria-label='強化品番の商品一覧' aria-busy={busy}>
        {result && result.total > 0
          ? (
            <div className='table-scroll'>
              <ProductTable records={result.records} />
            </div>
          )
          : (
            <div className='empty-state'>
              <strong>
                {busy
                  ? '商品データを確認しています…'
                  : result
                  ? '対象期の商品データに一致する自社品番がありません。'
                  : '自社品番リストを選択してアップロードを確定してください。'}
              </strong>
            </div>
          )}
      </section>
      {result && result.total > 0 && (
        <footer className='sheet-footer'>
          <span>{result.page} / {result.pageCount} ページ（全{result.total}行）</span>
          <nav className='pagination' aria-label='強化品番商品一覧のページ切り替え'>
            <button
              type='button'
              disabled={busy || result.page <= 1}
              onClick={() => void run(1, result.version)}
            >
              最初
            </button>
            <button
              type='button'
              disabled={busy || result.page <= 1}
              onClick={() => void run(result.page - 1, result.version)}
            >
              前のページ
            </button>
            <button
              type='button'
              disabled={busy || result.page >= result.pageCount}
              onClick={() => void run(result.page + 1, result.version)}
            >
              次のページ
            </button>
            <button
              type='button'
              disabled={busy || result.page >= result.pageCount}
              onClick={() => void run(result.pageCount, result.version)}
            >
              最後
            </button>
          </nav>
        </footer>
      )}
    </div>
  );
}
