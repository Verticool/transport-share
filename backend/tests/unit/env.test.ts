import { describe, expect, it } from 'vitest';

import { readEnv } from '../../src/config/env';

/**
 * Настройки читаются один раз при старте и полностью проверяются схемой: приложение не должно
 * подниматься с нечисловым портом или пустой строкой подключения.
 */
describe('настройки окружения', () => {
  it('подставляет значения по умолчанию для локального запуска', () => {
    const env = readEnv({});

    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SIM_TICK_MS).toBe(1000);
  });

  it('приводит строки окружения к числам', () => {
    const env = readEnv({ PORT: '9000', SIM_TICK_MS: '250', ACCESS_TOKEN_TTL_MINUTES: '15' });

    expect(env.PORT).toBe(9000);
    expect(env.SIM_TICK_MS).toBe(250);
    expect(env.ACCESS_TOKEN_TTL_MINUTES).toBe(15);
  });

  it('отказывается работать с нечисловым портом', () => {
    expect(() => readEnv({ PORT: 'восемь тысяч' })).toThrow(/PORT/);
  });

  it('отказывается работать с портом вне диапазона', () => {
    expect(() => readEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('не принимает неизвестный уровень логов', () => {
    expect(() => readEnv({ LOG_LEVEL: 'громко' })).toThrow(/LOG_LEVEL/);
  });

  it('требует достаточно длинный секрет подписи токенов', () => {
    expect(() => readEnv({ ACCESS_TOKEN_SECRET: 'short' })).toThrow(/ACCESS_TOKEN_SECRET/);
  });

  it('сообщает все проблемные поля сразу', () => {
    try {
      readEnv({ PORT: 'нет', LOG_LEVEL: 'нет' });
      throw new Error('ожидалась ошибка настроек');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('PORT');
      expect(message).toContain('LOG_LEVEL');
    }
  });
});
