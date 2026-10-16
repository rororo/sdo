import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type View, VIEW_PATHS } from '../utils/routing.ts';
import { BrandMark } from './brand-mark.tsx';

export interface ToolbarAction {
  disabled: boolean;
  loading: boolean;
  title: string;
  label: string;
  loadingLabel: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

interface AppShellProps {
  username: string;
  view: View;
  toolbarAction: ToolbarAction;
  toasts: ToastMessage[];
  children: ReactNode;
  onNavigate: (view: View) => void;
  onLogout: () => Promise<void>;
  onFilesDropped: (files: File[]) => void;
}

function initialsFor(username: string): string {
  const words = username
    .replace(/[^A-Za-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('') || 'U';
}

function hasDraggedFiles(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

export function AppShell({
  username,
  view,
  toolbarAction,
  toasts,
  children,
  onNavigate,
  onLogout,
  onFilesDropped,
}: AppShellProps) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const dragDepth = useRef(0);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeMenu = (event: globalThis.MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    globalThis.addEventListener('pointerdown', closeMenu);
    globalThis.addEventListener('keydown', closeOnEscape);
    return () => {
      globalThis.removeEventListener('pointerdown', closeMenu);
      globalThis.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountMenuOpen]);

  const switchView = (event: ReactMouseEvent<HTMLAnchorElement>, nextView: View) => {
    if (
      event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey
    ) return;
    event.preventDefault();
    onNavigate(nextView);
  };

  const beginFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDraggingFile(true);
  };

  const continueFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const endFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!isDraggingFile) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDraggingFile(false);
  };

  const dropFiles = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event) && event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    dragDepth.current = 0;
    setIsDraggingFile(false);
    onFilesDropped(Array.from(event.dataTransfer.files));
  };

  return (
    <main
      className='sheet-app'
      onDragEnter={beginFileDrag}
      onDragOver={continueFileDrag}
      onDragLeave={endFileDrag}
      onDrop={dropFiles}
    >
      <BrandMark />

      {isDraggingFile && (
        <div className='file-drop-overlay' role='status' aria-live='polite'>
          <div>
            <strong>Excelファイルをドロップ</strong>
            <span>.xlsx 形式、1ファイル、20MBまで</span>
          </div>
        </div>
      )}

      <header className='sheet-toolbar'>
        <nav className='view-switcher' aria-label='画面切り替え'>
          <a
            href={VIEW_PATHS.products}
            className={view === 'products' ? 'active' : ''}
            aria-current={view === 'products' ? 'page' : undefined}
            onClick={(event) => switchView(event, 'products')}
          >
            <svg className='nav-icon' aria-hidden='true' viewBox='0 0 16 16'>
              <path d='M2.6 3.4h10.8v9.2H2.6zM2.6 6.4h10.8M6.4 6.4v6.2' />
            </svg>
            <span>商品一覧</span>
          </a>
          <a
            href={VIEW_PATHS.kyokaProducts}
            className={view === 'kyokaProducts' ? 'active' : ''}
            aria-current={view === 'kyokaProducts' ? 'page' : undefined}
            onClick={(event) => switchView(event, 'kyokaProducts')}
          >
            <span>強化品番商品一覧</span>
          </a>
          <a
            href={VIEW_PATHS.pickup}
            className={view === 'pickup' ? 'active' : ''}
            aria-current={view === 'pickup' ? 'page' : undefined}
            onClick={(event) => switchView(event, 'pickup')}
          >
            <svg className='nav-icon' aria-hidden='true' viewBox='0 0 16 16'>
              <path d='M4.2 2.6h4.6l3 3v7.8H4.2zM8.8 2.6v3h3M6 9.4l1.5 1.5 2.6-2.9' />
            </svg>
            <span>ピックアップリスト</span>
          </a>
          <a
            href={VIEW_PATHS.kyoka}
            className={view === 'kyoka' ? 'active' : ''}
            aria-current={view === 'kyoka' ? 'page' : undefined}
            onClick={(event) => switchView(event, 'kyoka')}
          >
            <span>強化品番ピックアップ</span>
          </a>
        </nav>

        <div className='toolbar-actions'>
          <button
            className='download-button'
            type='button'
            onClick={toolbarAction.onClick}
            disabled={toolbarAction.disabled}
            title={toolbarAction.title}
          >
            {toolbarAction.loading
              ? <span className='spinner' aria-hidden='true' />
              : (
                <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                  <path d='M8 2v7.5M4.75 6.75 8 10l3.25-3.25M2.5 11.5v1A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-1' />
                </svg>
              )}
            <span>{toolbarAction.loading ? toolbarAction.loadingLabel : toolbarAction.label}</span>
          </button>
          <span className='toolbar-divider' aria-hidden='true' />
          <div className='account-menu' ref={accountMenuRef}>
            <button
              className={`avatar-button${accountMenuOpen ? ' active' : ''}`}
              type='button'
              aria-haspopup='menu'
              aria-expanded={accountMenuOpen}
              aria-label={`アカウントメニュー: ${username}`}
              title={username}
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              {initialsFor(username)}
            </button>
            {accountMenuOpen && (
              <div className='account-popover' role='menu'>
                <div className='account-summary'>
                  <span className='account-avatar-small' aria-hidden='true'>
                    {initialsFor(username)}
                  </span>
                  <span>
                    <strong>{username}</strong>
                    <small>ログイン中</small>
                  </span>
                </div>
                <button
                  type='button'
                  role='menuitem'
                  onClick={() => {
                    setAccountMenuOpen(false);
                    void onLogout();
                  }}
                >
                  <svg className='button-icon' aria-hidden='true' viewBox='0 0 16 16'>
                    <path d='M9.5 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h5.5M11 5.5 13.5 8 11 10.5M13.5 8H6.5' />
                  </svg>
                  <span>ログアウト</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className='workspace'>{children}</div>

      <div className='toast-region' aria-live='polite'>
        {toasts.map((toast) => (
          <div className={`toast ${toast.kind}`} key={toast.id}>
            <span aria-hidden='true' />
            <p>{toast.message}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
