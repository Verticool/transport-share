# Задание воркеру · S1-lint-fix · убрать non-null assertions, добавить тестовые хелперы

## Ситуация

В `shared` включён строгий ESLint (type-checked, см. `RULES.md §F`), и он даёт 55 ошибок:

```
shared/src/zone.ts       26 × @typescript-eslint/no-non-null-assertion
shared/tests/time.test.ts 17 × @typescript-eslint/no-non-null-assertion
shared/tests/zone.test.ts 12 × @typescript-eslint/no-non-null-assertion
```

`!` (non-null assertion) запрещён рулсетом: он прячет возможный `undefined` вместо того, чтобы его обработать.

## Что сделать

Создать один новый файл и поправить три существующих:

1. **Новый** `E:\Work\transport-sharing\shared\src\testing\factories.ts` — типизированные хелперы для тестов:

```ts
import type { Booking, Invoice, Iso, Ride, Scooter, User } from '../domain.ts';

/** Достаёт элемент массива, гарантированно не undefined: если элемента нет — бросает Error.
 *  Заменяет `arr[i]!` в тестах и возвращает уже суженный тип T (без приведений типов). */
export function mustGet<T>(items: readonly T[], index: number): T;

/** Проверяет, что значение не null/undefined, и возвращает его суженным (бросает Error иначе). */
export function mustBeDefined<T>(value: T | null | undefined, what?: string): T;

/** Фабрики для тестовых данных: принимают частичный объект, возвращают полный доменный тип. */
export function makeScooter(overrides?: Partial<Scooter>): Scooter;
export function makeUser(overrides?: Partial<User>): User;
export function makeBooking(overrides?: Partial<Booking>): Booking;
export function makeRide(overrides?: Partial<Ride>): Ride;
export function makeInvoice(overrides?: Partial<Invoice>): Invoice;

/** Часы с фиксированным временем для тестов (обёртка над createClock из ../time.ts). */
export function fixedIso(ms: number): Iso;
```

2. `shared/src/zone.ts` — убрать все 26 `!`, поведение и публичные сигнатуры **не менять**.
   Типовые приёмы: вместо `polygon[i]!` — деструктуризация `const [lat, lng] = point` внутри
   проверки `if (point === undefined) continue;`, вместо `points[i]!` — `for (const p of points)`,
   вместо необязательного поля — явная проверка. Никаких приведений типов (`as`) — только сужение.
3. `shared/tests/time.test.ts` и `shared/tests/zone.test.ts` — заменить `!` на `mustGet(...)`
   из нового `../src/testing/factories.ts` (или на явную проверку `mustBeDefined`).
   **Смысл тестов и их количество менять нельзя: должно остаться 85 зелёных тестов.**

## Что НЕ трогать

- Не менять `shared/src/domain.ts`, `constants.ts`, `time.ts`, `money.ts`, `ws-protocol.ts`, `index.ts`.
- Не менять `package.json`, `tsconfig.json`, `vitest.config.ts`, корневой `eslint.config.js`.
- Не менять поведение функций: это правка типов, а не логики. Если правка «чтобы компилировалось»
  требует изменить поведение — остановиться и вернуть вопрос.
- Не создавать других файлов, кроме `shared/src/testing/factories.ts`.

## Ограничения

- **Запрещены приведения типов**: `as`, `as any`, `as unknown as`, `<T>value`, `value!`,
  `@ts-ignore`, `@ts-expect-error`. Единственное исключение — `as const`.
- **Запрещён `any`.**
- Работать строго в целевых путях, без папки scratch и без `cp`.
- Читать только: этот файл задания, `shared/src/zone.ts`, `shared/tests/time.test.ts`,
  `shared/tests/zone.test.ts`, `shared/src/domain.ts`, `shared/src/time.ts`.
  Других файлов не читать (раздутый контекст = зависание модели).
- Терминал — git-bash (MSYS); русский текст и JSON не передавать inline в bash; никогда не `python -c`.

## Критерии приёмки (сырой вывод обязателен)

```
cd /e/Work/transport-sharing
npx eslint shared            # 0 ошибок, пустой вывод
cd shared && npx tsc --noEmit -p tsconfig.json    # exit 0
cd shared && npx vitest run  # 85 тестов зелёные (3 файла)
grep -rnE "\w+![.)]" shared/src shared/tests | grep -v "!=" | grep -v "!==" | grep -v "!\s*$"   # пусто
```

## Отчёт

Короткий: сколько `!` убрано по файлам, как заменяли (какой приём), сырой вывод четырёх команд.
