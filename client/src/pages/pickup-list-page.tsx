import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage, ToolbarAction } from '../components/app-shell.tsx';
import { type PickupConfirmation, PickupPreview } from '../components/pickup-preview.tsx';
import { apiUrl } from '../utils/api.ts';
import { downloadBase64Workbook } from '../utils/download-file.ts';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
type RequestStatus =
  | { kind: 'idle'; message: '' }
  | { kind: 'loading'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export interface PendingFileDrop {
  id: number;
  files: File[];
}

export interface PickupListPageProps {
  mode?: 'standard' | 'kyoka';
  active: boolean;
  pendingDrop: PendingFileDrop | null;
  onUnauthorized: () => void;
  onToolbarChange: (action: ToolbarAction) => void;
  showToast: (message: string, kind?: ToastMessage['kind']) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function RefreshIcon() {
  return (
    <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
      <path d='M13.5 7.5a5.5 5.5 0 0 0-9.9-3.1M2.5 8.5a5.5 5.5 0 0 0 9.9 3.1M3.2 2v2.6h2.6M12.8 14v-2.6h-2.6' />
    </svg>
  );
}

export function PickupListPage({
  mode = 'standard',
  active,
  pendingDrop,
  onUnauthorized,
  onToolbarChange,
  showToast,
}: PickupListPageProps) {
  const titleId = `${mode}-pickup-file-title`;
  const [pickupFile, setPickupFile] = useState<File | null>(null);
  const [pickupStatus, setPickupStatus] = useState<RequestStatus>({
    kind: 'idle',
    message: '',
  });
  const [pickupConfirmation, setPickupConfirmation] = useState<PickupConfirmation | null>(null);
  const handledDropId = useRef(0);

  const updatePickupFile = useCallback((file: File | null) => {
    if (pickupStatus.kind === 'loading') return;
    setPickupConfirmation(null);
    if (!file) {
      setPickupFile(null);
      setPickupStatus({ kind: 'idle', message: '' });
      return;
    }
    if (file.size === 0) {
      setPickupFile(null);
      setPickupStatus({ kind: 'error', message: '空のファイルはアップロードできません。' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPickupFile(null);
      setPickupStatus({
        kind: 'error',
        message: 'アップロードできるExcelファイルは20MBまでです。',
      });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setPickupFile(null);
      setPickupStatus({ kind: 'error', message: 'Excel（.xlsx）ファイルを選択してください。' });
      return;
    }
    setPickupFile(file);
    setPickupStatus({ kind: 'success', message: `${file.name} を選択しました。` });
  }, [pickupStatus.kind]);

  useEffect(() => {
    if (!pendingDrop || handledDropId.current === pendingDrop.id) return;
    handledDropId.current = pendingDrop.id;
    if (pendingDrop.files.length !== 1) {
      setPickupFile(null);
      setPickupConfirmation(null);
      setPickupStatus({ kind: 'error', message: 'Excelファイルを1件だけドロップしてください。' });
      return;
    }
    updatePickupFile(pendingDrop.files[0] ?? null);
  }, [pendingDrop, updatePickupFile]);

  const selectPickupFile = (event: ChangeEvent<HTMLInputElement>) => {
    updatePickupFile(event.target.files?.[0] ?? null);
    event.target.value = '';
  };

  const confirmPickupUpload = useCallback(async () => {
    if (!pickupFile || pickupStatus.kind === 'loading') return;
    setPickupStatus({ kind: 'loading', message: 'アップロードしたファイルを確認しています…' });
    setPickupConfirmation(null);
    try {
      const form = new FormData();
      form.set('file', pickupFile);
      const response = await fetch(
        apiUrl(mode === 'kyoka' ? 'api/kyoka-pickup-list' : 'api/pickup-list'),
        {
          method: 'POST',
          body: form,
        },
      );
      if (response.status === 401) {
        onUnauthorized();
        throw new Error('セッションの有効期限が切れました。もう一度ログインしてください。');
      }
      const body = await response.json() as PickupConfirmation & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'ピックアップリストを生成できませんでした。');
      if (
        !body.filename || !body.workbookBase64 || !Array.isArray(body.headers) ||
        body.headers.length !== 18 || !Array.isArray(body.rows) || !body.stats ||
        body.rows.some((row) => row.length !== body.headers.length)
      ) {
        throw new Error('出力フォーマットを表示できませんでした。');
      }
      setPickupConfirmation(body);
      setPickupStatus({
        kind: 'success',
        message: `${pickupFile.name} のアップロードを確定しました。`,
      });
      showToast('提出用フォーマットを表示しました。');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'ピックアップリストを生成できませんでした。';
      setPickupStatus({ kind: 'error', message });
      showToast(message, 'error');
    }
  }, [mode, onUnauthorized, pickupFile, pickupStatus.kind, showToast]);

  const downloadPickupExcel = useCallback(() => {
    if (!pickupConfirmation) return;
    try {
      downloadBase64Workbook(
        pickupConfirmation.workbookBase64,
        pickupConfirmation.filename,
      );
      setPickupStatus({
        kind: 'success',
        message: `${
          pickupConfirmation.stats.outputRows.toLocaleString('ja-JP')
        }件のExcelをダウンロードしました。`,
      });
      showToast('ピックアップリストのExcelをダウンロードしました。');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Excelをダウンロードできませんでした。';
      setPickupStatus({ kind: 'error', message });
      showToast(message, 'error');
    }
  }, [pickupConfirmation, showToast]);

  useEffect(() => {
    onToolbarChange({
      disabled: !pickupConfirmation || pickupStatus.kind === 'loading',
      loading: false,
      title: pickupConfirmation
        ? '表示中のピックアップリストをExcelでダウンロード'
        : 'アップロード確定後に利用できます',
      label: 'Excelダウンロード',
      loadingLabel: 'Excelダウンロード',
      onClick: downloadPickupExcel,
    });
  }, [downloadPickupExcel, onToolbarChange, pickupConfirmation, pickupStatus.kind]);

  const pickupState = pickupStatus.kind === 'loading'
    ? '処理中'
    : pickupStatus.kind === 'error'
    ? '処理失敗'
    : pickupConfirmation
    ? '完了'
    : '未確定';

  return (
    <div className='pickup-list-page' hidden={!active}>
      {pickupConfirmation
        ? (
          <div className='upload-compact'>
            <span className='success-check' aria-hidden='true'>✓</span>
            <strong title={pickupFile?.name}>{pickupFile?.name}</strong>
            <span>{pickupFile ? formatFileSize(pickupFile.size) : ''}</span>
            <label className='secondary-file-button'>
              <RefreshIcon />
              <span>別ファイルを選ぶ</span>
              <input type='file' accept='.xlsx' onChange={selectPickupFile} />
            </label>
          </div>
        )
        : (
          <section className='upload-panel' aria-labelledby={titleId}>
            <span className='xlsx-icon' aria-hidden='true'>XLS</span>
            <h1 id={titleId}>
              {mode === 'kyoka'
                ? '強化品番ピックアップ：自社品番リストをアップロード'
                : 'Excelファイルをドロップ、または選択'}
            </h1>
            {mode === 'kyoka' && (
              <p>
                リストの自社品番を店舗10309・10319の在庫と照合します。複数列の場合は「自社品番」または「Retailer
                internal code」を見出しにしてください。
              </p>
            )}
            <p>画面のどこへドロップしても受け付けます。.xlsx 形式、1ファイル、20MBまで。</p>
            <div className='upload-actions'>
              <label className={pickupFile ? 'secondary-file-button' : 'file-button'}>
                {pickupFile
                  ? <RefreshIcon />
                  : (
                    <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                      <path d='M2.5 12.5v-8A1.5 1.5 0 0 1 4 3h2.2l1.2 1.6H12a1.5 1.5 0 0 1 1.5 1.5v6.4A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5Z' />
                    </svg>
                  )}
                <span>{pickupFile ? '別ファイルを選ぶ' : 'ファイルを選択'}</span>
                <input type='file' accept='.xlsx' onChange={selectPickupFile} />
              </label>
              {pickupFile && (
                <button
                  className='confirm-button'
                  type='button'
                  onClick={() => void confirmPickupUpload()}
                  disabled={pickupStatus.kind === 'loading'}
                >
                  {pickupStatus.kind === 'loading'
                    ? <span className='spinner' aria-hidden='true' />
                    : (
                      <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                        <path d='m3.2 8.4 3 3 6.6-6.8' />
                      </svg>
                    )}
                  <span>{pickupStatus.kind === 'loading' ? '確認中' : 'アップロードを確定'}</span>
                </button>
              )}
            </div>
            {pickupFile && (
              <div className='selected-file'>
                <strong title={pickupFile.name}>{pickupFile.name}</strong>
                <span>{formatFileSize(pickupFile.size)}</span>
                <button type='button' onClick={() => updatePickupFile(null)}>選択解除</button>
              </div>
            )}
            {pickupStatus.kind === 'error' && (
              <div className='alert-message upload-error' role='alert'>
                <span aria-hidden='true'>!</span>
                <p>{pickupStatus.message}</p>
              </div>
            )}
          </section>
        )}

      <section className='data-panel pickup-result-panel' aria-label='出力フォーマット'>
        {pickupConfirmation
          ? (
            <>
              <header className='result-heading'>
                <h2>出力フォーマット</h2>
                <span>出力 {pickupConfirmation.rows.length.toLocaleString('ja-JP')} 件</span>
              </header>
              <PickupPreview result={pickupConfirmation} />
            </>
          )
          : pickupStatus.kind === 'error' && pickupFile
          ? (
            <div className='empty-state error-state' role='alert'>
              <span className='state-icon' aria-hidden='true'>!</span>
              <strong>処理に失敗しました</strong>
              <p>入力ファイルは保持しています。再試行するか、別のファイルを選択してください。</p>
              <button
                className='secondary-button'
                type='button'
                onClick={() => void confirmPickupUpload()}
              >
                <RefreshIcon />
                <span>再試行</span>
              </button>
            </div>
          )
          : (
            <div className='empty-state'>
              <span className='empty-table-icon' aria-hidden='true' />
              <strong>結果はまだ表示されていません</strong>
              <p>Excelファイルを選択し、アップロードを確定すると出力フォーマットを表示します。</p>
            </div>
          )}
      </section>

      <footer className='sheet-footer'>
        <div className='sheet-meta'>
          <span>
            入力件数{' '}
            {pickupConfirmation ? pickupConfirmation.stats.inputRows.toLocaleString('ja-JP') : '—'}
          </span>
          <span>
            在庫照合件数{' '}
            {pickupConfirmation
              ? pickupConfirmation.stats.matchedRows.toLocaleString('ja-JP')
              : '—'}
          </span>
          <span>
            出力件数{' '}
            {pickupConfirmation ? pickupConfirmation.stats.outputRows.toLocaleString('ja-JP') : '—'}
          </span>
          <span
            className={`status-badge${pickupStatus.kind === 'error' ? ' error' : ''}${
              pickupConfirmation ? ' success' : ''
            }`}
            role='status'
            aria-live='polite'
          >
            {pickupState}
          </span>
        </div>
      </footer>
    </div>
  );
}
