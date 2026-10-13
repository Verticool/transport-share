import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { MapCanvas } from '../src/features/map/map-canvas';
import { useThemeStore } from '../src/stores/theme';

/**
 * Карта проверяется по-настоящему: в jsdom создаётся тот же экземпляр OpenLayers,
 * что и в браузере (заглушка `ResizeObserver` подключена в setup.ts). Смысл проверок —
 * что компонент не оставляет за собой «мёртвых» карт и переживает смену темы.
 */
function renderCanvas(strict = false) {
  const canvas = <MapCanvas />;
  return render(strict ? <StrictMode>{canvas}</StrictMode> : canvas);
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
