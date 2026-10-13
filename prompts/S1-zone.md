# Задание воркеру · S1-zone · `shared/src/zone.ts` + тесты

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\shared\src\zone.ts`
2. `E:\Work\transport-sharing\shared\tests\zone.test.ts`

## Что НЕ трогать

- Не менять `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `tsconfig.base.json`.
- Не трогать `shared/src/domain.ts`, `constants.ts`, `ws-protocol.ts`, `index.ts` и другие файлы в `tests/`.
- Не создавать дополнительных файлов (никаких `.gitkeep`, `README`, баррелей).

## Контекст

Проект: сервис шеринга самокатов. `shared` — пакет `@sharing/shared` (ESM, `strict: true`,
`noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, импорты внутри пакета — с расширением `.ts`).
Тесты — vitest 5, лежат в `shared/tests/`.
Зона обслуживания и её полигон описаны в `E:\Work\transport-sharing\docs\DOMAIN.md §6` и
`shared/src/constants.ts` (`SERVICE_ZONE`, 8 точек вокруг центра Бишкека).

Задача модуля — геометрия зоны **без PostGIS** и без внешних библиотек (только стандартный математический аппарат).

## Обязательный контракт (сигнатуры менять нельзя)

```ts
import type { LatLng, ServiceZone } from './domain.ts';

/** Расстояние по большому кругу, метры (формула гаверсинуса, R = 6371008.8 м). */
export function haversineM(a: LatLng, b: LatLng): number;

/** Точка внутри полигона (ray casting). Точка ровно на границе считается ВНУТРИ зоны. */
export function isInsideZone(point: LatLng, zone: ServiceZone): boolean;

/** Кратчайшее расстояние до границы полигона, метры: 0 на границе, > 0 и внутри, и снаружи. */
export function distanceToZoneBoundaryM(point: LatLng, zone: ServiceZone): number;

/** Bounding box полигона. */
export function zoneBBox(zone: ServiceZone): { minLat: number; minLng: number; maxLat: number; maxLng: number };

/** Центроид полигона (среднее по площади, а не среднее вершин). */
export function zoneCenter(zone: ServiceZone): LatLng;

/** Ближайшая точка, гарантированно внутри зоны: снаружи — проекция на границу и отступ внутрь на 5 м. */
export function clampToZone(point: LatLng, zone: ServiceZone): LatLng;

/** Случайная точка внутри зоны. Детерминирована при заданном rng (rejection sampling по bbox). */
export function randomPointInZone(zone: ServiceZone, rng: () => number): LatLng;

/** Точка, сдвинутая от `from` к `to` не дальше чем на distanceM (если цель ближе — вернуть цель). */
export function moveTowards(from: LatLng, to: LatLng, distanceM: number): LatLng;

/** Точка, сдвинутая на distanceM по азимуту (градусы, 0 = север, по часовой). Нужна симулятору. */
export function moveByBearing(from: LatLng, distanceM: number, bearingDeg: number): LatLng;

/** Азимут из `from` в `to`, градусы 0..360. */
export function bearingDeg(from: LatLng, to: LatLng): number;
```

## Требования к точности

- `haversineM`: проверка на известных парах — центр Бишкека (42.8746, 74.5698) → (42.8846, 74.5698)
  = 1111 ± 15 м (1° широты ≈ 111.19 км). Две точки на расстоянии ~500 м — расхождение с
  эквиректангулярным приближением ≤ 1 %.
- `moveTowards`/`moveByBearing`: тест «прошёл 300 м по азимуту 90° → haversineM(from, result) = 300 ± 1 м»;
  тест «сдвиг на север увеличивает широту, долгота меняется ≤ 1e-9».
- `distanceToZoneBoundaryM`: для точки на границе → 0 ± 1 м; для точки в 1 км от границы внутри — 1000 ± 50 м;
  для центра зоны — значение > 1000 м и < 4000 м.

## Обязательные тесты (минимум)

1. Центр Бишкека (42.8746, 74.5698) — внутри зоны; (42.95, 74.6) — снаружи.
2. Каждая из 8 вершин полигона — внутри (граница включительно).
3. Точка ровно на середине ребра — внутри.
4. `distanceToZoneBoundaryM`: вершина → 0 ± 1 м; центр зоны → в заявленном диапазоне; точка снаружи → > 0.
5. `zoneBBox` совпадает с минимумом/максимумом координат полигона.
6. `clampToZone`: точка далеко снаружи → результат внутри зоны и `isInsideZone === true`;
   точка внутри → возвращается практически та же точка (< 1 м сдвига).
7. `randomPointInZone` с детерминированным rng (mulberry32 или аналогичный, реализуйте прямо в тесте):
   - 500 точек, все внутри зоны;
   - два прогона с одинаковым seed дают одинаковый первый результат (детерминизм).
8. `moveTowards`: движение меньше расстояния до цели — точка между ними, не перелетает; цель ближе шага — возвращается цель.
9. `bearingDeg`/`moveByBearing`: север = 0 ± 0.5, восток = 90 ± 0.5, юг = 180 ± 0.5, запад = 270 ± 0.5;
   круговой тест «сдвинулись на 300 м по азимуту 45° и вернулись обратным азимутом — вернулись в исходную точку ± 1 м».
10. `haversineM(a, a) === 0`; симметричность `haversineM(a,b) === haversineM(b,a)`.

## Критерии приёмки (привести сырой вывод)

```
cd /e/Work/transport-sharing/shared
npx tsc --noEmit -p tsconfig.json      # exit 0
npx vitest run tests/zone.test.ts      # все тесты зелёные, в выводе видно количество тестов
```

## Ограничения среды

- Терминал — git-bash (MSYS). Русский текст и JSON не передавать inline в bash-команды.
- Никогда не использовать `python -c "..."` — только файл через write_file и относительный запуск.
- Нативные программы (node, npx) не понимают пути `/e/...` — сначала `cd`, затем относительные пути.
- Браузера нет и не нужно: только `tsc` + `vitest`.
- Никаких внешних гео-библиотек (geolib, turf и прочее) — считать самим.
- Если требование противоречит написанному — остановиться и вернуть вопрос.

## Отчёт

Короткий: перечень созданных файлов, сырой вывод `tsc` и `vitest`, какие граничные случаи покрыты.
