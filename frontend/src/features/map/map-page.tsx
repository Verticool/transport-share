import { isInsideZone } from '@sharing/shared';
import type { ScooterStatus } from '@sharing/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BookingPanel } from '../booking/booking-panel';
import { useBooking } from '../booking/use-booking';
import { RidePanel } from '../ride/ride-panel';
import { useRide } from '../ride/use-ride';
import { ZONE } from '../../config/map';
import { MapCanvas } from './map-canvas';
import { ParkPanel } from './park-panel';
import { ScooterCard } from './scooter-card';
import { usePark } from './use-park';
import { SCOOTER_STATUS_ORDER } from '../../config/scooter-status';
import { useSessionStore } from '../../stores/session';

/**
 * Экран карты: слева карта парка, справа панель — поездка, бронь или список самокатов.
 *
 * Порядок панелей отражает приоритет для пользователя: идёт поездка — показываем поездку,
 * есть бронь — показываем бронь, иначе выбранный самокат и список парка. Данные приходят
 * одним срезом, поэтому карта, список и панель всегда согласованы.
 */
export function MapPage() {
  const { scooters, loading, error, live, changeTick, reload } = usePark();
  const {
    booking,
    remainingMs,
    expiresSoon,
    loading: bookingBusy,
    error: bookingError,
    book,
    cancel,
    refresh: refreshBooking,
  } = useBooking();
  const ride = useRide();
  const token = useSessionStore((state) => state.token);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Фильтр состояний общий для карты и списка: снятая галочка убирает маркеры с карты.
  const [statusFilter, setStatusFilter] = useState<ScooterStatus[]>(() => [...SCOOTER_STATUS_ORDER]);
  const toggleStatus = useCallback((status: ScooterStatus): void => {
    setStatusFilter((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : [...current, status],
    );
  }, []);
  const visibleScooters = useMemo(
    () => scooters.filter((scooter) => statusFilter.includes(scooter.status)),
    [scooters, statusFilter],
  );

  /**
   * Начать поездку из брони.
   *
   * После старта бронь на стороне данных израсходована, поэтому её состояние перезапрашиваем:
   * иначе панель продолжит показывать бронь, которой уже нет (проверено вживую).
   */
  const handleStartRide = async (bookingId: string): Promise<void> => {
    await ride.start(bookingId);
    refreshBooking();
  };

  /** Завершение поездки: обновляем и бронь (её уже нет), и парк — самокат вернулся на линию. */
  const handleFinishRide = async (): Promise<void> => {
    await ride.finish();
    refreshBooking();
    reload();
  };

  // Парк перечитываем, когда меняется состояние на стороне данных: бронь, её снятие, поездка.
  // Первый рендер пропускаем, иначе получим лишний запрос на старте.
  const previousState = useRef('init');
  useEffect(() => {
    const current = `${booking?.id ?? 'no-booking'}|${ride.ride?.status ?? 'no-ride'}|${ride.ride?.id ?? ''}`;
    if (previousState.current !== current) {
      previousState.current = current;
      reload();
    }
  }, [booking, ride.ride, reload]);

  // События потока (бронь оформлена, поездка началась или закрылась) приходят от сервера:
  // по ним перезапрашиваем своё состояние, а не ждём следующего действия пользователя.
  useEffect(() => {
    if (changeTick === 0) {
      return;
    }
    refreshBooking();
  }, [changeTick, refreshBooking]);

  const selected = scooters.find((scooter) => scooter.id === selectedId) ?? null;
  const bookedScooter =
    booking === null ? null : (scooters.find((scooter) => scooter.id === booking.scooterId) ?? null);
  const rideScooter =
    ride.ride === null
      ? null
      : (scooters.find((scooter) => scooter.id === ride.ride?.scooterId) ?? null);

  const activeRide = ride.ride !== null && ride.ride.status !== 'finished';
  // Завершить поездку можно только внутри зоны: самокат сам не двигается (симулятор — S9),
  // но положение берём из данных, а не из предположений интерфейса.
  const canFinishHere =
    rideScooter === null || isInsideZone({ lat: rideScooter.lat, lng: rideScooter.lng }, ZONE);

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative min-h-[420px] overflow-hidden rounded-xl border">
        <MapCanvas
          scooters={visibleScooters}
          selectedId={selectedId ?? ride.ride?.scooterId ?? null}
          onSelect={setSelectedId}
        />
      </div>

      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto" aria-label="Панель парка">
        {activeRide && ride.ride !== null && rideScooter !== null && (
          <RidePanel
            scooterCode={rideScooter.code}
            status={ride.ride.status}
            elapsedSeconds={ride.elapsedSeconds}
            rideMinutes={ride.rideMinutes}
            pauseMinutes={ride.pauseMinutes}
            amount={ride.amount}
            currencySymbol={ride.tariff.currencySymbol}
            canFinishHere={canFinishHere}
            offline={ride.offline}
            busy={ride.busy}
            error={ride.error}
            onPause={() => {
              void ride.pause();
            }}
            onResume={() => {
              void ride.resume();
            }}
            onFinish={() => {
              void handleFinishRide();
            }}
            onPushToZone={() => {
              void ride.pushToZone();
            }}
          />
        )}

        {!activeRide && booking !== null && bookedScooter !== null && (
          <BookingPanel
            scooterCode={bookedScooter.code}
            remainingMs={remainingMs}
            expiresSoon={expiresSoon}
            busy={bookingBusy}
            onStart={() => {
              void handleStartRide(booking.id);
            }}
            onCancel={() => {
              void cancel();
            }}
          />
        )}

        {selected !== null && booking === null && !activeRide && (
          <ScooterCard
            scooter={selected}
            busy={bookingBusy}
            error={bookingError}
            needsAuth={token === null}
            onBook={(scooterId) => {
              void book(scooterId);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}

        {/* Выбран другой самокат, пока идёт поездка или держится бронь: вторую взять нельзя.
            Поясняем словами и называем самокат, к которому нужно вернуться, — но панель не
            разрастается, иначе список самокатов уезжает за пределы экрана. */}
        {selected !== null &&
          (activeRide || booking !== null) &&
          (rideScooter !== null || bookedScooter !== null) && (
            <p
              className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
              data-testid="scooter-card-blocked"
            >
              {activeRide && rideScooter !== null
                ? `Другой самокат взять нельзя, пока идёт поездка на ${rideScooter.code}: две поездки одновременно не поддерживаются.`
                : `Другой самокат взять нельзя, пока держится бронь на ${bookedScooter?.code ?? ''}: начните поездку или снимите бронь.`}
            </p>
          )}

        <ParkPanel
          scooters={visibleScooters}
          allScooters={scooters}
          statusFilter={statusFilter}
          onToggleStatus={toggleStatus}
          loading={loading}
          error={error}
          selectedId={selectedId}
          live={live}
          onSelect={setSelectedId}
          onReload={reload}
        />
      </aside>
    </div>
  );
}
