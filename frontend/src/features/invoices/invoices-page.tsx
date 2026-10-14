import { formatMinor } from '@sharing/shared';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { formatDateTime, formatMinutes } from '../../lib/format';
import { useInvoices } from '../account/use-account';

/**
 * Счета с разбором.
 *
 * Разбор показывается строками, а не итогом: пользователь должен видеть, из чего сложилась сумма —
 * посадка, минуты езды и минуты паузы по своим тарифам.
 */
export function InvoicesPage() {
  const { data, loading, error, reload } = useInvoices();
  const total = data.reduce((sum, invoice) => sum + invoice.amount, 0);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle>Счета</CardTitle>
          <CardDescription>
            {loading
              ? 'Загружаем счета…'
              : `Всего счетов: ${data.length} · на сумму ${formatMinor(total, 'сом')}`}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {error !== null && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
              <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={reload}>
                Повторить
              </Button>
            </div>
          )}

          {error === null && (
            <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="invoices-list">
              {data.map((invoice) => (
                <li key={invoice.id} className="rounded-lg border p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    {/* Дата счёта — момент выставления (поездка завершилась), а не её начало: так
                        «Поездки» и «Счета» не выглядят расходящимися по времени. */}
                    <span className="text-sm font-medium">
                      {`Счёт от ${formatDateTime(invoice.issuedAt)}`}
                    </span>
                    <span className="tabular text-sm font-semibold">
                      {formatMinor(invoice.amount, invoice.currency === 'KGS' ? 'сом' : invoice.currency)}
                    </span>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <dt>Посадка</dt>
                    <dd className="tabular text-right">
                      {formatMinor(invoice.breakdown.unlockFee, 'сом')}
                    </dd>
                    <dt>Езда · {formatMinutes(invoice.breakdown.rideMinutes)}</dt>
                    <dd className="tabular text-right">
                      {formatMinor(invoice.breakdown.rideAmount, 'сом')}
                    </dd>
                    <dt>Пауза · {formatMinutes(invoice.breakdown.pauseMinutes)}</dt>
                    <dd className="tabular text-right">
                      {formatMinor(invoice.breakdown.pauseAmount, 'сом')}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}

          {error === null && !loading && data.length === 0 && (
            <p className="text-sm text-muted-foreground">Счетов пока нет</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
