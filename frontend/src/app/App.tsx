import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '../components/layout/app-shell';
import { MapPage } from '../features/map/map-page';
import { AccountPage } from '../features/account/account-page';
import { LoginPage } from '../features/account/login-page';
import { InboxPage } from '../features/inbox/inbox-page';
import { InvoicesPage } from '../features/invoices/invoices-page';
import { RidesPage } from '../features/rides/rides-page';
import { useSessionStore } from '../stores/session';

/**
 * Защита экранов кабинета.
 *
 * Карта открыта всем — она показывает парк. А бронь, поездки, счета и письма привязаны к аккаунту:
 * на сервере (S11) это запросы с токеном, поэтому интерфейс закрывает их входом, а не показывает
 * пустые экраны.
 */
function RequireAuth({ children }: { readonly children: ReactNode }) {
  const token = useSessionStore((state) => state.token);

  if (token === null) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/** Корень приложения: раскладка + маршруты экранов. */
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<MapPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="rides"
          element={
            <RequireAuth>
              <RidesPage />
            </RequireAuth>
          }
        />
        <Route
          path="invoices"
          element={
            <RequireAuth>
              <InvoicesPage />
            </RequireAuth>
          }
        />
        <Route
          path="inbox"
          element={
            <RequireAuth>
              <InboxPage />
            </RequireAuth>
          }
        />
        <Route
          path="account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
