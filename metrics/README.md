# metrics/ — учёт экономии локального инференса

Здесь лежит статистика по тому, сколько работы сделали сабагенты на локальной модели
(`kat-coder` на `llama-server`, RTX 3090) и сколько те же токены стоили бы на API DeepSeek.

## Файлы

| Файл | Что внутри |
|---|---|
| `local-savings.json` | машинночитаемая статистика: батчи, задачи, токены, параллельность, деньги |
| `README.md` | этот файл — методика и как пересчитать |

## Как считается

**Токены — из учёта Hermes, а не из оценок.** Источник: `state.db` → `session_model_usage`,
строки сессий воркеров (`billing_provider = 'custom'`, модель `kat-coder`). Скрипт связывает
сессию воркера с батчем делегирования по времени запуска (дочерние сессии получают id вида
`YYYYMMDD_HHMMSS_…`, где время совпадает с `dispatched_at` батча в `async_delegations`).

- `input_tokens` → **cache miss** (новые входные токены);
- `cache_read_tokens` → **cache hit** (переиспользованный промпт);
- `output_tokens` → **токены выдачи** (то, что собственно сгенерировали воркеры);
- `api_call_count` → число обращений воркеров к локальной модели.

**Деньги.** Стоимость тех же токенов по прайсу DeepSeek (за 1M токенов, таблица от 2026-10-13),
отдельно для `deepseek-flash (DeepSeek-V4.1-Flash)` и `deepseek-v4-pro (DeepSeek-V4-Pro-0813)`,
в обоих тарифах — peak и off-peak. Формула:

```
cost = hit/1M · price_cache_hit + miss/1M · price_cache_miss + out/1M · price_output
saved = cost − фактические локальные расходы ($0)
```

Маржинальная стоимость локального инференса принята за 0: электричество и износ GPU не считаем
(это оценка экономии на API, а не полная стоимость владения).

**Параллельность.** Для каждого батча:
- `wallClockSeconds` = `completed_at − dispatched_at` (сколько занял батч по настенным часам);
- `sumTaskSeconds` = сумма времени отдельных воркеров;
- `parallelismFactor` = `sumTaskSeconds / wallClockSeconds` (во сколько раз параллельный запуск быстрее
  последовательного);
- `timeSavedByParallelismSeconds` = `sumTaskSeconds − wallClockSeconds` (сэкономленное время).

## Пересчёт

```bash
npm run metrics                      # пересобрать metrics/local-savings.json
npm run metrics:print                # то же + сводка в консоль (скрипт и так печатает её)
```

Скрипт читает `state.db` по пути `%LOCALAPPDATA%\hermes\state.db` (переопределяется `--db`),
пишет в `metrics/local-savings.json` (`--out`), фильтрует батчи по вхождению строки
`transport-sharing` в цели задач (`--project`).
