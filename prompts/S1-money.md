# Задание воркеру · S1-money · `shared/src/money.ts` + тесты

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\shared\src\money.ts`
2. `E:\Work\transport-sharing\shared\tests\money.test.ts`

## Что НЕ трогать

- Не менять `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `tsconfig.base.json`.
- Не трогать `shared/src/domain.ts`, `constants.ts`, `time.ts`, `zone.ts`, `index.ts` и другие файлы в `tests/`.
- Не создавать дополнительных файлов.
- **Не использовать папку scratch и не копировать файлы через `cp`** — писать прямо в целевые пути.

## Контекст

Проект: сервис шеринга самокатов, монорепо npm workspaces. `shared` — ESM TypeScript, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; импорты внутри пакета
с расширением `.ts`. Тесты — vitest 5, файлы в `shared/tests/`.

Деньги считаются **только целыми числами в минорных единицах** (тыйын, 1 сом = 100 тыйын).
Никаких `float`, никаких `Number(...)` на неизвестных значениях, никакого округления «как получится».

Читать для контекста только: этот файл, `shared/src/time.ts` (готов, принят: `Clock`, `Interval`,
`splitRideSegments`, `durationSeconds`, `fromIso`, `toIso`, `minutesBetween`), `shared/src/domain.ts`
(типы `Minor`, `Iso`, `InvoiceBreakdown`), `shared/src/constants.ts` (тип `Tariff`, `MINOR_UNITS_PER_MAJOR`).
Не читать `docs/*` — контекст раздувается и модель зависает.

## Обязательный контракт (сигнатуры менять нельзя)

```ts
import type { InvoiceBreakdown, Iso, Minor } from './domain.ts';
import type { Tariff } from './constants.ts';

/** Округление вверх до полной минуты. 0 секунд → 0 минут; 1 секунда → 1 минута. */
export function billableMinutes(seconds: number): number;

/**
 * Минуты езды и паузы для поездки.
 * Паузы обрезаются окном поездки [startedAt, finishedAt ?? nowMs], сортируются и сливаются
 * при пересечении (та же нормализация, что в splitRideSegments).
 * Пауза целиком вне окна поездки не тарифицируется.
 */
export function billRide(
  ride: { startedAt: Iso; finishedAt: Iso | null },
  pauses: Array<{ startedAt: Iso; endedAt: Iso | null }>,
  nowMs: number,
): { rideMinutes: number; pauseMinutes: number; rideSegments: number };

/** Полный разбор цены завершённой или идущей поездки (для идущей nowMs = «сейчас»). */
export function calcRidePrice(
  ride: { startedAt: Iso; finishedAt: Iso | null },
  pauses: Array<{ startedAt: Iso; endedAt: Iso | null }>,
  nowMs: number,
  tariff: Tariff,
): InvoiceBreakdown;

/** Сумма к оплате на текущий момент: то же, что calcRidePrice(...).total. */
export function currentAmount(
  ride: { startedAt: Iso; finishedAt: Iso | null },
  pauses: Array<{ startedAt: Iso; endedAt: Iso | null }>,
  nowMs: number,
  tariff: Tariff,
): Minor;

/** '31.00' — минорные единицы в человекочитаемое число с двумя знаками. */
export function formatAmount(amount: Minor): string;

/** '31.00 сом' — то же с символом валюты. */
export function formatMinor(amount: Minor, currencySymbol: string): string;
```

## Правила расчёта (эталон — `docs/DOMAIN.md §5`, здесь продублировано)

```
rideMinutes  = Σ по сегментам езды: max(1, ceil(секунды сегмента / 60))
               если сегментов езды нет (поездка целиком в паузе) → 0
pauseMinutes = Σ по паузам внутри окна поездки: ceil(секунды паузы / 60)
total        = unlockFee + rideMinutes · ridePerMinute + pauseMinutes · pausePerMinute
```

Все составляющие `InvoiceBreakdown` — целые `Minor`:
`{ unlockFee, rideMinutes, rideAmount, pauseMinutes, pauseAmount, total }`.

