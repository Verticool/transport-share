import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { useSessionStore } from '../../stores/session';
import { useLogin } from './use-account';

/**
 * Экран входа.
 *
 * Поля заполнены демонстрационными данными, потому что на мок-стадии пароль у всех пользователей
 * один (см. `DEMO_PASSWORD` в мок-клиенте). Регистрации нет: по ТЗ учётные записи можно
 * ограничить входом, а пользователи приходят из данных.
 */
export function LoginPage() {
  const { busy, error, signIn } = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('demo@sharing.kg');
  const [password, setPassword] = useState('demo1234');
  const user = useSessionStore((state) => state.user);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const ok = await signIn(email, password);
    if (ok) {
      void navigate('/map');
    }
  };

  return (
    <div className="grid h-full place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Вход в Движ</CardTitle>
          <CardDescription>
            {user === null
              ? 'Войдите, чтобы видеть поездки, счета и письма'
              : `Вы вошли как ${user.name}`}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
            <label className="flex flex-col gap-1 text-sm">
              Почта
              <Input
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error !== null}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Пароль
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={error !== null}
              />
            </label>

            {error !== null && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy}>
              Войти
            </Button>

            <p className="text-xs text-muted-foreground">
              Демонстрационный доступ: demo@sharing.kg / demo1234
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
