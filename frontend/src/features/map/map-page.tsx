import { useEffect, useRef, useState } from 'react';

import { BookingPanel } from '../booking/booking-panel';
import { useBooking } from '../booking/use-booking';
import { MapCanvas } from './map-canvas';
import { ParkPanel } from './park-panel';
import { ScooterCard } from './scooter-card';
import { usePark } from './use-park';

/**
 * Экран карты: слева карта парка, справа панель с активной бронью или списком самокатов.
 *
 * Данные приходят сюда одной загрузкой и раздаются вниз: карта не ходит в сеть сама,
 * поэтому список, карточка и маркеры всегда показывают один и тот же срез парка.
 * Состояние брони держит источник данных — интерфейс только показывает его.
 */
export function MapPage() {
  const { scooters, loading, error, reload } = usePark();
  const {
    booking,
    remainingMs,
    expiresSoon,
    loading: bookingBusy,
    error: bookingError,
    book,
    cancel,
  } = useBooking();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Парк обновляем при смене брони: забронированный самокат должен уйти из свободных,
  // а снятый по сроку — вернуться. Первый рендер пропускаем, иначе будет лишний запрос.
  const previousBookingId = useRef<string | null>(null);
  useEffect(() => {
    const currentId = booking?.id ?? null;
    if (previousBookingId.current !== currentId) {
      previousBookingId.current = currentId;
      reload();
    }
  }, [booking, reload]);

  const selected = scooters.find((scooter) => scooter.id === selectedId) ?? null;
  const bookedScooter =
    booking === null ? null : (scooters.find((scooter) => scooter.id === booking.scooterId) ?? null);

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative min-h-[420px] overflow-hidden rounded-xl border">
        <MapCanvas scooters={scooters} selectedId={selectedId} />
      </div>

      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto" aria-label="Панель парка">
        {booking !== null && bookedScooter !== null && (
          <BookingPanel
            scooterCode={bookedScooter.code}
            remainingMs={remainingMs}
            expiresSoon={expiresSoon}
            busy={bookingBusy}
            onCancel={() => {
              void cancel();
            }}
          />
        )}

        {booking === null && selected !== null && (
          <ScooterCard
            scooter={selected}
            busy={bookingBusy}
            error={bookingError}
            onBook={(scooterId) => {
              void book(scooterId);
            }}
            onClose={() => setSelectedId(null)}
          />
        )}

        <ParkPanel
          scooters={scooters}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReload={reload}
        />
      </aside>
    </div>
  );
}
