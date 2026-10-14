import { LOW_BATTERY_THRESHOLD, isInsideZone } from '@sharing/shared';
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
import { scooterDistanceM } from '../../lib/map/scooter-layer';
import { useNotificationsStore } from '../../stores/notifications';
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
    shorten,
    refresh: refreshBooking,
  } = useBooking();
  const ride = useRide();
  const token = useSessionStore((state) => state.token);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Колонка панелей: при старте поездки или появлении брони её содержимое поднимается к началу,
  // иначе верхний блок (поездка с управлением) остаётся выше области просмотра.
  const asideRef = useRef<HTMLDivElement | null>(null);
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
  const panelKey = ride.ride === null ? (booking === null ? null : 'booking') : 'ride';
  useEffect(() => {
    if (panelKey !== null) {
      asideRef.current?.scrollTo({ top: 0 });
    }
  }, [panelKey]);
  // Заряд самоката поездки: панель поездки показывает его рядом с состоянием и обновляет вместе
  // с парком — приезжает тем же потоком, что и остальные данные.
  const rideBattery = rideScooter?.batteryPct ?? null;
  const setPersistent = useNotificationsStore((state) => state.setPersistent);
  const clearPersistent = useNotificationsStore((state) => state.clearPersistent);
  const toast = useNotificationsStore((state) => state.toast);
  // О всплывающем предупреждении помним по идентификатору поездки: оно нужно один раз за поездку.
  const lowBatteryNotifiedRef = useRef<string | null>(null);
  const finishedNotifiedRef = useRef<string | null>(null);
  // Замена на случай, когда батарея садится: ближайший свободный самокат к текущему. Считаем по
  // данным парка, поэтому подсказка живая — самокаты рядом меняются вместе с потоком.
  const rideReplacement = useMemo(() => {
    if (rideScooter === null) {
      return null;
    }
    const from = { lat: rideScooter.lat, lng: rideScooter.lng };
    let best: { code: string; distanceM: number } | null = null;
    for (const scooter of scooters) {
      if (scooter.status !== 'free') {
        continue;
      }
      const distanceM = scooterDistanceM(scooter, from);
      if (best === null || distanceM < best.distanceM) {
        best = { code: scooter.code, distanceM };
      }
    }
    return best;
  }, [rideScooter, scooters]);
  // Завершить поездку можно только внутри зоны: самокат сам не двигается (симулятор — S9),
  // но положение берём из данных, а не из предположений интерфейса.
  const canFinishHere =
    rideScooter === null || isInsideZone({ lat: rideScooter.lat, lng: rideScooter.lng }, ZONE);

  // Низкий заряд: постоянная полоса под хедером (её видно с любого экрана) плюс одно всплывающее
  // предупреждение за поездку. Раньше это жило только внутри панели поездки и терялось.
  useEffect(() => {
    if (!activeRide || rideBattery === null) {
      clearPersistent('low-battery');
      return;
    }
    if (rideBattery >= LOW_BATTERY_THRESHOLD) {
      clearPersistent('low-battery');
      return;
    }

    setPersistent({
      key: 'low-battery',
      title: `Батарея почти пуста: заряд ${rideBattery} %`,
      description: 'Самокат отключится сам — пора искать замену и завершить поездку в зоне.',
      tone: 'warning',
    });

    const rideId = ride.ride?.id ?? null;
    if (rideId !== null && lowBatteryNotifiedRef.current !== rideId) {
      lowBatteryNotifiedRef.current = rideId;
      toast({
        key: 'low-battery',
        title: `Батарея почти пуста: заряд ${rideBattery} %`,
        description: 'Пора искать замену: самокат скоро отключится сам.',
        tone: 'warning',
        autoHideMs: 8000,
      });
    }
  }, [activeRide, rideBattery, ride.ride?.id, clearPersistent, setPersistent, toast]);
  // Поездка или бронь появились — поднимаем колонку к началу: панель с управлением должна быть
  // видна сразу, а не оставаться прокрученной вниз к списку парка.
  // Поездка закрылась по разряду: сообщаем всплывающим оповещением и убираем полосу про батарею.
  useEffect(() => {
    const current = ride.ride;
    if (current === null) {
      return;
    }
    if (current.status === 'finished' && current.endReason === 'battery_depleted' && finishedNotifiedRef.current !== current.id) {
      finishedNotifiedRef.current = current.id;
      clearPersistent('low-battery');
      toast({
        key: 'ride-battery-finished',
        title: 'Поездка завершена: самокат разрядился',
        description: 'Счёт отправлен во «Входящие», самокат в парке помечен недоступным.',
        tone: 'info',
        autoHideMs: 9000,
      });
    }
  }, [ride.ride, clearPersistent, toast]);

  return (
    // Экран занимает всю доступную высоту: на телефоне карта получает верхнюю половину, панель —
    // остальное и прокручивается сама. Иначе карта сжималась, а панель выдавливала её за экран.
    // На телефоне карта занимает верхнюю треть, панель — остальное: таблице парка нужно больше
    // высоты, чем помещалось при «карта 45 % / панель 55 %».
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(180px,34%)_minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1 lg:gap-4 lg:p-4">
      <div className="relative min-h-0 overflow-hidden rounded-xl border">
        <MapCanvas
          scooters={visibleScooters}
          selectedId={selectedId ?? ride.ride?.scooterId ?? null}
          onSelect={setSelectedId}
          // Клик по пустому месту карты снимает выделение, пока нет поездки: во время поездки
          // карта держит самокат, за которым следит клиент.
          onClearSelect={activeRide ? undefined : () => setSelectedId(null)}
        />
      </div>

      <aside
        ref={asideRef}
        data-scroll-container
        className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-0.5 lg:gap-4"
        aria-label="Панель парка"
      >
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
            batteryPct={rideBattery}
            replacement={rideReplacement}
            onSteer={(direction, stepM) => {
              void ride.steer(direction, stepM);
            }}
            onDrain={(pct) => {
              void ride.drain(pct);
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
            onShorten={(minutes) => {
              void shorten(minutes);
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
