import { Mail } from 'lucide-react';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { formatDateTime } from '../../lib/format';
import { useEmails } from '../account/use-account';

/**
 * Входящие.
 *
 * Почта эмулятора: настоящих писем никто не отправляет, письма лежат в данных. Ключ `dedupeKey`
 * гарантирует одно письмо на одну поездку — это требование ТЗ, а не деталь реализации.
 */
export function InboxPage() {
  const { data, loading, error, reload } = useEmails();

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle>Входящие</CardTitle>
          <CardDescription>
            {loading ? 'Загружаем письма…' : `Писем: ${data.length} · почта эмулируется`}
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
            <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="inbox-list">
              {data.map((email) => (
                <li key={email.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">{email.subject}</span>
                    <span className="tabular ml-auto text-xs text-muted-foreground">
                      {formatDateTime(email.sentAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{email.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Кому: <span className="font-mono">{email.toEmail}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}

          {error === null && !loading && data.length === 0 && (
            <p className="text-sm text-muted-foreground">Писем пока нет</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
