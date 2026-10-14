import { useEffect, useRef } from 'react';

import { SERVICE_ZONE, isInsideZone } from '@sharing/shared';

import { useNotificationsStore } from '../../stores/notifications';

interface ZoneNoticeParams {
  /** Идёт ли поездка: вне поездки сообщать не о чем. */
  active: boolean;
  /** Где сейчас самокат поездки; null — положение ещё неизвестно. */
  position: { lat: number; lng: number } | null;
}

/**
 * Выезд за границу зоны обслуживания.
 *
 * Вне зоны самокат не тянет: мотор блокируется, а поездка продолжает тарифицироваться. Это то
 * состояние, в котором легко потерять деньги, не заметив его (в панели поездки предупреждение
 * видно, а на карте — нет). Поэтому: постоянная полоса под хедером, пока самокат вне зоны, и
 * одно всплывающее оповещение на каждый выезд — с тем же звуком, что и остальные события.
 *
 * Возвращение в зону тоже сообщается: человек дотолкал самокат и должен знать, что мотор снова
 * работает и поездку можно закрыть.
 */
export function useRideZoneNotice({ active, position }: ZoneNoticeParams): void {
  const setPersistent = useNotificationsStore((state) => state.setPersistent);
  const clearPersistent = useNotificationsStore((state) => state.clearPersistent);
  const toast = useNotificationsStore((state) => state.toast);
  // Помним, что о выезде уже сказали: парковый поток присылает положение несколько раз в секунду,
  // и без этого флага всплывающее оповещение повторялось бы на каждом обновлении.
  const announcedRef = useRef(false);

  const lat = position?.lat ?? null;
  const lng = position?.lng ?? null;

  useEffect(() => {
    if (!active || lat === null || lng === null) {
      clearPersistent('outside-zone');
      announcedRef.current = false;
      return;
    }

    if (isInsideZone({ lat, lng }, SERVICE_ZONE)) {
      clearPersistent('outside-zone');
      if (announcedRef.current) {
        announcedRef.current = false;
        toast({
          key: 'back-in-zone',
          title: 'Снова в зоне обслуживания',
          description: 'Мотор разблокирован — поездку можно завершить.',
          tone: 'success',
          autoHideMs: 8000,
        });
      }
      return;
    }

    setPersistent({
      key: 'outside-zone',
      title: 'Вы выехали из зоны обслуживания',
      description:
        'Мотор заблокирован: дотолкайте самокат обратно в зону. Пока поездка открыта, время тарифицируется.',
      tone: 'danger',
    });

    if (!announcedRef.current) {
      announcedRef.current = true;
      toast({
        key: 'outside-zone',
        title: 'Вы выехали из зоны обслуживания',
        description: 'Самокат не тянет: дотолкайте его в зону — мотор включится, и поездку можно завершить.',
        tone: 'danger',
        autoHideMs: 9000,
      });
    }
  }, [active, lat, lng, clearPersistent, setPersistent, toast]);
}
