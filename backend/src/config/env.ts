import { z } from 'zod';

/**
 * Настройки бэкенда.
 *
 * Всё, что приходит из окружения, проверяется схемой при старте: приложение не должно подниматься
 * с пустым паролем к базе или портом-строкой — лучше отказаться работать сразу и внятно.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://sharing:sharing@localhost:5433/sharing'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Каталог с мок-данными: из них наполняется база (сид). */
  MOCK_DIR: z.string().min(1).default('../mock'),
  /** Секрет подписи токенов доступа. В проде обязателен свой — иначе значения по умолчанию не хватит. */
  ACCESS_TOKEN_SECRET: z.string().min(16).default('dev-access-secret-please-change'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Период симулятора парка, мс: как часто самокаты «двигаются» и разряжаются. */
  SIM_TICK_MS: z.coerce.number().int().positive().default(1000),
  /** Период обслуживания броней, мс: снятие просроченных и предупреждение о скором снятии. */
  BOOKING_TICK_MS: z.coerce.number().int().positive().default(5000),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Читает и проверяет настройки.
 *
 * Ошибку разбираем по полям: «DATABASE_URL: Expected string, received undefined» полезнее, чем
 * общий текст о неверной конфигурации.
 */
export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'настройки'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Неверные настройки окружения — ${details}`);
  }
  return parsed.data;
}
