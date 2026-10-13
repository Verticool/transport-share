import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '../components/layout/app-shell';
import { MapPage } from '../features/map/map-page';
import { AccountPage } from '../features/account/account-page';
import { RidesPage } from '../features/rides/rides-page';

/** Корень приложения: раскладка + маршруты экранов. */
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<MapPage />} />
        <Route path="rides" element={<RidesPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
