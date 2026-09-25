import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, type ToastMessage, type ToolbarAction } from './components/app-shell.tsx';
import { BrandMark } from './components/brand-mark.tsx';
import { LoginPage } from './pages/login-page.tsx';
import { type PendingFileDrop, PickupListPage } from './pages/pickup-list-page.tsx';
import { ProductsPage } from './pages/products-page.tsx';
import { apiUrl } from './utils/api.ts';
import { type View, VIEW_PATHS, viewFromPathname } from './utils/routing.ts';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; username: string };

function unavailableToolbarAction(title: string): ToolbarAction {
  return {
    disabled: true,
    loading: false,
    title,
    label: 'Excelダウンロード',
    loadingLabel: 'Excelダウンロード',
    onClick: () => undefined,
  };
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });
  const [view, setView] = useState<View>(() =>
    viewFromPathname(globalThis.location.pathname) ?? 'products'
  );
  const [pendingPickupDrop, setPendingPickupDrop] = useState<PendingFileDrop | null>(null);
  const [productToolbar, setProductToolbar] = useState<ToolbarAction>(() =>
    unavailableToolbarAction('表示中の商品データをExcelでダウンロード')
  );
  const [pickupToolbar, setPickupToolbar] = useState<ToolbarAction>(() =>
    unavailableToolbarAction('アップロード確定後に利用できます')
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const dropSequence = useRef(0);

  const showToast = useCallback((message: string, kind: ToastMessage['kind'] = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, kind, message }]);
    globalThis.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const navigateToView = useCallback((nextView: View) => {
    const nextPath = VIEW_PATHS[nextView];
    if (globalThis.location.pathname !== nextPath) {
      globalThis.history.pushState(null, '', nextPath);
    }
    setView(nextView);
  }, []);

  useEffect(() => {
    const syncViewWithUrl = () => {
      const nextView = viewFromPathname(globalThis.location.pathname);
      if (!nextView) {
        globalThis.history.replaceState(null, '', VIEW_PATHS.products);
        setView('products');
        return;
      }
      const canonicalPath = VIEW_PATHS[nextView];
      if (globalThis.location.pathname !== canonicalPath) {
        globalThis.history.replaceState(null, '', canonicalPath);
      }
      setView(nextView);
    };

    syncViewWithUrl();
    globalThis.addEventListener('popstate', syncViewWithUrl);
    return () => globalThis.removeEventListener('popstate', syncViewWithUrl);
  }, []);

  useEffect(() => {
    fetch(apiUrl('api/auth/session'))
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as { username: string };
      })
      .then((session) => setAuth({ kind: 'authenticated', username: session.username }))
      .catch(() => setAuth({ kind: 'anonymous' }));
  }, []);

  const resetAuthenticatedState = useCallback(() => {
    setPendingPickupDrop(null);
    setProductToolbar(unavailableToolbarAction('表示中の商品データをExcelでダウンロード'));
    setPickupToolbar(unavailableToolbarAction('アップロード確定後に利用できます'));
    setToasts([]);
  }, []);

  const handleUnauthorized = useCallback(() => {
    resetAuthenticatedState();
    setAuth({ kind: 'anonymous' });
  }, [resetAuthenticatedState]);

  const logout = useCallback(async () => {
    await fetch(apiUrl('api/auth/logout'), { method: 'POST' }).catch(() => undefined);
    resetAuthenticatedState();
    setAuth({ kind: 'anonymous' });
  }, [resetAuthenticatedState]);

  const handDroppedFilesToPickupPage = useCallback((files: File[]) => {
    navigateToView('pickup');
    dropSequence.current += 1;
    setPendingPickupDrop({ id: dropSequence.current, files });
  }, [navigateToView]);

  if (auth.kind === 'loading') {
    return (
      <div className='app-frame'>
        <BrandMark />
        <main className='auth-shell'>
          <span className='spinner' aria-hidden='true' />
          <span className='sr-only'>読み込んでいます</span>
        </main>
      </div>
    );
  }

  if (auth.kind === 'anonymous') {
    return (
      <LoginPage
        onAuthenticated={(username) => setAuth({ kind: 'authenticated', username })}
      />
    );
  }

  return (
    <AppShell
      username={auth.username}
      view={view}
      toolbarAction={view === 'products' ? productToolbar : pickupToolbar}
      toasts={toasts}
      onNavigate={navigateToView}
      onLogout={logout}
      onFilesDropped={handDroppedFilesToPickupPage}
    >
      <ProductsPage
        active={view === 'products'}
        onUnauthorized={handleUnauthorized}
        onToolbarChange={setProductToolbar}
        showToast={showToast}
      />
      <PickupListPage
        active={view === 'pickup'}
        pendingDrop={pendingPickupDrop}
        onUnauthorized={handleUnauthorized}
        onToolbarChange={setPickupToolbar}
        showToast={showToast}
      />
    </AppShell>
  );
}
