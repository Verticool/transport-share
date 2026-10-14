import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RidePanel } from '../src/features/ride/ride-panel';

/**
 * Панель поездки: что видит пользователь и что происходит по кнопкам. Сумма приходит сверху —
 * считается доменом, поэтому здесь проверяется показ, а не арифметика.
 */
function renderPanel(overrides: Partial<Parameters<typeof RidePanel>[0]> = {}) {
  const props = {
    scooterCode: 'SC-013',
    status: 'active' as const,
    elapsedSeconds: 7 * 60 + 12,
    rideMinutes: 8,
    pauseMinutes: 0,
    amount: 25_00 + 8 * 6_00,
    currencySymbol: 'сом',
    canFinishHere: true,
    offline: false,
    busy: false,
    error: null,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onFinish: vi.fn(),
    onPushToZone: vi.fn(),
    ...overrides,
  };
  render(<RidePanel {...props} />);
  return props;
}

describe('RidePanel', () => {
  it('показывает время, минуты и сумму', () => {
    renderPanel();

    expect(screen.getByText('Поездка на SC-013')).toBeInTheDocument();
    expect(screen.getByTestId('ride-timer')).toHaveTextContent('07:12');
    expect(screen.getByTestId('ride-minutes')).toHaveTextContent('8 мин');
    expect(screen.getByTestId('pause-minutes')).toHaveTextContent('0 мин');
    expect(screen.getByTestId('ride-amount')).toHaveTextContent('73.00 сом');
  });

  it('ставит поездку на паузу по кнопке', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole('button', { name: /Пауза/ }));

    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it('на паузе предлагает продолжить и объясняет тариф', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ status: 'paused', pauseMinutes: 3, rideMinutes: 5 });

    expect(screen.getByText('Пауза — время тарифицируется отдельно')).toBeInTheDocument();
    expect(screen.getByTestId('pause-minutes')).toHaveTextContent('3 мин');

    await user.click(screen.getByRole('button', { name: /Продолжить/ }));
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });

  it('завершает поездку по кнопке', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole('button', { name: /Завершить/ }));

    expect(props.onFinish).toHaveBeenCalledTimes(1);
  });

  it('вне зоны: завершение недоступно, объяснено почему и предложено вернуть самокат', async () => {
    const user = userEvent.setup();
    const props = renderPanel({ canFinishHere: false });

    expect(screen.getByRole('button', { name: /Завершить/ })).toBeDisabled();
    const block = screen.getByTestId('outside-zone');
    // Мотор заблокирован, но поездка не закрыта — человек должен понимать, что время идёт.
    expect(block).toHaveTextContent('мотор заблокирован');
    expect(block).toHaveTextContent('продолжают тарифицироваться');

    await user.click(screen.getByRole('button', { name: 'Дотолкать самокат в зону' }));
    expect(props.onPushToZone).toHaveBeenCalledTimes(1);
  });

  it('при потере связи говорит, что счёт продолжается', () => {
    renderPanel({ offline: true });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Связь пропала — поездка идёт, счёт продолжается',
    );
  });

  it('показывает ошибку действия', () => {
    renderPanel({ error: 'Здесь завершить поездку нельзя — вернитесь в зону обслуживания' });

    expect(screen.getByRole('alert')).toHaveTextContent('вернитесь в зону обслуживания');
  });
});
