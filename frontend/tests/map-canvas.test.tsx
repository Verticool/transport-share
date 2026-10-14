import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MapCanvas } from '../src/features/map/map-canvas';
import { useThemeStore } from '../src/stores/theme';

/**
 * Карта проверяется по-настоящему: в jsdom создаётся тот же экземпляр OpenLayers,
 * что и в браузере (заглушка `ResizeObserver` подключена в setup.ts). Смысл проверок —
 * что компонент не оставляет за собой «мёртвых» карт и переживает смену темы.
 */
function renderCanvas(
  strict = false,
  scooters: Parameters<typeof MapCanvas>[0]['scooters'] = [],
  handlers: { onSelect?: (id: string) => void; onClearSelect?: () => void } = {},
) {
  // Пропсы собираются по условию: `exactOptionalPropertyTypes` не разрешает передавать undefined
  // в необязательное свойство (RULES §F).
  const props: {
    scooters: typeof scooters;
    onSelect?: (scooterId: string) => void;
    onClearSelect?: () => void;
  } = { scooters };
  if (handlers.onSelect !== undefined) {
    props.onSelect = handlers.onSelect;
  }
  if (handlers.onClearSelect !== undefined) {
    props.onClearSelect = handlers.onClearSelect;
  }
  const canvas = <MapCanvas {...props} />;
  return render(strict ? <StrictMode>{canvas}</StrictMode> : canvas);
}

/** Клик по карте: jsdom не двигает мышь сам, поэтому событие отправляем в вьюпорт вручную. */
function clickOnMap(x: number, y: number): void {
  const viewport = document.querySelector('.ol-viewport');
  if (viewport === null) {
    throw new Error('вьюпорт карты не найден');
  }
  viewport.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
}

function viewports(): NodeListOf<Element> {
  return document.querySelectorAll('.ol-viewport');
}

// Тема сбрасывается в общем `tests/setup.ts` перед каждым тестом: сбрасывать её здесь нельзя —
// общий стор обновляется, пока карта ещё смонтирована, и React справедливо ругается на обновление вне act.
//
// Что здесь НЕ проверяется и почему: контейнеры слоёв (`.ol-layer`) OpenLayers создаёт в кадре
// отрисовки (`requestAnimationFrame`), которого в jsdom нет, поэтому DOM-проверка «два слоя»
// превратилась бы в сравнение нулей. Состав слоёв и цвета стилей проверяются на чистых фабриках
// (`tests/map-layers.test.ts`), а реальная отрисовка — браузерным замером.

describe('MapCanvas', () => {
  it('рендерит область карты с подписью для скринридера', () => {
    renderCanvas();

    const region = screen.getByRole('region', { name: 'Карта самокатов' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('data-testid', 'map-canvas');
  });

  it('создаёт карту OpenLayers внутри контейнера', () => {
    renderCanvas();

    expect(viewports()).toHaveLength(1);
    expect(screen.getByTestId('map-canvas')).toContainElement(document.querySelector('.ol-viewport'));
  });

  it('снимает карту при размонтировании', () => {
    const { unmount } = renderCanvas();
    expect(viewports()).toHaveLength(1);

    unmount();

    expect(viewports()).toHaveLength(0);
  });

  it('двойное монтирование (StrictMode) не оставляет двух карт', () => {
    renderCanvas(true);

    expect(viewports()).toHaveLength(1);
  });

  it('переживает смену темы: карта остаётся, элементы управления на месте', () => {
    renderCanvas();
    const container = screen.getByTestId('map-canvas');
    const viewportBefore = container.querySelector('.ol-viewport');

    act(() => {
      useThemeStore.getState().toggleTheme();
    });

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(viewports()).toHaveLength(1);
    expect(container.querySelector('.ol-viewport')).toBe(viewportBefore);
    expect(screen.getByRole('button', { name: 'Приблизить' })).toBeInTheDocument();
  });

  it('клик по пустому месту карты снимает выделение', () => {
    const onClearSelect = vi.fn();
    const onSelect = vi.fn();
    renderCanvas(false, [], { onSelect, onClearSelect });

    clickOnMap(200, 150);

    // Маркеров нет — под курсором пусто, значит выделять нечего и владелец карты снимает выбор.
    expect(onClearSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('перетаскивание карты не снимает выделение: клик после драга — это панорамирование', () => {
    const onClearSelect = vi.fn();
    renderCanvas(false, [], { onSelect: vi.fn(), onClearSelect });

    const viewport = document.querySelector('.ol-viewport');
    if (viewport === null) {
      throw new Error('вьюпорт карты не найден');
    }
    // Нажали в одной точке, отпустили и «щёлкнули» в другой — так браузер отдаёт перетаскивание.
    viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    clickOnMap(180, 100);

    expect(onClearSelect).not.toHaveBeenCalled();
  });

  it('если владелец карты не разрешил снятие выделения, пустой клик ничего не делает', () => {
    const onSelect = vi.fn();
    renderCanvas(false, [], { onSelect });

    clickOnMap(200, 150);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('даёт свои кнопки зума и подпись источника вместо контролов библиотеки', () => {
    renderCanvas();

    expect(screen.getByRole('button', { name: 'Приблизить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отдалить' })).toBeInTheDocument();
    expect(screen.getByText(/Esri/)).toBeInTheDocument();
  });

  it('кнопки зума кликабельны и не ломают карту', async () => {
    const user = userEvent.setup();
    renderCanvas();

    await user.click(screen.getByRole('button', { name: 'Приблизить' }));
    await user.click(screen.getByRole('button', { name: 'Отдалить' }));

    // Отсутствие исключения при клике + живой viewport: сам сдвиг масштаба замеряется браузером.
    expect(viewports()).toHaveLength(1);
  });
});
