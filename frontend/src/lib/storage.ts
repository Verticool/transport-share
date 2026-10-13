import { z } from 'zod';

/**
 * Обёртки над сменными хранилищами браузера.
 *
 * По рулсету §F.3 значение из localStorage — такие же внешние данные, как ответ сервера:
 * оно приходит как `unknown`, проверяется zod-схемой и только потом становится типом приложения.
 * Без этого «испорченная» строка в хранилище роняет интерфейс невоспроизводимо.
 */

/** Читает строку и проверяет её одним из допустимых значений; иначе возвращает первый вариант. */
export function zodParseLocalStorage<T extends string>(
  key: string,
  fallback: T,
  ...allowed: [T, ...T[]]
): T {
  const schema = z.enum(allowed);
  const raw = z.string().safeParse(window.localStorage.getItem(key));
  if (!raw.success) {
    return fallback;
  }
  const parsed = schema.safeParse(raw.data);
  return parsed.success ? parsed.data : fallback;
}

/** Записывает значение, молча игнорируя недоступное хранилище (приватный режим, квота). */
export function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Намеренно ничего: недоступное хранилище не должно ломать интерфейс.
  }
}
