#!/usr/bin/env node
/**
 * collect-savings.mjs — считает экономию от того, что разработка идёт на локальной модели
 * (сабагенты на kat-coder / llama-server) вместо API DeepSeek.
 *
 * Источники данных (без внешних зависимостей):
 *   1) state.db Hermes → таблица `session_model_usage`: по каждой сессии воркера
 *      api_call_count, input_tokens, output_tokens, cache_read_tokens, first_seen, last_seen.
 *      `input_tokens` = новые (не закэшированные) входные токены → это cache miss.
 *      `cache_read_tokens` = переиспользованный промпт → это cache hit.
 *   2) state.db Hermes → таблица `async_delegations`: id батча, время dispatch/completed,
 *      цели задач (task_json) — по ним батчи фильтруются по проекту.
 *
 * Что считаем:
 *   - токены воркеров: input (cache miss) / cache read (cache hit) / output;
 *   - стоимость этих же токенов по прайсу DeepSeek V4.1 Flash и V4 Pro (peak и off-peak);
 *   - экономию = стоимость API − фактические локальные расходы ($0);
 *   - метрику параллельности: wall-clock батча против суммы времени задач воркеров,
 *     и сколько времени сэкономлено за счёт параллельного запуска.
 *
 * Запуск:  node scripts/collect-savings.mjs [--db PATH] [--out PATH] [--project SUBSTR] [--quiet]
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

// --- прайс (за 1M токенов, USD). Источник: таблица цен DeepSeek, 2026-10-13. ---
const PRICING = {
  asOf: '2026-10-13',
  currency: 'USD',
  perTokens: 1_000_000,
  note:
    'DeepSeek публикует тарифы отдельно для peak и off-peak часов; окна off-peak берутся из ' +
    'документации провайдера и здесь не предполагаются — считаем оба тарифа для диапазона.',
  models: {
    'deepseek-flash (DeepSeek-V4.1-Flash)': {
      inputCacheHit: { offPeak: 0.003, peak: 0.006 },
      inputCacheMiss: { offPeak: 0.15, peak: 0.3 },
      output: { offPeak: 0.6, peak: 1.2 },
    },
    'deepseek-v4-pro (DeepSeek-V4-Pro-0813)': {
      inputCacheHit: { offPeak: 0.022, peak: 0.044 },
      inputCacheMiss: { offPeak: 0.66, peak: 1.32 },
      output: { offPeak: 1.98, peak: 3.96 },
    },
  },
};

const LOCAL_STACK = {
  model: 'KAT-Coder-V2.5-Dev-APEX-Compact.gguf',
  modelPath: 'E:\\models\\KAT-Coder-V2.5-Dev-APEX-Compact.gguf',
  server: 'llama-server (llama.cpp b10920, CUDA 13.3)',
  endpoint: 'http://127.0.0.1:8080/v1',
  alias: 'kat-coder',
  gpu: 'NVIDIA GeForce RTX 3090 24 GB',
  contextTokens: 262144,
  costPerHourUsd: 0,
  comment: 'маржинальная стоимость локального инференса принята за 0 (электричество и износ GPU не учитываем)',
};

// --- CLI ---
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const HOME = process.env.LOCALAPPDATA ?? process.env.HOME ?? '.';
const dbPath = resolve(flag('db', `${HOME}/hermes/state.db`));
const outPath = resolve(flag('out', 'metrics/local-savings.json'));
const projectFilter = flag('project', 'transport-sharing');
const quiet = has('quiet');

// --- утилиты ---
const toIso = (seconds) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null);
const round = (n, digits = 6) => Number(n.toFixed(digits));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Стоимость набора токенов по прайсу модели и тарифу (peak | offPeak). */
function costOf(modelPrices, tokens, tier) {
  const per = PRICING.perTokens;
  return (
    (tokens.cacheHit / per) * modelPrices.inputCacheHit[tier] +
    (tokens.cacheMiss / per) * modelPrices.inputCacheMiss[tier] +
    (tokens.output / per) * modelPrices.output[tier]
  );
}

function priceAll(tokens) {
  const out = {};
  for (const [model, prices] of Object.entries(PRICING.models)) {
    out[model] = {
      peakUsd: round(costOf(prices, tokens, 'peak')),
      offPeakUsd: round(costOf(prices, tokens, 'offPeak')),
    };
  }
  return out;
}

