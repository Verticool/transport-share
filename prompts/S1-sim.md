# Задание воркеру · S1-sim · `shared/src/sim/index.ts` — симулятор транспорта

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\shared\src\sim\index.ts`
2. `E:\Work\transport-sharing\shared\tests\sim.test.ts`

## Что НЕ трогать

- Не менять ничего в `shared/src/` (кроме создания новой папки `sim/`), `shared/tests/` (кроме нового файла),
  `shared/package.json`, `shared/tsconfig.json`, `vitest.config.ts`, корневой `eslint.config.js`.
- Не создавать других файлов.

## Контекст

Проект: сервис шеринга самокатов. Пакет `shared` (`@sharing/shared`) — ESM TypeScript, `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, импорты с расширением `.ts`.
Тесты — vitest 5. Геометрия уже готова в `shared/src/zone.ts`: `isInsideZone`, `haversineM`,
`moveTowards`, `moveByBearing`, `bearingDeg`, `randomPointInZone`, `zoneCenter`, `clampToZone`,
`distanceToZoneBoundaryM`. Константы — в `shared/src/constants.ts`: `SIM` (`speedMps`, `gpsNoiseM`,
`waypointReachedM`), `LOW_BATTERY_THRESHOLD`, `BATTERY_DRAIN_PCT_PER_MIN`, `ZONE_WARN_DISTANCE_M`.

Читать только: этот файл задания, `shared/src/constants.ts`, `shared/src/zone.ts`, `shared/src/domain.ts`.

Симулятор — чистая логика без таймеров и без обращений к сети: на фронт-стадии его крутит браузер
раз в секунду, на бэкенде — серверный тик. Поэтому он обязан быть **детерминированным при заданном rng**
и не мутировать входные данные.

## Обязательный контракт (сигнатуры менять нельзя)

```ts
import type { LatLng, ScooterStatus, ServiceZone } from '../domain.ts';

/** Детерминированный ГПСЧ (mulberry32), чтобы прогоны с одним seed совпадали. */
export function createRng(seed: number): () => number;

/** Состояние самоката в симуляторе. */
export interface SimScooter {
  id: string;
  status: ScooterStatus;
  lat: number;
  lng: number;
  batteryPct: number;
  /** Незавершённый остаток заряда от прошлых тиков (доли процента), чтобы не терять расход. */
  batteryRemainder: number;
  /** Цель движения; null — самокат стоит. */
  target: LatLng | null;
}

export interface StepOptions {
  /** Шаг времени, секунды. 0 — допустимо (шага нет). */
  dtSeconds: number;
  rng: () => number;
  zone: ServiceZone;
  /** Переопределения констант (по умолчанию — из constants.ts). */
  speedMps?: number;
  gpsNoiseM?: number;
  drainPctPerMin?: number;
  waypointReachedM?: number;
  zoneWarnDistanceM?: number;
}

export interface StepResult {
  /** Новое состояние (входной объект не мутируется). */
  scooter: SimScooter;
  /** Пройденное за шаг расстояние, метры. */
  movedM: number;
  /** Сколько целых процентов заряда ушло за шаг. */
  batteryDrainPct: number;
  /** Заряд упал до 0 в этом шаге — поездку надо завершать (B6). */
  batteryDepleted: boolean;
  /** Самокат достиг цели и получил новую. */
  waypointReached: boolean;
}

export function stepScooter(scooter: SimScooter, opts: StepOptions): StepResult;

export interface FleetStepResult {
  scooters: SimScooter[];
  /** id самокатов, у которых заряд дошёл до 0 на этом шаге. */
  depletedIds: string[];
}

/** Шаг для всего парка: каждый самокат обрабатывается stepScooter с одним и тем же rng. */
export function stepFleet(scooters: SimScooter[], opts: StepOptions): FleetStepResult;

/** Новая цель внутри зоны, не ближе чем minDistanceM от текущей точки (по умолчанию 300 м). */
export function pickWaypoint(from: LatLng, zone: ServiceZone, rng: () => number, minDistanceM?: number): LatLng;
```

## Правила поведения (каждое проверяется тестом)

1. **Стоящие самокаты не двигаются и не тратят заряд.** Двигается только `in_ride`.
   `free`, `reserved`, `unavailable` возвращаются без изменений координат и заряда.
2. **Движение.** За шаг самокат проходит `speedMps * dtSeconds` метров в направлении цели
   (использовать `moveTowards` из `zone.ts`). `movedM` — фактически пройденное расстояние.
3. **Достижение цели.** Если расстояние до цели ≤ `waypointReachedM`, шаг доводит самокат до цели,
   `waypointReached = true`, и новая цель выбирается через `pickWaypoint` (не ближе 300 м).
4. **Граница зоны.** Новая цель всегда внутри зоны (`isInsideZone`). Если самокат оказался ближе
   `zoneWarnDistanceM` к границе — цель переназначается от текущей точки внутрь зоны
   (`pickWaypoint`), чтобы симулятор не выводил транспорт за границу.
5. **Заряд.** Расход: `drainPctPerMin * dtSeconds / 60`, целая часть списывается,
   дробная копится в `batteryRemainder` (потерянных долей быть не должно: за 90 шагов по 1 с
   должно уйти ровно столько же, сколько за один шаг 90 с). Заряд не уходит ниже 0;
   при достижении 0 — `batteryDepleted = true`.
6. **GPS-шум.** К координате добавляется шум в пределах ±`gpsNoiseM` метров; смещение не должно
   выносить самокат за пределы зоны (при выходе — подрезать через `clampToZone`).
7. **Детерминированность.** Два прогона с одинаковым seed дают одинаковый результат;
   разные seed — разный (проверить на 20 шагах парка).
8. **Иммутабельность.** Входной `scooter` и массив `scooters` не изменяются.
9. **`dtSeconds = 0`** — состояние не меняется, `movedM = 0`, заряд не тратится.
10. **`pickWaypoint`** возвращает точку внутри зоны и не ближе `minDistanceM` к `from`
    (на 200 прогонах с детерминированным rng).

## Обязательные тесты (минимум 14)

Покрыть все 10 правил выше плюс: точный расход заряда за 60 секунд (ровно `drainPctPerMin`),
накопление дробного остатка (10 шагов по 6 с — тот же результат, что один шаг 60 с),
`batteryDepleted` ровно на последнем проценте, `stepFleet` возвращает массив той же длины
и собирает `depletedIds`, цель переназначается при приближении к границе.

## Ограничения

- **Запрещены приведения типов**: `as`, `as any`, `as unknown as`, `<T>value`, `value!`,
  `@ts-ignore`, `@ts-expect-error`. Единственное исключение — `as const`.
- **Запрещён `any`**; неизвестное — только `unknown` с сужением.
- Никаких новых зависимостей; геометрия — только из `zone.ts`.
- Работать строго в целевых путях, без папки scratch и без `cp`.
- Терминал — git-bash (MSYS); русский текст и JSON не передавать inline в bash; никогда не `python -c`.
- Браузера нет и он не нужен.

## Критерии приёмки (сырой вывод обязателен)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json      # exit 0
npx vitest run tests/sim.test.ts       # все тесты зелёные, видно количество
npx eslint src/sim tests/sim.test.ts   # 0 ошибок по этим файлам
```

## Отчёт

Короткий: список файлов, сырой вывод трёх команд, какие правила покрыты тестами.
