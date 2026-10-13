# Задание воркеру · S1-sim-fix · доделать симулятор транспорта

## Ситуация

Предыдущий воркер создал `shared/src/sim/index.ts` и `shared/tests/sim.test.ts`, но не сдал работу:
`tsc` падает, 11 тестов красные. Контракт функций верный (сигнатуры менять нельзя) — нужно довести
до зелёного состояния.

## Что сделать

Исправить ровно два файла:

1. `E:\Work\transport-sharing\shared\src\sim\index.ts`
2. `E:\Work\transport-sharing\shared\tests\sim.test.ts`

Критерий: `npx tsc --noEmit` exit 0, все тесты `tests/sim.test.ts` зелёные, `eslint` по этим файлам без ошибок.

## Что НЕ трогать

- Ничего в `shared/src/` кроме `sim/index.ts` (в том числе `zone.ts`, `constants.ts`, `domain.ts`, `schemas.ts`).
- Ничего в других файлах `shared/tests/`.
- `shared/package.json`, `shared/tsconfig.json`, `vitest.config.ts`, корневой `eslint.config.js`.
- Публичные сигнатуры и имена в `sim/index.ts` менять нельзя: `createRng`, `SimScooter`, `StepOptions`,
  `StepResult`, `FleetStepResult`, `stepScooter`, `stepFleet`, `pickWaypoint`.

## Известные дефекты (проверено оркестратором)

**tsc (5 ошибок):**
```
src/sim/index.ts(88,10):  error TS6133: 'safeClamp' is declared but its value is never read
src/sim/index.ts(103,21): error TS18048: 'segA' is possibly 'undefined'
src/sim/index.ts(104,21): error TS18048: 'segA' is possibly 'undefined'
src/sim/index.ts(105,21): error TS18048: 'segB' is possibly 'undefined'
src/sim/index.ts(106,21): error TS18048: 'segB' is possibly 'undefined'
```
Причина `segA/segB`: `noUncheckedIndexedAccess` — доступ к элементам массива даёт `T | undefined`.
Правильное лечение — типизированный хелпер доступа (как `at(polygon, index)` в `zone.ts`),
а не `!` и не `as`. Неиспользуемую функцию удалить.

**vitest (11 падений, проверено):**
- правило 1: `free` / `reserved` / `unavailable` — «без изменений координат и заряда»;
- правило 2: «проходит speedMps * dtSeconds метров»;
- правило 3: «waypointReached=true, новая цель»;
- правило 5: «точный расход за 60 секунд: ровно drainPctPerMin», «накопление дробного остатка:
  10 шагов по 6 с = один шаг 60 с», «batteryDepleted ровно на последнем проценте»;
- правило 6: «применяет шум и не выводит за зону»;
- правило 7: «20 шагов парка с одинаковым seed дают одинаковый результат».

Разбираться надо по существу: где ошибка в реализации `stepScooter`/`stepFleet`, где в самом тесте.
**Подгонять тест под вывод реализации запрещено** — сначала проверь эталон (руками посчитай ожидаемое
значение из констант `SIM.speedMps`, `BATTERY_DRAIN_PCT_PER_MIN`), потом правь код.

Ориентиры: `SIM.speedMps = 4.2` м/с, `BATTERY_DRAIN_PCT_PER_MIN = 1`, `waypointReachedM = 15`,
`gpsNoiseM = 3`, `ZONE_WARN_DISTANCE_M = 150`.

## Ограничения

- **Запрещены приведения типов**: `as`, `as any`, `as unknown as`, `<T>value`, `value!`,
  `@ts-ignore`, `@ts-expect-error`. Единственное исключение — `as const`.
- **Запрещён `any`.**
- Импорты внутри пакета — с расширением `.ts`; геометрия только из `../zone.ts`.
- Работать строго в целевых путях, без scratch и `cp`.
- Читать только: этот файл, `shared/src/sim/index.ts`, `shared/tests/sim.test.ts`,
  `shared/src/zone.ts`, `shared/src/constants.ts`, `shared/src/domain.ts`.
  Больше ничего не читать — раздутый контекст приводит к отказу модели («request too large»).
- Терминал — git-bash (MSYS); русский текст и JSON не передавать inline в bash; никогда не `python -c`.

## Критерии приёмки (сырой вывод обязателен)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json       # exit 0
npx vitest run tests/sim.test.ts        # все зелёные, видно количество
npx eslint src/sim tests/sim.test.ts    # 0 ошибок
```

## Отчёт

Короткий: что было причиной каждого класса падений, что исправлено, сырой вывод трёх команд.