// --- читаем state.db ---
const db = new DatabaseSync(dbPath, { readOnly: true });

const usageRows = db
  .prepare(
    `SELECT session_id, model, task, api_call_count, input_tokens, output_tokens,
            cache_read_tokens, cache_write_tokens, reasoning_tokens,
            estimated_cost_usd, actual_cost_usd, first_seen, last_seen
       FROM session_model_usage
      WHERE billing_provider = 'custom'`,
  )
  .all();

const delegations = db
  .prepare(
    `SELECT delegation_id, origin_session, state, dispatched_at, completed_at, task_json, result_json
       FROM async_delegations
      ORDER BY dispatched_at ASC`,
  )
  .all();

db.close();

// --- сопоставляем child-сессии делегациям ---
// Дочери получают session_id вида YYYYMMDD_HHMMSS_<hex>, где HHMMSS — локальное время dispatch.
const localStamp = (unixSeconds) => {
  const d = new Date(unixSeconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const parseTasks = (taskJson) => {
  if (typeof taskJson !== 'string' || taskJson.length === 0) return [];
  try {
    const parsed = JSON.parse(taskJson);
    if (Array.isArray(parsed)) {
      return parsed.map((t, i) => ({
        index: typeof t?.index === 'number' ? t.index : i,
        goal: typeof t?.goal === 'string' ? t.goal : '',
        status: typeof t?.status === 'string' ? t.status : 'unknown',
      }));
    }
    // Формат записи делегации в state.db: { goal, goals: string[], context, model, is_batch, ... }
    const goals = Array.isArray(parsed.goals) ? parsed.goals : [];
    if (goals.length > 0) {
      return goals.map((g, i) =>
        typeof g === 'string'
          ? { index: i, goal: g, status: 'unknown' }
          : { index: i, goal: typeof g?.goal === 'string' ? g.goal : '', status: 'unknown' },
      );
    }
    return typeof parsed.goal === 'string' ? [{ index: 0, goal: parsed.goal, status: 'unknown' }] : [];
  } catch {
    return [];
  }
};

const batches = [];
for (const d of delegations) {
  const tasks = parseTasks(d.task_json);
  const goalText = tasks.map((t) => t.goal).join(' ');
  if (projectFilter && !goalText.includes(projectFilter)) continue;

  const stamp = localStamp(d.dispatched_at);
  const children = usageRows.filter((u) => u.session_id.startsWith(stamp));

  const tokens = {
    cacheMiss: sum(children.map((u) => u.input_tokens ?? 0)),
    cacheHit: sum(children.map((u) => u.cache_read_tokens ?? 0)),
    output: sum(children.map((u) => u.output_tokens ?? 0)),
    cacheWrite: sum(children.map((u) => u.cache_write_tokens ?? 0)),
    reasoning: sum(children.map((u) => u.reasoning_tokens ?? 0)),
  };
  tokens.total = tokens.cacheMiss + tokens.cacheHit + tokens.output;

  const apiCalls = sum(children.map((u) => u.api_call_count ?? 0));
  const wallClockSeconds =
    d.completed_at !== null && d.dispatched_at !== null ? round(d.completed_at - d.dispatched_at, 2) : null;
  const sumTaskSeconds = round(sum(children.map((u) => (u.last_seen ?? 0) - (u.first_seen ?? 0))), 2);
  const parallelism = wallClockSeconds && wallClockSeconds > 0 ? round(sumTaskSeconds / wallClockSeconds, 3) : null;
  const savedByParallelSeconds =
    wallClockSeconds !== null ? round(sumTaskSeconds - wallClockSeconds, 2) : null;

  const prices = priceAll(tokens);
  const flash = prices['deepseek-flash (DeepSeek-V4.1-Flash)'];

  batches.push({
    delegationId: d.delegation_id,
    state: d.state,
    dispatchedAt: toIso(d.dispatched_at),
    completedAt: toIso(d.completed_at),
    wallClockSeconds,
    sumTaskSeconds,
    parallelismFactor: parallelism,
    timeSavedByParallelismSeconds: savedByParallelSeconds,
    apiCallCount: apiCalls,
    workerCount: children.length,
    tokens,
    workerSessions: children.map((u) => ({
      sessionId: u.session_id,
      apiCalls: u.api_call_count,
      cacheMissTokens: u.input_tokens,
      cacheHitTokens: u.cache_read_tokens,
      outputTokens: u.output_tokens,
      seconds: round((u.last_seen ?? 0) - (u.first_seen ?? 0), 2),
    })),
    costIfApi: prices,
    localCostUsd: 0,
    savedUsd: {
      'deepseek-flash (DeepSeek-V4.1-Flash)': {
        peakUsd: flash.peakUsd,
        offPeakUsd: flash.offPeakUsd,
      },
    },
    tasks,
  });
}

// --- агрегаты ---
const totals = {
  batches: batches.length,
  workers: sum(batches.map((b) => b.workerCount)),
  apiCallCount: sum(batches.map((b) => b.apiCallCount)),
  tokens: {
    cacheMiss: sum(batches.map((b) => b.tokens.cacheMiss)),
    cacheHit: sum(batches.map((b) => b.tokens.cacheHit)),
    output: sum(batches.map((b) => b.tokens.output)),
    total: sum(batches.map((b) => b.tokens.total)),
  },
  wallClockSeconds: round(sum(batches.map((b) => b.wallClockSeconds ?? 0)), 2),
  sumTaskSeconds: round(sum(batches.map((b) => b.sumTaskSeconds)), 2),
  timeSavedByParallelismSeconds: round(sum(batches.map((b) => b.timeSavedByParallelismSeconds ?? 0)), 2),
  cacheHitShare: 0,
  costIfApi: {},
  savedUsd: {},
  localCostUsd: 0,
};

const inTokens = totals.tokens.cacheMiss + totals.tokens.cacheHit;
totals.cacheHitShare = inTokens > 0 ? round(totals.tokens.cacheHit / inTokens, 4) : 0;
totals.parallelismFactor =
  totals.wallClockSeconds > 0 ? round(totals.sumTaskSeconds / totals.wallClockSeconds, 3) : null;

for (const model of Object.keys(PRICING.models)) {
  totals.costIfApi[model] = {
    peakUsd: round(sum(batches.map((b) => b.costIfApi[model].peakUsd))),
    offPeakUsd: round(sum(batches.map((b) => b.costIfApi[model].offPeakUsd))),
  };
}
totals.savedUsd = Object.fromEntries(
  Object.entries(totals.costIfApi).map(([model, c]) => [
    model,
    { peakUsd: c.peakUsd, offPeakUsd: c.offPeakUsd },
  ]),
);

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  project: projectFilter,
  localStack: LOCAL_STACK,
  pricing: PRICING,
  totals,
  batches,
  methodology: {
    tokens: 'Из state.db → session_model_usage по сессиям воркеров (billing_provider=custom).',
    cacheHit: 'cache_read_tokens считаются как попадание в кэш входа (тариф cache hit), input_tokens — как промах.',
    parallelism:
      'wallClockSeconds × sumTaskSeconds: батч против суммы времени отдельных задач; ' +
      'timeSavedByParallelismSeconds = sumTaskSeconds − wallClockSeconds.',
    savings: 'Экономия = стоимость тех же токенов по прайсу DeepSeek − фактические локальные расходы (0).',
    caveats: [
      'Локальные часы и токены взяты из учёта Hermes; при недоступности usage у провайдера значения могут быть неполными.',
      'Окна peak/off-peak у DeepSeek различаются по времени суток — здесь показаны оба тарифа, а не выбран один.',
      'Электричество и износ GPU не учтены (0): это оценка экономии на API, а не полная стоимость владения.',
    ],
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

if (!quiet) {
  console.log(`written: ${outPath}`);
  console.log(
    `batches=${totals.batches} workers=${totals.workers} apiCalls=${totals.apiCallCount} ` +
      `in(miss)=${totals.tokens.cacheMiss} in(hit)=${totals.tokens.cacheHit} out=${totals.tokens.output}`,
  );
  console.log(
    `wall=${totals.wallClockSeconds}s sumTask=${totals.sumTaskSeconds}s parallelism=${totals.parallelismFactor}`,
  );
  for (const [model, c] of Object.entries(totals.costIfApi)) {
    console.log(`  ${model}: peak=$${c.peakUsd} offPeak=$${c.offPeakUsd}`);
  }
}
