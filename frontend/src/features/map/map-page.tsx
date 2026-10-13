import { useState } from 'react';

import { ParkPanel } from './park-panel';
import { MapCanvas } from './map-canvas';
import { usePark } from './use-park';

/**
 * Экран карты: слева карта парка, справа панель с легендой и списком самокатов.
 *
 * Данные приходят сюда одной загрузкой и раздаются вниз: карта не ходит в сеть сама,
 * поэтому список и маркеры всегда показывают один и тот же срез парка.
 */
export function MapPage() {
  const { scooters, loading, error, reload } = usePark();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative min-h-[420px] overflow-hidden rounded-xl border">
        <MapCanvas scooters={scooters} selectedId={selectedId} />
      </div>

      <aside className="flex min-h-0 flex-col gap-4" aria-label="Панель парка">
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
