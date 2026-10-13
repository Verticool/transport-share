import { makeScooter } from '@sharing/shared/testing/factories';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BookingPanel } from '../src/features/booking/booking-panel';
import { ScooterCard } from '../src/features/map/scooter-card';

describe('BookingPanel', () => {
  function renderPanel(overrides: Partial<Parameters<typeof BookingPanel>[0]> = {}) {
    const props = {
      scooterCode: 'SC-021',
      remainingMs: 12 * 60_000 + 30_000,
      expiresSoon: false,
      busy: false,
      onCancel: vi.fn(),
      ...overrides,
    };
    render(<BookingPanel {...props} />);
    return props;
  }

  it('показывает, какой самокат держит пользователь, и остаток в минутах и секундах', () => {
    renderPanel();

    expect(screen.getByText('Самокат SC-021 забронирован')).toBeInTheDocument();
    expect(screen.getByTestId('booking-countdown')).toHaveTextContent('12:30');
  });

  it('не пугает предупреждением, пока времени достаточно', () => {
    renderPanel();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('предупреждает, когда до снятия осталось 3 минуты', () => {
    renderPanel({ remainingMs: 2 * 60_000 + 20_000, expiresSoon: true });

    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('Бронь снимется через 3 мин');
  });

  it('снимает бронь по кнопке', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Снять бронь' }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ScooterCard', () => {
  function renderCard(overrides: Partial<Parameters<typeof ScooterCard>[0]> = {}) {
    const props = {
      scooter: makeScooter({ id: 's-1', code: 'SC-005', status: 'free', batteryPct: 88 }),
      busy: false,
      error: null,
      onBook: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    render(<ScooterCard {...props} />);
    return props;
  }

  it('предлагает забронировать свободный самокат', async () => {
    const user = userEvent.setup();
    const props = renderCard();

    const button = screen.getByRole('button', { name: 'Забронировать' });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(props.onBook).toHaveBeenCalledWith('s-1');
  });

  it('не предлагает бронь для занятого самоката и объясняет почему', () => {
    renderCard({ scooter: makeScooter({ status: 'in_ride' }) });

    expect(screen.getByRole('button', { name: 'Забронировать' })).toBeDisabled();
    expect(screen.getByText('На самокате едут')).toBeInTheDocument();
  });

  it('показывает отказ источника данных, если самокат заняли первым', () => {
    renderCard({ error: 'Этот самокат уже забронирован' });

    expect(screen.getByRole('alert')).toHaveTextContent('Этот самокат уже забронирован');
  });

  it('закрывается по крестику', async () => {
    const user = userEvent.setup();
    const props = renderCard();

    await user.click(screen.getByRole('button', { name: 'Закрыть карточку самоката' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
