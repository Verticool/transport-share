# Задание воркеру · S2-mock-fix · доделать мок-данные и генератор

## Ситуация

Предыдущий воркер создал генератор и тесты, JSON-файлы сгенерированы (`mock/*.json` существуют),
но проверки не проходят. Нужно довести до зелёного состояния.

## Что сделать

Привести в порядок ровно эти файлы (менять можно только их):

1. `E:\Work\transport-sharing\scripts\generate-mock.mjs`
2. `E:\Work\transport-sharing\scripts\generate-mock.d.ts`
3. `E:\Work\transport-sharing\shared\tests\mock.test.ts`

Каталог `mock/*.json` перегенерировать скриптом (руками JSON не править).

Критерий: `npx tsc --noEmit` exit 0, `npx vitest run tests/mock.test.ts` — все тесты зелёные,
`eslint` по этим трём файлам — 0 ошибок, повторный запуск генератора даёт файлы байт-в-байт (md5 совпадают).

## Что НЕ трогать

- Ничего в `shared/src/`, в других файлах `shared/tests/`, в `scripts/collect-savings.mjs`,
  `scripts/check-pricing.mjs`, `package.json`, `tsconfig.json`, `eslint.config.js`.

## Известные дефекты (проверено оркестратором)

**eslint в `scripts/generate-mock.mjs`:**
```
1:1   error  /* eslint-env */ comments are no longer supported
16:1  error  Use "@ts-expect-error" instead of "@ts-ignore" ...   (@typescript-eslint/ban-ts-comment)
64:10 error  'randomIso' is defined but never used
```
Правки: комментарии `/* eslint-env */` удалить (flat config их не понимает);
`@ts-ignore` убрать вместе с подавляемой проблемой — вместо подавления починить типы;
неиспользуемое удалить. Помни: **`@ts-ignore` и `@ts-expect-error` в проекте запрещены рулсетом**.

**tsc в `shared/tests/mock.test.ts`:**
```
tests/mock.test.ts(27,30): error TS7016: Could not find a declaration file for module '../../scripts/generate-mock.mjs'
tests/mock.test.ts(108,38): error TS7006: Parameter 's' implicitly has an 'any' type
tests/mock.test.ts(118,46): error TS7006: Parameter 's' implicitly has an 'any' type
tests/mock.test.ts(143,54): error TS7006: Parameter 'inv' implicitly has an 'any' type
tests/mock.test.ts(147,37): error TS18046: 'inv' is of type 'unknown'
tests/mock.test.ts(186,45): error TS7006: Parameter 'u' implicitly has an 'any' type
tests/mock.test.ts(187,51): error TS7006: Parameter 's' implicitly has an 'any' type
tests/mock.test.ts(188,45): error TS7006: Parameter 'r' implicitly has an 'any' type
tests/mock.test.ts(206,35): error TS7006: Parameter 'e' implicitly has an 'any' type
tests/mock.test.ts(216,49): error TS7006: Parameter 'u' implicitly has an 'any' type
tests/mock.test.ts(255,35): error TS7006: Parameter 'u' implicitly has an 'any' type
```
Причина: у генератора либо нет деклараций, либо они объявляют всё как `unknown`/`any`.
**Правильное лечение:** `generate-mock.d.ts` должен объявлять точные типы — функция генерации возвращает
типизированные структуры домена (`Scooter[]`, `User[]`, `Ride[]`, `Invoice[]`, `EmailMessage[]`,
`ServiceZone`) из `shared/src/domain.ts`, а также функцию записи файлов. Тогда параметры колбэков
в тестах типизируются автоматически и `implicit any` исчезает. Касты (`as`) и `any` не использовать.

## Что должно остаться верным по данным (если тесты это проверяют — не ломать)

40 самокатов внутри полигона зоны (10+ с зарядом < 20 и все `unavailable`), 6 пользователей
(включая `demo@sharing.kg`), 25 завершённых поездок с `breakdown` от `calcRidePrice`, 25 счетов,
25 писем с `dedupeKey = 'invoice:<rideId>'`, все суммы целые в тыйынах, валюта `KGS`,
ссылочная целостность, детерминизм генерации.

## Ограничения

- **Запрещены приведения типов**: `as`, `as any`, `as unknown as`, `<T>value`, `value!`,
  `@ts-ignore`, `@ts-expect-error`. Единственное исключение — `as const`.
- **Запрещён `any`.**
- Никаких новых зависимостей.
- Работать строго в целевых путях, без scratch и `cp`.
- Читать только: этот файл, `scripts/generate-mock.mjs`, `scripts/generate-mock.d.ts`,
  `shared/tests/mock.test.ts`, `shared/src/domain.ts`, `shared/src/schemas.ts`,
  `shared/src/constants.ts`, `shared/src/money.ts`, `shared/src/zone.ts`.
  Больше ничего — раздутый контекст приводит к отказу модели («request too large»).
- Терминал — git-bash (MSYS); русский текст и JSON не передавать inline в bash; никогда не `python -c`.

## Критерии приёмки (сырой вывод обязателен)

```
cd /e/Work/transport-sharing
node scripts/generate-mock.mjs && md5sum mock/*.json > /tmp/a.txt
node scripts/generate-mock.mjs && md5sum mock/*.json > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt && echo "детерминизм: файлы совпали"

cd shared
npx tsc --noEmit -p tsconfig.json             # exit 0
npx vitest run tests/mock.test.ts             # все зелёные, видно количество
npx eslint ../scripts/generate-mock.mjs ../scripts/generate-mock.d.ts tests/mock.test.ts   # 0 ошибок
```

## Отчёт

Короткий: что было причиной ошибок типов и как решено, сырой вывод команд, сводка по данным
(статусы парка, сколько с низким зарядом, диапазон сумм счетов).
