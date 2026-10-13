import type Map from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { basemapFor, MAP_ZOOM, ZONE } from '../../config/map';
import { useTheme } from '../../hooks/use-theme';
import { createParkMap } from '../../lib/map/create-map';
import { createBasemapLayer, createZoneLayer, zoneExtent, ZONE_LAYER_Z_INDEX } from '../../lib/map/layers';
import { cn } from '../../lib/utils';
import { useThemeStore } from '../../stores/theme';

export interface MapCanvasProps {
  /** Дополнительные классы контейнера. */
  className?: string;
}

/**
 * Карта парка как React-компонент.
 *
 * OpenLayers владеет собственным DOM внутри контейнера, поэтому карта создаётся императивно
 * в эффекте, а React отвечает за контейнер и элементы управления. Кнопки зума и подпись
 * источника — свои (штатные контролы OL отключены в `createParkMap`), поэтому карта выглядит
 * частью интерфейса, а не библиотечной врезкой, и следует теме приложения.
 *
 * Стили слоёв живут на канвасе, который не читает CSS-переменные, поэтому при смене темы
 * стиль зоны пересобирается из токенов.
 */
export function MapCanvas({ className }: MapCanvasProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // Тема читается без подписки: карта создаётся один раз, а смену схемы обрабатывает
    // отдельный эффект ниже — иначе смена темы пересобирала бы карту целиком.
    const map = createParkMap(container, useThemeStore.getState().theme);
    mapRef.current = map;

    // Подгоняем вид по зоне: пользователь обязан видеть границу обслуживания целиком,
    // а фиксированный зум из конфига этого не гарантирует при другом размере окна.
    map.getView().fit(zoneExtent(ZONE), { padding: [32, 32, 32, 32], maxZoom: MAP_ZOOM });

    // Контейнер меняет ширину (панель фильтров, поворот экрана) — карта об этом сама не узнаёт
    // и без явного сигнала остаётся серой до ручного изменения размера окна.
    const observer = new ResizeObserver(() => {
      map.updateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }

    // Смена темы задевает то, что живёт вне CSS: подложку карты и стиль слоя зоны.
    const basemap = createBasemapLayer(basemapFor(theme));
    const refreshedZone = createZoneLayer(ZONE);
    const zoneStyle = refreshedZone.getStyle();

    map.getLayers().forEach((layer) => {
      if (layer instanceof TileLayer) {
        layer.setSource(basemap.getSource());
      }
      if (layer instanceof VectorLayer && layer.getZIndex() === ZONE_LAYER_Z_INDEX) {
        layer.setStyle(zoneStyle);
      }
    });
    map.render();
  }, [theme]);

  const zoomBy = useCallback((step: number) => {
    const view = mapRef.current?.getView();
    if (view === undefined) {
      return;
    }
    view.setZoom((view.getZoom() ?? MAP_ZOOM) + step);
  }, []);

  return (
    <div
      className={cn('relative h-full w-full', className)}
      data-testid="map-canvas"
      role="region"
      aria-label="Карта самокатов"
    >
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className="pointer-events-auto flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-none"
            aria-label="Приблизить"
            onClick={() => zoomBy(1)}
          >
            <Plus aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-none border-t"
            aria-label="Отдалить"
            onClick={() => zoomBy(-1)}
          >
            <Minus aria-hidden />
          </Button>
        </div>

        <p className="pointer-events-auto rounded-md bg-card/85 px-2 py-0.5 text-[11px] text-muted-foreground">
          {basemapFor(theme).attribution}
        </p>
      </div>
    </div>
  );
}
