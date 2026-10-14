import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScooterCard } from '../src/features/map/scooter-card';
import type { Scooter } from '@sharing/shared';

/**
 * Предупреждение о заряде в карточке самоката.
 *
 * Проверяется, что оно живёт ровно там, где имеет смысл: у недоступного самоката (в том числе
 * разряженного в ноль) оно висело постоянно и ничего не сообщало — там уже стоит «Недоступен».
 */
const baseScooter: Scooter = {
  id: 'scooter-1',
  code: 'SC-001',
  model: 'Ninebot Max G30',
  status: 'free',
  batteryPct: 15,
  lat: 42.8746,
  lng: 74.5698,
  updatedAt: '2026-10-14T07:00:00.000Z',
  lastSeenAt: '2026-10-14T07:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
};

function renderCard(overrides: Partial<Scooter>): void {
  render(
    <ScooterCard
      scooter={{ ...baseScooter, ...overrides }}
      needsAuth={false}
      busy={false}
      error={null}
      onBook={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('карточка самоката: предупреждение о заряде', () => {
  it('свободный самокат с низким зарядом предупреждает до брони', () => {
    renderCard({ status: 'free', batteryPct: 15 });

    expect(screen.getByTestId('scooter-low-battery')).toHaveTextContent('Батарея почти пуста — заряд 15 %');
  });

  it('разряженный в ноль свободный самокат говорит о замене батареи, а не о короткой поездке', () => {
    renderCard({ status: 'free', batteryPct: 0 });

    expect(screen.getByTestId('scooter-low-battery')).toHaveTextContent('до замены батареи взять его нельзя');
  });

  it('недоступный самокат не показывает предупреждение о заряде', () => {
    renderCard({ status: 'unavailable', batteryPct: 0 });

    expect(screen.queryByTestId('scooter-low-battery')).toBeNull();
  });

  it('самокат в поездке и забронированный не показывают предупреждение о заряде', () => {
    renderCard({ status: 'in_ride', batteryPct: 4 });

    expect(screen.queryByTestId('scooter-low-battery')).toBeNull();
  });

  it('свободный самокат с нормальным зарядом предупреждения не показывает', () => {
    renderCard({ status: 'free', batteryPct: 80 });

    expect(screen.queryByTestId('scooter-low-battery')).toBeNull();
  });
});
