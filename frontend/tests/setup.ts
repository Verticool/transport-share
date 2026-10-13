import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Каждый тест стартует с чистой темой: иначе localStorage протекает между тестами.
beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = 'light';
});
