import { create } from 'zustand';

/**
 * Оповещения приложения.
 *
 * Два вида: постоянные состояния (нет связи, самокат садится) — они висят полосой под хедером,
 * пока состояние держится, и всплывающие (поездка закрылась, доступ восстановлен) — они
 * появляются поверх экрана и сами скрываются. Раньше предупреждение жило только внутри панели
 * поездки: если человек смотрел на карту, он его не видел.
 */
export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

export interface Notice {
  /** Ключ состояния: повторные вызовы с тем же ключом обновляют запись, а не плодят дубли. */
  key: string;
  title: string;
  description?: string;
  tone: NoticeTone;
  /** Время автоскрытия для всплывающего оповещения; у постоянного полосы его нет. */
  autoHideMs?: number;
}

export interface NotificationsState {
  /** Постоянные состояния: показываются полосой, живут до снятия тем же ключом. */
  persistent: Notice[];
  /** Всплывающие оповещения: показываются поверх экрана и сами скрываются. */
  toasts: Notice[];
  setPersistent: (notice: Notice) => void;
  clearPersistent: (key: string) => void;
  toast: (notice: Notice) => void;
  dismissToast: (key: string) => void;
  reset: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  persistent: [],
  toasts: [],

  setPersistent: (notice) => {
    set((state) => {
      const rest = state.persistent.filter((item) => item.key !== notice.key);
      return { persistent: [...rest, notice] };
    });
  },

  clearPersistent: (key) => {
    set((state) => ({ persistent: state.persistent.filter((item) => item.key !== key) }));
  },

  toast: (notice) => {
    set((state) => {
      const rest = state.toasts.filter((item) => item.key !== notice.key);
      return { toasts: [...rest, notice] };
    });
  },

  dismissToast: (key) => {
    set((state) => ({ toasts: state.toasts.filter((item) => item.key !== key) }));
  },

  reset: () => {
    set({ persistent: [], toasts: [] });
  },
}));
