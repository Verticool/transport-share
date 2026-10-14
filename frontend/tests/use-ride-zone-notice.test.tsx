import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useRideZoneNotice } from '../src/features/notifications/use-ride-zone-notice';
import { useNotificationsStore } from '../src/stores/notifications';
import { SERVICE_ZONE, zoneCenter } from '@sharing/shared';

/**
 * Выезд за границу зоны: постоянная полоса и одно всплывающее оповещение на выезд, плюс
 * сообщение о возвращении. Положение снаружи берём далеко от полигона — как в серверном тесте
 * блокировки мотора.
 */
const OUTSIDE = { lat: 43.5, lng: 74.0 };
const INSIDE = zoneCenter(SERVICE_ZONE);

const persistentKeys = (): string[] => useNotificationsStore.getState().persistent.map((item) => item.key);
const toastKeys = (): string[] => useNotificationsStore.getState().toasts.map((item) => item.key);

beforeEach(() => {
  useNotificationsStore.getState().reset();
});

describe('оповещение о выезде из зоны', () => {
  it('вне зоны держит полосу и всплывающее оповещение', () => {
    renderHook(({ active, position }) => useRideZoneNotice({ active, position }), {
      initialProps: { active: true, position: OUTSIDE },
    });

    expect(persistentKeys()).toContain('outside-zone');
    expect(toastKeys()).toContain('outside-zone');
  });

  it('внутри зоны оповещений нет', () => {
    renderHook(({ active, position }) => useRideZoneNotice({ active, position }), {
      initialProps: { active: true, position: INSIDE },
    });

    expect(persistentKeys()).not.toContain('outside-zone');
    expect(toastKeys()).toHaveLength(0);
  });

  it('повторные обновления положения не повторяют всплывающее оповещение', () => {
    const { rerender } = renderHook(({ active, position }) => useRideZoneNotice({ active, position }), {
      initialProps: { active: true, position: OUTSIDE },
    });

    act(() => {
      useNotificationsStore.getState().dismissToast('outside-zone');
    });
    // Парковый поток присылает положение часто: тост не должен возвращаться сам.
    rerender({ active: true, position: { lat: 43.5001, lng: 74.0001 } });

    expect(toastKeys()).not.toContain('outside-zone');
    expect(persistentKeys()).toContain('outside-zone');
  });

  it('возвращение в зону снимает полосу и сообщает о разблокировке', () => {
    const { rerender } = renderHook(({ active, position }) => useRideZoneNotice({ active, position }), {
      initialProps: { active: true, position: OUTSIDE },
    });

    rerender({ active: true, position: INSIDE });

    expect(persistentKeys()).not.toContain('outside-zone');
    expect(toastKeys()).toContain('back-in-zone');
  });

  it('повторный выезд снова оповещает', () => {
    const { rerender } = renderHook(({ active, position }) => useRideZoneNotice({ active, position }), {
      initialProps: { active: true, position: OUTSIDE },
    });
    rerender({ active: true, position: INSIDE });
    act(() => {
      useNotificationsStore.getState().reset();
    });

    rerender({ active: true, position: OUTSIDE });

    expect(persistentKeys()).toContain('outside-zone');
    expect(toastKeys()).toContain('outside-zone');
  });

  it('завершённая поездка снимает полосу про зону', () => {
    const { rerender } = renderHook(({ active, position }) => useRideZoneNotice({ active, position }), {
      initialProps: { active: true, position: OUTSIDE },
    });

    rerender({ active: false, position: OUTSIDE });

    expect(persistentKeys()).not.toContain('outside-zone');
  });
});
