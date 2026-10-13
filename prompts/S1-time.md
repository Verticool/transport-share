# Задание воркеру · S1-time · `shared/src/time.ts` + тесты

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\shared\src\time.ts`
2. `E:\Work\transport-sharing\shared\tests\time.test.ts`

## Что НЕ трогать

- Не менять `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `tsconfig.base.json`.
- Не трогать `shared/src/domain.ts`, `constants.ts`, `ws-protocol.ts`, `index.ts` и другие файлы в `tests/`.
- Не создавать никаких дополнительных файлов (никаких `.gitkeep`, `README`, баррелей).

## Контекст

Проект: сервис шеринга самокатов, монорепо на npm workspaces.
`shared` — пакет `@sharing/shared` (ESM, TypeScript, `moduleResolution: bundler`, `strict: true`,
`noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`). Импорты внутри пакета обязаны быть
с расширением `.ts` (например `import type { Iso } from './domain.ts';`).
Раннер тестов: vitest 5 (в `shared/vitest.config.ts` указано `include: ['tests/**/*.test.ts']`).
Доменные определения: `E:\Work\transport-sharing\docs\DOMAIN.md` (§3 тайминги) и `shared/src/domain.ts`.

## Обязательный контракт (сигнатуры менять нельзя)

```ts
import type { Iso } from './domain.ts';

/** Часы: инъекция времени вместо Date.now(), чтобы таймеры были тестируемы. */
export interface Clock {
  now(): number; // unix ms
}

export const systemClock: Clock;

/** Часы для тестов: время двигается вручную. */
export interface MutableClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}
export function createClock(startMs: number): MutableClock;

export function toIso(ms: number): Iso;
export function fromIso(iso: Iso): number;

/** Полуинтервал в unix ms, start <= end. */
export interface Interval {
  start: number;
  end: number;
}

/**
 * Разбивает поездку на интервалы езды: окно [startedAt, finishedAt ?? nowMs] минус интервалы пауз.
 * Правила (проверяются тестами):
 *  - паузы обрезаются по окну поездки, сортируются и сливаются при пересечении;
 *  - результат — интервалы окна, не пересекающиеся с паузами, отсортированные по start;
 *  - интервалы нулевой длины НЕ выбрасываются, если окно поездки нулевое:
 *    поездка «старт и сразу финиш» (startedAt === finishedAt) даёт ровно один интервал [t, t];
 *  - если поездка целиком в паузе (окно полностью накрыто паузами) — вернуть пустой массив;
 *  - незакрытая пауза (endedAt === null) считается до nowMs;
 *  - незакрытая поездка (finishedAt === null) считается до nowMs.
 */
export function splitRideSegments(
  ride: { startedAt: Iso; finishedAt: Iso | null },
  pauses: Array<{ startedAt: Iso; endedAt: Iso | null }>,
  nowMs: number,
): Interval[];

/** Суммарная длительность интервалов, секунды (дробная часть сохраняется). */
export function durationSeconds(intervals: Interval[]): number;

/** Сколько миллисекунд осталось до target (может быть отрицательным). */
export function msUntil(nowMs: number, target: Iso): number;

/** Полных минут между моментами, вниз, может быть отрицательным. */
export function minutesBetween(fromMs: number, toMs: number): number;

/** 'MM:SS' до часа, 'H:MM:SS' дальше. Отрицательное значение — как '00:00'. */
export function formatDuration(totalSeconds: number): string;
```

## Обязательные тесты (минимум, но не только это)

1. `createClock` + `advance` + `set`: `now()` возвращает заданное значение.
2. `toIso`/`fromIso` — круговой переход; `toIso` всегда в UTC (`Z` на конце), пример:
   `toIso(0) === '1970-01-01T00:00:00.000Z'`.
3. `splitRideSegments`:
   - поездка без пауз, 10 минут → один интервал длиной 600 000 мс;
   - поездка 0 секунд → ровно один вырожденный интервал `[t, t]`;
   - одна пауза в середине → 2 интервала, суммарная длительность = окно − пауза;
   - две пересекающиеся паузы → сливаются, езда не «отрицательная»;
   - незакрытая пауза и незакрытая поездка (оба `null`) → окно до `nowMs`;
   - вся поездка в паузе → пустой массив;
   - пауза начинается до старта поездки и пауза заканчивается после финиша — обрезка по окну.
4. `durationSeconds`, `minutesBetween` (вниз, включая отрицательные), `msUntil`.
5. `formatDuration`: 0 → `'00:00'`, 59 → `'00:59'`, 60 → `'01:00'`, 3661 → `'01:01:01'`, −5 → `'00:00'`.

## Критерии приёмки (привести сырой вывод)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json      # exit 0
npx vitest run tests/time.test.ts      # все тесты зелёные, в выводе видно количество тестов
```

## Ограничения среды

- Терминал — git-bash (MSYS). Русский текст и JSON не передавать inline в bash-команды.
- Никогда не использовать `python -c "..."`: только файл через write_file и относительный запуск.
- Нативные программы (node, npx) не понимают пути вида `/e/...` — сначала `cd`, затем относительные пути.
- Браузера нет и не нужно: проверка только `tsc` + `vitest`.
- Если требование противоречит тому, что написано выше, — остановиться и вернуть вопрос, а не додумывать.

## Отчёт

Короткий: перечень созданных файлов, сырой вывод `tsc` и `vitest`, что именно проверено тестами.
Не выдумывать обходные пути и не пересказывать задание.
