import { makeScooter } from '@sharing/shared/testing/factories';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ParkPanel } from '../src/features/map/park-panel';
import { scrollRowIntoList } from '../src/features/map/park-list-scroll';

/**
 * Панель парка: счётчик, легенда, фильтр и список. Проверяем именно поведение для пользователя —
 * что видно, что фильтруется и что происходит по клику, а не наличие отдельных узлов.
 */
const NEAR = makeScooter({ id: 'near', code: 'DV-001', status: 'free', lat: 42.875, lng: 74.57 });
const FAR = makeScooter({ id: 'far', code: 'DV-002', status: 'free', lat: 42.9, lng: 74.62 });
const BUSY = makeScooter({ id: 'busy', code: 'DV-003', status: 'in_ride', lat: 42.88, lng: 74.58 });

const ALL_STATUSES = ['free', 'reserved', 'in_ride', 'unavailable'] as const;

function renderPanel(overrides: Partial<Parameters<typeof ParkPanel>[0]> = {}) {
  const props = {
    scooters: [FAR, BUSY, NEAR],
    allScooters: [FAR, BUSY, NEAR],
    statusFilter: [...ALL_STATUSES],
    onToggleStatus: vi.fn(),
    loading: false,
    error: null,
    selectedId: null,
    onSelect: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
  render(<ParkPanel {...props} />);
  return props;
}

function listCodes(): string[] {
  const list = screen.getByTestId('park-list');
  return within(list)
    .getAllByRole('button')
    .map((button) => button.textContent?.slice(0, 6) ?? '');
}

describe('ParkPanel', () => {
  it('показывает, сколько самокатов свободно из общего числа', () => {
    renderPanel();
    expect(screen.getByText('2 свободны из 3 в зоне обслуживания')).toBeInTheDocument();
  });

  it('ведёт счёт по каждому состоянию и счёт идёт по всему парку', () => {
    // В списке только свободные (фильтр), но сводка показывает общую картину парка.
    renderPanel({ scooters: [NEAR, FAR], statusFilter: ['free'] });
    const summary = screen.getByRole('list', { name: 'Фильтр по состоянию' });
    expect(within(summary).getByRole('button', { name: 'Свободен: 2' })).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: 'В поездке: 1' })).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: 'Забронирован: 0' })).toBeInTheDocument();
  });

  it('подписывает колонку расстояния: это удалённость от центра зоны, а не путь поездки', () => {
    renderPanel();

    // Без подписи число справа читалось как «сколько проехал самокат» — и уменьшение значения при
    // движении выглядело ошибкой. Подпись объясняет, от какой точки считается расстояние.
    const header = screen.getByTestId('park-list-header');
    expect(header).toHaveTextContent('Самокат');
    expect(header).toHaveTextContent('Заряд');
    // Подпись короткая: «До центра» — в узкой колонке длинная строка переносилась и разъезжалась.
    expect(header).toHaveTextContent('До центра');
    expect(screen.getByTestId('park-list')).toHaveAttribute(
      'aria-label',
      'Самокаты: удалённость от центра зоны обслуживания',
    );
  });

  it('приближение самоката к центру зоны поднимает его в списке', () => {
    // Тот же самокат подъезжает к центру: список пересортировывается, значение в колонке падает.
    // Так и должно быть для удалённости — и именно это раньше выглядело ошибкой.
    const far = makeScooter({ id: 'moving', code: 'DV-900', status: 'free', lat: 42.95, lng: 74.65 });
    const props = {
      scooters: [NEAR, far],
      allScooters: [NEAR, far],
      statusFilter: [...ALL_STATUSES],
      onToggleStatus: vi.fn(),
      loading: false,
      error: null,
      selectedId: null,
      onSelect: vi.fn(),
      onReload: vi.fn(),
    };
    const { rerender } = render(<ParkPanel {...props} />);
    expect(listCodes()).toEqual(['DV-001', 'DV-900']);

    // Ближе к центру зоны (42.86, 74.58), чем NEAR: теперь этот самокат идёт первым.
    const closer = makeScooter({ id: 'moving', code: 'DV-900', status: 'free', lat: 42.861, lng: 74.5795 });
    rerender(<ParkPanel {...props} scooters={[NEAR, closer]} allScooters={[NEAR, closer]} />);

    expect(listCodes()).toEqual(['DV-900', 'DV-001']);
  });

  it('по умолчанию сортирует по доступности: свободные, забронированные, в поездке, недоступные', () => {
    renderPanel({
      scooters: [
        BUSY,
        makeScooter({ id: 'res', code: 'DV-004', status: 'reserved', lat: 42.88, lng: 74.58 }),
        makeScooter({ id: 'off', code: 'DV-005', status: 'unavailable', lat: 42.88, lng: 74.58 }),
        NEAR,
      ],
      allScooters: [BUSY, NEAR],
    });

    // Раньше список был просто по удалённости — теперь первым идёт то, что можно взять.
    expect(listCodes()).toEqual(['DV-001', 'DV-004', 'DV-003', 'DV-005']);
  });

  it('сортировка по колонкам: заряд, расстояние и переворот порядка повторным кликом', async () => {
    const user = userEvent.setup();
    renderPanel({
      scooters: [
        makeScooter({ id: 'a', code: 'DV-010', status: 'free', batteryPct: 80, lat: 42.87, lng: 74.57 }),
        makeScooter({ id: 'b', code: 'DV-020', status: 'free', batteryPct: 30, lat: 42.9, lng: 74.62 }),
      ],
    });

    // Сортировка по заряду: сначала самый разряженный.
    await user.click(screen.getByTestId('park-sort-battery'));
    expect(listCodes()).toEqual(['DV-020', 'DV-010']);

    // Повторный клик по той же колонке переворачивает порядок.
    await user.click(screen.getByTestId('park-sort-battery'));
    expect(listCodes()).toEqual(['DV-010', 'DV-020']);

    // Переход на другую колонку начинает с возрастания: ближе к центру — выше.
    await user.click(screen.getByTestId('park-sort-distance'));
    expect(listCodes()).toEqual(['DV-010', 'DV-020']);
  });

  it('снятое состояние убирает самокаты из списка и помечается как выключенное', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    // «В поездке» выключено: в списке остаются только свободные, а сводка не меняется.
    await user.click(screen.getByRole('button', { name: 'В поездке: 1' }));

    expect(props.onToggleStatus).toHaveBeenCalledWith('in_ride');
  });

  it('при выключенных состояниях список пуст, и об этом сказано словами', () => {
    renderPanel({ scooters: [], statusFilter: ['free'], allScooters: [FAR, BUSY, NEAR] });
    expect(screen.getByTestId('park-empty')).toHaveTextContent('Под выбранные состояния ничего не попало');
  });

  it('объясняет, что на стенде показаны все самокаты, и чем это отличается от рабочего приложения', () => {
    renderPanel();

    // Мы намеренно показываем весь парк всегда: так проверяются сценарии. Пользователь должен
    // видеть, что во время поездки это отступление, а не поведение рабочего приложения.
    const note = screen.getByTestId('park-visibility-note');
    expect(note).toHaveTextContent('Парк показан целиком');
    expect(note).toHaveTextContent('в поездке');
    expect(note).toHaveTextContent('только ваш самокат и зона');
  });

  it('показывает, сколько строк скрыто фильтром: список — это не весь парк', () => {
    // Фильтр снял «В поездке»: список короче парка, значит часть строк скрыта.
    renderPanel({ scooters: [FAR, NEAR], statusFilter: ['free'], onToggleStatus: vi.fn() });

    // Без этой строки снятый фильтр читается как «самокаты пропали».
    expect(screen.getByTestId('park-shown-count')).toHaveTextContent('остальные скрыты фильтром состояний');
    const counted = /Показано (\d+) из (\d+)/.exec(screen.getByTestId('park-shown-count').textContent ?? '');
    expect(counted).not.toBeNull();
    expect(Number(counted?.[1])).toBeLessThan(Number(counted?.[2]));
  });

  it('подводит список к выбранному самокату, двигая только список', () => {
    // Строка выше видимой части списка: список должен прокрутиться вверх на разницу.
    const list = { scrollTop: 300, getBoundingClientRect: () => ({ top: 100, bottom: 300 }) };
    const row = { getBoundingClientRect: () => ({ top: 60, bottom: 90 }) };
    scrollRowIntoList(list, row);
    expect(list.scrollTop).toBe(260);

    // Строка ниже видимой части: прокрутка вниз.
    const below = { scrollTop: 100, getBoundingClientRect: () => ({ top: 100, bottom: 300 }) };
    const lowRow = { getBoundingClientRect: () => ({ top: 320, bottom: 350 }) };
    scrollRowIntoList(below, lowRow);
    expect(below.scrollTop).toBe(150);

    // Строка уже в виде — список не двигается (иначе колонка панелей «прыгает»).
    const inside = { scrollTop: 100, getBoundingClientRect: () => ({ top: 100, bottom: 300 }) };
    const seenRow = { getBoundingClientRect: () => ({ top: 150, bottom: 180 }) };
    scrollRowIntoList(inside, seenRow);
    expect(inside.scrollTop).toBe(100);
  });

  it('кнопка «Показать все состояния» возвращает полный фильтр', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ scooters: [FAR, NEAR], statusFilter: ['free'] });

    await user.click(screen.getByRole('button', { name: 'Показать все состояния' }));

    // Возвращаются все состояния, которых не хватало: in_ride и unavailable.
    expect(props.onToggleStatus).toHaveBeenCalledWith('reserved');
    expect(props.onToggleStatus).toHaveBeenCalledWith('in_ride');
    expect(props.onToggleStatus).toHaveBeenCalledWith('unavailable');
  });

  it('сообщает наверх, какой самокат выбран', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByText('DV-002'));

    expect(props.onSelect).toHaveBeenCalledWith('far');
  });

  it('помечает выбранный самокат для скринридера', () => {
    renderPanel({ selectedId: 'busy' });
    expect(screen.getByText('DV-003').closest('button')).toHaveAttribute('aria-current', 'true');
  });

  it('во время загрузки говорит об этом вместо счётчика', () => {
    renderPanel({ scooters: [], loading: true });
    expect(screen.getByText('Загружаем самокаты…')).toBeInTheDocument();
  });

  it('при ошибке показывает текст и предлагает повторить запрос', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ scooters: [], error: 'Данные парка не прошли проверку' });

    expect(screen.getByText('Данные парка не прошли проверку')).toBeInTheDocument();
    expect(screen.queryByTestId('park-list')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(props.onReload).toHaveBeenCalledTimes(1);
  });
});
