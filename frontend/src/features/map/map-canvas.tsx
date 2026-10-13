import type { Scooter } from '@sharing/shared';
import type Map from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import type Feature from 'ol/Feature';
import type Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import type VectorSource from 'ol/source/Vector';
import { Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { basemapFor, MAP_ZOOM, ZONE } from '../../config/map';
import { useTheme } from '../../hooks/use-theme';
import { createParkMap } from '../../lib/map/create-map';
import { createBasemapLayer, createZoneLayer, zoneExtent, ZONE_LAYER_Z_INDEX } from '../../lib/map/layers';
import { createMarkerStyle, createParkLayer, PARK_LAYER_Z_INDEX } from '../../lib/map/scooter-layer';
import { cn } from '../../lib/utils';
import { useThemeStore } from '../../stores/theme';

export interface MapCanvasProps {
  /** Самокаты для отображения: пустой список — карта без маркеров. */
  scooters: Scooter[];
  /** Выбранный самокат: карта подводит к нему вид. */
  selectedId?: string | null;
  /** Дополнительные классы контейнера. */
  className?: string;
}

/** Зум, к которому подводится вид при выборе самоката в списке. */
const SELECT_ZOOM = 16;

/**
 * Карта парка как React-компонент.
 *
 * OpenLayers владеет собственным DOM внутри контейнера, поэтому карта создаётся императивно
 * в эффекте, а React отвечает за контейнер и элементы управления. Кнопки зума и подпись
 * источника — свои (штатные контролы OL отключены в `createParkMap`), поэтому карта выглядит
 * частью интерфейса, а не библиотечной врезкой, и следует теме приложения.
 *
 * Стили слоёв живут на канвасе, который не читает CSS-переменные, поэтому при смене темы
 * пересобираются и подложка, и цвета зоны, и маркеры.
 */
export function MapCanvas({ scooters, selectedId = null, className }: MapCanvasProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const parkLayerRef = useRef<VectorLayer<VectorSource<Feature<Point>>> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    // Тема читается без подписки: карта создаётся один раз, а смену схемы обрабатывает
    // отдельный эффект ниже — иначе смена темы пересобирала бы карту целиком.
    const map = createParkMap(container, useThemeStore.getState().theme);
    mapRef.current = map;

    // Слой маркеров добавляется сразу и пустым: самокаты придут отдельным эффектом,
    // чтобы загрузка данных не пересобирала карту.
    const parkLayer = createParkLayer([], useThemeStore.getState().theme);
    parkLayerRef.current = parkLayer;
    map.addLayer(parkLayer);

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
      parkLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }

    // Смена темы задевает то, что живёт вне CSS: подложку карты, стиль зоны и цвет маркеров.
    const basemap = createBasemapLayer(basemapFor(theme));
    const zoneStyle = createZoneLayer(ZONE).getStyle();
    const markerStyle = createMarkerStyle(theme);

    map.getLayers().forEach((layer) => {
      if (layer instanceof TileLayer) {
        layer.setSource(basemap.getSource());
      }
      if (layer instanceof VectorLayer && layer.getZIndex() === ZONE_LAYER_Z_INDEX) {
        layer.setStyle(zoneStyle);
      }
      if (layer instanceof VectorLayer && layer.getZIndex() === PARK_LAYER_Z_INDEX) {
        layer.setStyle(markerStyle);
      }
    });
    map.render();
  }, [theme]);

  useEffect(() => {
    const parkLayer = parkLayerRef.current;
    if (parkLayer === null) {
      return;
    }
    // Полный пересбор набора: 40 объектов обновляются мгновенно, а дельты по WebSocket
    // появятся вместе с сервером (S11) — тогда здесь будет точечное обновление.
    parkLayer.setSource(createParkLayer(scooters, useThemeStore.getState().theme).getSource());
  }, [scooters, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || selectedId === null) {
      return;
    }

    const selected = scooters.find((scooter) => scooter.id === selectedId);
    if (selected === undefined) {
      return;
    }

    map.getView().animate({
      center: fromLonLat([selected.lng, selected.lat]),
      zoom: Math.max(map.getView().getZoom() ?? MAP_ZOOM, SELECT_ZOOM),
      duration: 300,
    });
  }, [selectedId, scooters]);

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
