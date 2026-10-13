import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * jsdom не реализует ResizeObserver, а OpenLayers создаёт его при инициализации карты.
 * Заглушка нужна только для тестов: в браузере этот API настоящий.
 */
globalThis.ResizeObserver = class {
  observe(): void {
    // Размеры в jsdom не меняются — наблюдать нечего.
  }
  unobserve(): void {
    // Симметрично observe: отписываться тоже не от чего.
  }
  disconnect(): void {
    // Освобождать нечего, но OpenLayers вызывает метод при уничтожении карты.
  }
};

// Каждый тест стартует с чистой темой: иначе localStorage протекает между тестами.
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = 'light';
});
