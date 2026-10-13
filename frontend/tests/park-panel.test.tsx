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

function renderPanel(overrides: Partial<Parameters<typeof ParkPanel>[0]> = {}) {
  const props = {
    scooters: [FAR, BUSY, NEAR],
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

  it('ведёт счёт по каждому статусу в сводке', () => {
    renderPanel();
    const summary = screen.getByRole('list', { name: 'Состояние парка' });
    expect(within(summary).getByText('Свободен').parentElement?.textContent).toContain('2');
    expect(within(summary).getByText('В поездке').parentElement?.textContent).toContain('1');
    expect(within(summary).getByText('Забронирован').parentElement?.textContent).toContain('0');
  });

  it('сортирует список по удалённости от центра города', () => {
    renderPanel();
    expect(listCodes()).toEqual(['DV-001', 'DV-003', 'DV-002']);
  });

  it('по кнопке «Только свободные» оставляет в списке свободные самокаты', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Только свободные' }));

    expect(listCodes()).toEqual(['DV-001', 'DV-002']);
    expect(screen.getByRole('button', { name: 'Только свободные' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
