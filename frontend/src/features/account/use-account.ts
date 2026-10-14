import type { EmailMessage, Invoice, PublicUser } from '@sharing/shared';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiClientError,
  createApiClient,
  type ApiClient,
  type Page,
  type PageQuery,
  type RideListItem,
} from '../../lib/api';
import { useSessionStore } from '../../stores/session';

/** Размер страницы истории поездок. */
export const RIDES_PAGE_SIZE = 10;

interface Loadable<T> {
  data: T;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Общий приём для экранов кабинета: запрос к источнику данных с состояниями загрузки и ошибки.
 *
 * Вынесен отдельно, потому что история, счета и входящие отличаются только вызовом и типом
 * ответа — дублировать эту логику трижды означало бы однажды починить её в одном месте из трёх.
 */
function useLoaded<T>(
  load: (client: ApiClient, token: string) => Promise<T>,
  initial: T,
  deps: readonly unknown[],
): Loadable<T> {
  const [client] = useState<ApiClient>(() => createApiClient());
  const token = useSessionStore((state) => state.token);
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (token === null) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = await load(client, token);
        if (active) {
          setData(result);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof ApiClientError ? caught.message : 'Не удалось загрузить данные');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
    // `load` — встроенная стрелка, она новая на каждом рендере; перезапрос задают deps ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, token, attempt, ...deps]);

  const reload = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return { data, loading, error, reload };
}

/** История поездок постранично. */
export function useRides(page: number): Loadable<Page<RideListItem>> & { readonly page: number } {
  const query: PageQuery = { limit: RIDES_PAGE_SIZE, offset: page * RIDES_PAGE_SIZE };

  const state = useLoaded<Page<RideListItem>>(
    (client, token) => client.getRides({ limit: query.limit, offset: query.offset }, token),
    { items: [], total: 0, limit: RIDES_PAGE_SIZE, offset: 0 },
    [query.limit, query.offset],
  );

  return { ...state, page };
}

/** Счета пользователя. */
export function useInvoices(): Loadable<Invoice[]> {
  return useLoaded<Invoice[]>((client, token) => client.getInvoices(token), [], []);
}

/** Входящие письма. */
export function useEmails(): Loadable<EmailMessage[]> {
  return useLoaded<EmailMessage[]>((client, token) => client.getEmails(token), [], []);
}

export interface LoginState {
  user: PublicUser | null;
  busy: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
}

/** Вход в аккаунт: результат кладётся в общий стор сессии. */
export function useLogin(): LoginState {
  const [client] = useState<ApiClient>(() => createApiClient());
  const signInStore = useSessionStore((state) => state.signIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);

  const signIn = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setBusy(true);
      try {
        const session = await client.login(email, password);
        signInStore(session);
        setUser(session.user);
        setError(null);
        return true;
      } catch (caught) {
        setError(caught instanceof ApiClientError ? caught.message : 'Не удалось войти');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client, signInStore],
  );

  return { user, busy, error, signIn };
}

/** Выход: токен гасится на стороне данных и в хранилище. */
export function useLogout(): () => void {
  const [client] = useState<ApiClient>(() => createApiClient());
  const token = useSessionStore((state) => state.token);
  const signOut = useSessionStore((state) => state.signOut);

  return useCallback(() => {
    if (token !== null) {
      void client.logout(token).catch(() => undefined);
    }
    signOut();
  }, [client, signOut, token]);
}
