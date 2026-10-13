import { formatMinor } from '@sharing/shared';
import { LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { formatDateTime } from '../../lib/format';
import { useSessionStore } from '../../stores/session';
import { useEmails, useInvoices, useLogout, useRides } from './use-account';

/**
 * Кабинет: кто вошёл, сводка по поездкам и счетам, выход.
 *
 * Сводка собирается из тех же данных, что и отдельные экраны: отдельного «счётчика» на сервере нет,
 * иначе он рано или поздно разошёлся бы со списками.
 */
export function AccountPage() {
  const user = useSessionStore((state) => state.user);
  const logout = useLogout();
  const rides = useRides(0);
  const invoices = useInvoices();
  const emails = useEmails();

  if (user === null) {
    return null;
  }

  const paid = invoices.data.reduce((sum, invoice) => sum + invoice.amount, 0);

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>{user.name}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted-foreground">Почта</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">В сервисе с</dt>
            <dd>{formatDateTime(user.createdAt)}</dd>
          </dl>

          <div className="grid grid-cols-3 gap-2">
            <SummaryTile label="Поездок" value={String(rides.data.total)} loading={rides.loading} />
            <SummaryTile label="Счетов" value={String(invoices.data.length)} loading={invoices.loading} />
            <SummaryTile label="Потрачено" value={formatMinor(paid, 'сом')} loading={invoices.loading} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/rides">История поездок</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/invoices">Счета</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/inbox">Входящие{emails.data.length > 0 ? ` · ${emails.data.length}` : ''}</Link>
            </Button>
          </div>

          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={logout}>
            <LogOut aria-hidden />
            Выйти
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: string;
  loading: boolean;
}

/** Плитка сводки: одно число и подпись. */
function SummaryTile({ label, value, loading }: SummaryTileProps) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular text-base font-semibold">{loading ? '…' : value}</div>
    </div>
  );
}
