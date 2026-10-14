import { makeScooter } from '@sharing/shared/testing/factories';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ParkPanel } from '../src/features/map/park-panel';

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
    expect(header).toHaveTextContent('До центра зоны');
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

  it('сортирует список по удалённости от центра города', () => {
    renderPanel();
    expect(listCodes()).toEqual(['DV-001', 'DV-003', 'DV-002']);
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
    expect(note).toHaveTextContent('Показаны все самокаты');
    expect(note).toHaveTextContent('во время поездки');
    expect(note).toHaveTextContent('только ваш самокат и зона обслуживания');
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

  it('подводит список к выбранному самокату: строка могла быть вне вида', () => {
    const scrollIntoView = vi.fn();
    // В jsdom прокрутки нет: проверяем сам вызов — он и есть «подвести список к выбору».
    Element.prototype.scrollIntoView = scrollIntoView;

    // Выбор приходит извне (клик по маркеру на карте), список отсортирован по удалённости.
    renderPanel({ selectedId: 'far' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
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
