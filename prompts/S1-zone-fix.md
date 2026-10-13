# Задание воркеру · S1-zone-fix · починить упавшие тесты `shared/src/zone.ts`

## Ситуация

Предыдущий воркер создал `E:\Work\transport-sharing\shared\src\zone.ts` и
`E:\Work\transport-sharing\shared\tests\zone.test.ts`. При независимой проверке:
`npx tsc --noEmit` падает с 4 ошибками, `npx vitest run tests/zone.test.ts` — 5 падений из 28.

## Что сделать

Довести оба файла до состояния: **`tsc --noEmit` exit 0 и все тесты зелёные (28/28 или больше)**.

## Что НЕ трогать

- Не менять публичные сигнатуры функций в `zone.ts` (они зафиксированы контрактом ниже).
- Не менять `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `tsconfig.base.json`,
  `shared/src/domain.ts`, `shared/src/constants.ts`, другие файлы в `src/` и `tests/`.
- Не создавать новых файлов.
- **Не работать в папке scratch и не копировать файлы через `cp`.** Писать и править строго
  в целевых путях `E:\Work\transport-sharing\shared\src\zone.ts` и `...\tests\zone.test.ts`.
- Читать только: этот файл задания, `shared/src/zone.ts`, `shared/tests/zone.test.ts`.
  Не читать `docs/DOMAIN.md`, `constants.ts` целиком и прочие документы — это раздувает контекст
  и приводит к зависанию модели (уже случилось один раз, промпт вырос до 58k токенов).

## Контракт (менять нельзя)

```ts
export const EARTH_RADIUS_M: number;
export function haversineM(a: LatLng, b: LatLng): number;
export function isInsideZone(point: LatLng, zone: ServiceZone): boolean;          // граница — внутри
export function distanceToZoneBoundaryM(point: LatLng, zone: ServiceZone): number; // 0 на границе, > 0 внутри и снаружи
export function zoneBBox(zone: ServiceZone): { minLat: number; minLng: number; maxLat: number; maxLng: number };
export function zoneCenter(zone: ServiceZone): LatLng;
export function clampToZone(point: LatLng, zone: ServiceZone): LatLng;            // снаружи → внутри зоны, отступ 5 м от границы
export function randomPointInZone(zone: ServiceZone, rng: () => number): LatLng;  // детерминизм при заданном rng
export function moveTowards(from: LatLng, to: LatLng, distanceM: number): LatLng;
export function moveByBearing(from: LatLng, distanceM: number, bearingDeg: number): LatLng;
export function bearingDeg(from: LatLng, to: LatLng): number;
```

## Что именно починено быть обязано

### Баги в тестах (логика реализации верна — исправлять тест)

1. **`1 degree of latitude ≈ 111100 m`** — тест сравнивает расстояние между точками, отличающимися
   на **0.01°** широты (42.8746 → 42.8846), с порогом 110985 м. 0.01° по меридиану ≈ 1111.95 м.
   Исправить эталон: ожидаемое значение ≈ 1112 м, допуск ±15 м. Тест обязан проверять
   `expect(dist).toBeGreaterThan(1097)` и `expect(dist).toBeLessThan(1127)` — двумя отдельными
   утверждениями.
2. **`north bearing ≈ 0 ± 0.5`** (строка ~236) — написано
   `expect(b).toBeGreaterThan(359.5) || expect(b).toBeLessThan(0.5);` — это неверно: `expect()`
   возвращает `void`, `||` даёт ошибку типов `TS1345`, а значение 0 не проходит первую проверку.
   Правильно: `expect(b === 0 || b > 359.5).toBe(true);` либо два отдельных `expect` с корректным
   условием (`const normalizedNorth = b > 359.5 ? b - 360 : b; expect(Math.abs(normalizedNorth)).toBeLessThan(0.5);`).
3. **`east/south/west bearing`** (строки ~243, ~250, ~257) — цепочки
   `expect(b).toBeGreaterThan(89.5).toBeLessThan(90.5);` не работают: `expect()` возвращает `void`,
   отсюда `TS2339`. Заменить на два отдельных утверждения на каждой из трёх.
   **Запрещено использовать `||` и цепочки в `expect` — только отдельные вызовы.**
4. **`short distance accuracy within 1%`** — эталон в тесте посчитан неверно (тест ждёт < 510,
   реализация даёт ≈ 597). Пересчитать эталон независимо: эквиректангулярное приближение
   (`dx = Δlng · 111320 · cos(широта)`, `dy = Δlat · 110574` — либо сфера по гаверсинусу, но
   посчитанная в тесте отдельной формулой), и сравнить с реализацией с допуском 1 %.
   **Подгонять тест под фактический вывод реализации запрещено** — эталон считается из координат,
   а не копируется из вывода `vitest`.
5. **`point 1 km from boundary inside → ≈ 1000 ± 50 m`** — проверить эталон: смещение на 1 км по
   широте = 1000 / 111195 ≈ 0.008993°. Если тест строит точку неверным смещением (например,
   прибавляет 0.01° или сдвигает по долготе без поправки на cos(широты)), исправить тест.
   Если расхождение остаётся при корректном эталоне — исправлять `distanceToZoneBoundaryM`.

### Баг в реализации (исправлять код, тест корректен по контракту)

6. **`clampToZone`: `far outside point → inside zone` падает** — `isInsideZone(clampToZone(point, zone), zone)`
   возвращает `false`. По контракту точка снаружи должна проецироваться на границу и сдвигаться
   внутрь зоны на 5 м, после чего `isInsideZone` обязана быть `true`. Исправить реализацию:
   проекция на ближайшую точку контура → сдвиг по нормали внутрь (направление нормали определить
   через `isInsideZone` для пробной точки) → проверить результат `isInsideZone` и, если он всё ещё
   `false`, уменьшать отступ до выполнения условия (но не менее 1 м).

## Ограничения (обязательны)

- **Никаких приведений типов**: ни `as any`, ни `as unknown as`, ни `as SomeType`, ни `<T>value`,
  ни `value!`, ни `@ts-ignore`/`@ts-expect-error`. Единственное исключение — `as const`.
- **Никакого `any`**: неизвестное — только `unknown` с сужением.
- Тесты не «подгоняются» под вывод: если тест падает, сначала проверяется эталон, и только потом код.
- Терминал — git-bash (MSYS). Русский текст и JSON не передавать inline в bash.
- Никогда не использовать `python -c "..."`.
- Браузера нет и он не нужен.

## Критерии приёмки (привести сырой вывод)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json          # exit 0, без вывода
npx vitest run tests/zone.test.ts          # все тесты зелёные, видно количество
grep -nE "\bas (any|unknown)\b|@ts-ignore|@ts-expect-error|: any" src/zone.ts tests/zone.test.ts   # пусто
```

## Отчёт

Короткий: что исправлено (по пунктам 1–6), сырой вывод трёх команд выше. Без пересказа задания.
