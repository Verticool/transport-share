import { useEffect, useState } from 'react';

import { useNotificationsStore } from '../../stores/notifications';

/**
 * Состояние сети.
 *
 * Пока связи нет, под хедером висит постоянная полоса: интерфейс продолжает показывать последние
 * данные, и человек должен понимать, что они могут отставать. Когда связь возвращается, полоса
 * убирается, а вместо неё ненадолго всплывает «доступ восстановлен».
 */
export function useConnectivity(): { online: boolean } {
  const setPersistent = useNotificationsStore((state) => state.setPersistent);
  const clearPersistent = useNotificationsStore((state) => state.clearPersistent);
  const toast = useNotificationsStore((state) => state.toast);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOffline = (): void => {
      setOnline(false);
      setPersistent({
        key: 'network',
        title: 'Нет доступа к интернету',
        description: 'Показаны последние полученные данные: они могут отставать. Поездка не теряется.',
        tone: 'danger',
      });
    };

    const goOnline = (): void => {
      setOnline(true);
      clearPersistent('network');
      toast({
        key: 'network-restored',
        title: 'Доступ восстановлен',
        description: 'Данные снова обновляются.',
        tone: 'success',
        autoHideMs: 5000,
      });
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    // Старт без сети: событие уже не придёт, поэтому проверяем состояние сами.
    if (!navigator.onLine) {
      goOffline();
    }

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [clearPersistent, setPersistent, toast]);

  return { online };
}