Особые случаи (обязаны быть в тестах):

| Сценарий | Езда | Пауза | Итого при тарифе 2500/600/200 |
|---|---|---|---|
| старт и сразу финиш (0 с) | 1 мин | 0 | 3100 (31.00 сом) |
| 59 с | 1 мин | 0 | 3100 |
| 60 с | 1 мин | 0 | 3100 |
| 61 с | 2 мин | 0 | 3700 |
| 15 мин ровно | 15 мин | 0 | 11500 |
| 10 мин + пауза 4:20 + 5 мин | 15 мин | 5 мин | 12500 |
| пауза 30 с | 0 мин | 1 мин | 2700 (паузы в езде нет → rideMinutes = 0) |
| поездка целиком в паузе | 0 мин | ceil(секунды/60) | unlockFee + pauseAmount |

Дополнительно:
- поездка идущая (`finishedAt === null`) считается до `nowMs`;
- незакрытая пауза (`endedAt === null`) считается до `finishedAt ?? nowMs`;
- две пересекающиеся паузы не должны давать «отрицательную» езду и не должны считаться дважды;
- `rideMinutes` при 0 сегментов = 0 (никаких `max(1, 0)` на пустом массиве);
- все поля результата — целые числа: в тесте проверить `Number.isInteger` для каждого поля.

## Обязательные тесты (минимум)

1. Таблица выше — каждый сценарий отдельным тестом (7+ тестов) с полным сравнением `InvoiceBreakdown`.
2. `billableMinutes`: 0 → 0, 1 → 1, 59 → 1, 60 → 1, 61 → 2, 3600 → 60, отрицательное → 0.
3. `billRide`: поездка без пауз; одна пауза; две пересекающиеся паузы (сумма минут не удваивается);
   пауза за пределами окна (до старта, после финиша) — не тарифицируется; незакрытая пауза.
4. `currentAmount` растёт по минутам: для идущей поездки расчёт на 5-й и на 6-й минуте даёт разные суммы,
   разница ровно `ridePerMinute` (граничный случай перехода минуты).
5. `formatAmount`/`formatMinor`: 0 → `'0.00'`, 3100 → `'31.00 сом'`, 5 → `'0.05 сом'`, 123456 → `'1234.56 сом'`.
6. Свойство: для 200 случайных длительностей (детерминированный rng — mulberry32 прямо в тесте)
   `total === unlockFee + rideAmount + pauseAmount` и все поля целые.

## Ограничения (обязательны)

- **Никаких приведений типов**: `as any`, `as unknown as`, `as SomeType`, `<T>value`, `value!`,
  `@ts-ignore`/`@ts-expect-error` запрещены. Единственное исключение — `as const`.
- **Никакого `any`**.
- Никаких новых зависимостей и никаких библиотек для дат/денег.
- Терминал — git-bash (MSYS). Русский текст и JSON не передавать inline в bash.
- Никогда не использовать `python -c "..."`.
- Если требование противоречит написанному — остановиться и вернуть вопрос.

## Критерии приёмки (привести сырой вывод)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json          # в выводе не должно быть НИ ОДНОЙ ошибки, относящейся к src/money.ts и tests/money.test.ts
npx vitest run tests/money.test.ts         # все тесты зелёные, видно количество
grep -nE "\bas (any|unknown)\b|@ts-ignore|@ts-expect-error|: any" src/money.ts tests/money.test.ts   # пусто
```

**Важно про `tsc`:** в пакете сейчас есть 4 известные ошибки в `tests/zone.test.ts` — их исправляет
другой воркер параллельно. Этот файл не трогать, ошибки в нём — не твоя ответственность. Твой критерий:
в выводе `tsc` нет ошибок с путями `src/money.ts` или `tests/money.test.ts`.

## Отчёт

Короткий: список файлов, сырой вывод трёх команд, какие граничные случаи покрыты. Без пересказа задания.
