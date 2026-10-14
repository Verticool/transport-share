import type { Scooter } from '@sharing/shared';
import type Map from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import type Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { fromLonLat } from 'ol/proj';
import type VectorSource from 'ol/source/Vector';
import { Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { basemapFor, MAP_ZOOM, ZONE } from '../../config/map';
import { useTheme } from '../../hooks/use-theme';
import { createParkMap } from '../../lib/map/create-map';
import { createBasemapLayer, createZoneLayer, zoneExtent, ZONE_LAYER_Z_INDEX } from '../../lib/map/layers';
import {
  createMarkerStyle,
  createParkLayer,
  nearestScooterId,
  PARK_LAYER_Z_INDEX,
  readScooterId,
} from '../../lib/map/scooter-layer';
import { cn } from '../../lib/utils';
import { useThemeStore } from '../../stores/theme';

export interface MapCanvasProps {
  /** Самокаты для отображения: пустой список — карта без маркеров. */
  scooters: Scooter[];
  /** Выбранный самокат: карта подводит к нему вид и выделяет маркер. */
  selectedId?: string | null;
  /**
   * Выбор самоката кликом по маркеру.
   *
   * Карта — равноправный способ выбрать самокат: панель справа открывает ту же карточку с бронью,
   * что и строка списка. Без этого бронь была доступна только из списка.
   */
  onSelect?: (scooterId: string) => void;
  /**
   * Снятие выделения кликом по пустому месту карты.
   *
   * Если обработчик не передан, выделение не снимается: во время поездки карта не должна терять
   * самокат, за которым следит клиент.
   */
  onClearSelect?: (() => void) | undefined;
  /** Часы: время последнего действия с картой нужно для задержки автоследования (RULES §F). */
  now?: () => number;
  /** Дополнительные классы контейнера. */
  className?: string;
}

/**
 * Пауза перед тем, как карта сама подведёт вид к выбранному самокату.
 *
 * Пока идёт поездка, координаты самоката обновляются каждую секунду. Без паузы карта «дёргала» бы
 * вид на каждое обновление и не давала посмотреть город: отзумиться было невозможно.
 */
const FOLLOW_DELAY_MS = 6000;

/** Как часто карта может сама менять вид при движении самоката (не чаще одного раза в интервал). */
const FOLLOW_THROTTLE_MS = 4000;

/** Зум, к которому подводится вид при выборе самоката в списке. */
const SELECT_ZOOM = 16;

/**
 * Допуск между нажатием и отпусканием, при котором движение считается перетаскиванием карты.
 *
 * Клик после перетаскивания браузер не отличает от обычного клика и присылает то же событие.
 * Без этого допуска панорамирование карты каждый раз сбрасывало бы выбранный самокат.
 */
const DRAG_TOLERANCE_PX = 4;

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
export function MapCanvas({
  scooters,
  selectedId = null,
  onSelect,
  onClearSelect,
  now = () => Date.now(),
  className,
}: MapCanvasProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const parkLayerRef = useRef<VectorLayer<VectorSource<Feature<Point>>> | null>(null);
  // Актуальный список самокатов для эффекта подведения вида: держим в ref, чтобы список не был
  // зависимостью эффекта — иначе карта реагировала бы на каждое обновление парка.
  const scootersRef = useRef(scooters);
  useEffect(() => {
    scootersRef.current = scooters;
  }, [scooters]);
  // Время последнего действия пользователя с картой и время последнего автоследования.
  const lastTouchRef = useRef(0);
  const lastFollowRef = useRef(0);
  // Часы тоже через ref: обработчики карты живут в эффекте с пустым списком зависимостей.
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  // Обработчик выбора живёт в ref: карта создаётся один раз, а подписка не должна пересоздаваться
  // из-за новой ссылки на функцию при каждом рендере (иначе обработчики накапливались бы).
  const selectRef = useRef<((scooterId: string) => void) | undefined>(onSelect);
  // Обработчик снятия выделения — по той же причине в ref: подписка на карте одна.
  const clearRef = useRef<(() => void) | undefined>(onClearSelect);

  // Подписка на клик читает обработчик из ref, поэтому его нужно обновлять после рендера,
  // а не во время: во время рендера ref-ы трогать нельзя (правило React).
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    clearRef.current = onClearSelect;
  }, [onClearSelect]);

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

    /**
     * Самокат под точкой клика.
     *
     * Попадание считается с запасом (чтобы маркер в 7 px не приходилось ловить), но из всех
     * маркеров в радиусе берётся ближайший к клику: иначе при близко стоящих самокатах
     * открывался бы соседний — пользователь видел в панели не тот самокат, по которому щёлкнул.
     */
    const scooterAt = (pixel: number[]): string | null => {
      const candidates: { id: string; pixel: number[] }[] = [];
      map.forEachFeatureAtPixel(
        pixel,
        (feature) => {
          const id = readScooterId(feature);
          const geometry = feature.getGeometry();
          // Проверка классом, а не строкой типа: так TypeScript знает, что у геометрии есть
          // координаты, и приведение типов (запрещено рулсетом) не нужно.
          if (id !== null && geometry instanceof Point) {
            const center = map.getPixelFromCoordinate(geometry.getCoordinates());
            if (center !== undefined) {
              candidates.push({ id, pixel: center });
            }
          }
          return undefined;
        },
        { hitTolerance: 8, layerFilter: (layer) => layer.getZIndex() === PARK_LAYER_Z_INDEX },
      );
      return nearestScooterId(candidates, pixel);
    };

    // Где нажали кнопку: движение между нажатием и отпусканием отличает клик от перетаскивания.
    let pressedAt: { x: number; y: number } | null = null;

    // Слушаем вьюпорт карты, а координату точки берём у карты: так выбор самоката не зависит от
    // того, как тип события карты назван в библиотеке, и работает и мышью, и касанием.
    const handleClick = (event: MouseEvent): void => {
      const pressed = pressedAt;
      pressedAt = null;
      const dragged =
        pressed !== null &&
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > DRAG_TOLERANCE_PX;
      if (dragged) {
        // Карту двигали: это панорамирование, а не выбор. Выделенный самокат остаётся выделенным.
        return;
      }

      const scooterId = scooterAt(map.getEventPixel(event));
      if (scooterId !== null) {
        selectRef.current?.(scooterId);
        return;
      }
      // Пустое место карты: снимаем выделение, если владелец карты это разрешил.
      clearRef.current?.();
    };

    // Курсор показывает, что по маркеру можно щёлкнуть — иначе карта выглядит как картинка.
    // Ставим его на вьюпорт карты: это та поверхность, по которой двигается указатель.
    const handlePointerMove = (event: PointerEvent): void => {
      const surface = map.getViewport();
      if (surface === undefined || surface === null) {
        return;
      }
      surface.style.cursor = scooterAt(map.getEventPixel(event)) === null ? '' : 'pointer';
    };

    // Любое действие с картой (перетаскивание, колесо, касание) останавливает автоследование на
    // паузу: пользователь в этот момент смотрит город, а не гонится за самокатом.
    const markInteraction = (): void => {
      lastTouchRef.current = nowRef.current();
    };
    const handlePointerDown = (event: PointerEvent): void => {
      pressedAt = { x: event.clientX, y: event.clientY };
      markInteraction();
    };
    const viewport = map.getViewport();
    viewport?.addEventListener('click', handleClick);
    viewport?.addEventListener('pointermove', handlePointerMove);
    viewport?.addEventListener('pointerdown', handlePointerDown);
    viewport?.addEventListener('wheel', markInteraction);
    viewport?.addEventListener('touchstart', markInteraction);
    viewport?.addEventListener('keydown', markInteraction);

    return () => {
      observer.disconnect();
      viewport?.removeEventListener('click', handleClick);
      viewport?.removeEventListener('pointermove', handlePointerMove);
      viewport?.removeEventListener('pointerdown', handlePointerDown);
      viewport?.removeEventListener('wheel', markInteraction);
      viewport?.removeEventListener('touchstart', markInteraction);
      viewport?.removeEventListener('keydown', markInteraction);
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
        // Без выделения: подсветка выбранного ставится эффектом ниже, где известен выбор.
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
    parkLayer.setStyle(createMarkerStyle(theme, selectedId));
  }, [scooters, theme, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || selectedId === null) {
      return;
    }

    const follow = (): void => {
      const selected = scootersRef.current.find((scooter) => scooter.id === selectedId);
      if (selected === undefined) {
        return;
      }
      lastFollowRef.current = now();
      map.getView().animate({
        center: fromLonLat([selected.lng, selected.lat]),
        zoom: Math.max(map.getView().getZoom() ?? MAP_ZOOM, SELECT_ZOOM),
        duration: 300,
      });
    };

    // Пока пользователь трогал карту позже, чем пауза назад, вид не трогаем: ждём таймер.
    const idleFor = now() - lastTouchRef.current;
    if (idleFor < FOLLOW_DELAY_MS) {
      const timer = window.setTimeout(follow, FOLLOW_DELAY_MS - idleFor);
      return () => {
        window.clearTimeout(timer);
      };
    }

    // И не чаще, чем раз в интервал: самокат в поездке двигается постоянно, а вид — нет.
    if (now() - lastFollowRef.current < FOLLOW_THROTTLE_MS) {
      return;
    }

    follow();
  }, [selectedId, scooters, now]);

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
