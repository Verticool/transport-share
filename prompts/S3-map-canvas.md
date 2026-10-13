# Задание воркеру · S3-map-canvas · React-компонент карты

## Что сделать

Создать ровно два файла:

1. `E:\Work\transport-sharing\frontend\src\features\map\map-canvas.tsx` — компонент карты
2. `E:\Work\transport-sharing\frontend\tests\map-canvas.test.tsx` — тесты

## Что НЕ трогать

Ничего больше. В частности не трогать `features/map/map-page.tsx` (подключит оркестратор),
`lib/map/*` (готовые фабрики карты), `config/*`, `lib/*`, конфиги проекта, `shared/**`.
Новые зависимости не добавлять.

## Контекст

Карта уже умеет создаваться без React: `frontend/src/lib/map/create-map.ts` экспортирует
`createParkMap(target: HTMLElement): Map`, а `frontend/src/lib/map/layers.ts` — `createZoneLayer(zone)`.
Задача — обернуть это в React-компонент, который ведёт себя как настоящий виджет карты.

Читать обязательно: этот файл, `frontend/src/lib/map/create-map.ts`, `frontend/src/lib/map/layers.ts`,
`frontend/src/lib/theme-colors.ts`, `frontend/src/hooks/use-theme.ts`,
`frontend/src/components/ui/card.tsx`, `frontend/src/features/map/map-page.tsx`,
`frontend/tests/setup.ts` (там уже стоит заглушка `ResizeObserver`), `frontend/vitest.config.ts`,
`docs/BRAND.md` (термины интерфейса).

## Требования к компоненту

```tsx
export interface MapCanvasProps {
  /** Дополнительные классы контейнера. */
  className?: string;
}
export function MapCanvas(props: MapCanvasProps): JSX.Element;
```

1. **Контейнер и монтирование.** Компонент рендерит `<div>` с `ref`, в который через `useEffect`
   создаётся карта вызовом `createParkMap(element)`. `useEffect` обязан вернуть функцию очистки:
   снять привязку карты (`map.setTarget(undefined)`) и обнулить ref, чтобы при повторном монтировании
   (React 19 StrictMode монтирует дважды) не оставалось двух карт и «мёртвых» слушателей.
2. **Смена темы.** Карта рисуется на канвасе и не читает CSS-переменные сама, поэтому при смене темы
   стиль слоя зоны нужно обновлять: подпишись на `useTheme()` и при изменении `theme` пересоздай
   стиль слоя зоны из `readZoneColors()` (тот же приём, что в `createZoneLayer`, но без пересоздания карты).
3. **Размер.** Карта должна занимать весь контейнер: контейнеру задать `h-full w-full`, карте —
   обновлять размер при изменении контейнера (`map.updateSize()` в `ResizeObserver`), иначе после
   переключения экранов карта остаётся серой.
4. **Доступность.** На контейнере: `data-testid="map-canvas"`, `role="region"`,
   `aria-label="Карта самокатов"`, `<div>` карты не должен быть доступен фокусом.
5. Никакого текста о загрузке данных в этом компоненте: данные появятся в следующей задаче.
6. Комментарии — по делу («почему», а не «что»), русский язык.

## Обязательные тесты (минимум 5)

Тесты идут в jsdom (заглушка `ResizeObserver` уже подключена в `tests/setup.ts`), карта создаётся по-настоящему.

1. Компонент рендерит контейнер с `data-testid="map-canvas"` и `role="region"` с подписью «Карта самокатов».
2. Внутри контейнера после монтирования появляется узел карты OpenLayers (`.ol-viewport`).
3. При размонтировании карта снимается: `.ol-viewport` из документа исчезает.
4. Повторный рендер (перемонтирование, как делает StrictMode) не оставляет двух `.ol-viewport`
   в контейнере — их ровно один.
5. Переключение темы не ломает карту: после смены темы (через переключатель или смену класса
   `document.documentElement`) `.ol-viewport` остаётся на месте и карта сохраняет размер.

## Ограничения

- **Запрещены приведения типов** (`as`, `as unknown as`, `<T>`, `!`, `@ts-ignore`, `@ts-expect-error`),
  **запрещён `any`**. Разрешено только `as const`.
- **Никаких `node:fs`, `__dirname`, `process`** — код исполняется в браузере.
- Цвета — только через токены темы; в разметке не должно быть значений colour-классов вида `bg-green-500`.
- Импорты внутри `frontend/src` — относительные; типы/схемы/хелперы — из `@sharing/shared`
  (тестовые фабрики: `@sharing/shared/testing/factories`).
- **Не запускать проверки**: ни `tsc`, ни `vitest`, ни `eslint`, ни dev-серверы. Прогон и разбор
  ошибок — на оркестраторе.
- Работать строго в двух указанных путях, без scratch-каталогов и `cp`.

## Отчёт

Короткий: список файлов, что реализовано, какие сценарии покрывают тесты, что осталось спорным.
Вывод команд не приводить.
