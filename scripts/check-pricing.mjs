#!/usr/bin/env node
/**
 * check-pricing.mjs — независимая сверка тарификации с эталонной таблицей из docs/DOMAIN.md §5.
 *
 * Смысл: тесты писались вместе с кодом, поэтому здесь эталон задан отдельно — сценарий,
 * ожидаемая сумма в тыйынах и разбивка. Скрипт печатает таблицу и падает с кодом 1 при расхождении.
 *
 * Запуск:  node scripts/check-pricing.mjs
 */

import { calcRidePrice } from '../shared/src/money.ts';
import { DEFAULT_TARIFF } from '../shared/src/constants.ts';

const T0 = Date.UTC(2026, 9, 13, 10, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

/** Сценарий: поездка с интервалами [старт, финиш] и паузами [[старт, финиш], ...] в секундах от T0. */
const scenario = (rideEndSec, pauses = []) => {
  const base = { startedAt: iso(T0), finishedAt: iso(T0 + rideEndSec * 1000) };
  const pauseList = pauses.map(([s, e]) => ({
    startedAt: iso(T0 + s * 1000),
    endedAt: iso(T0 + e * 1000),
  }));
  return { ride: base, pauses: pauseList };
};

const cases = [
  { name: 'старт и сразу финиш (0 с)', rideEndSec: 0, pauses: [], expect: 3100, rideMin: 1, pauseMin: 0 },
  { name: '59 с', rideEndSec: 59, pauses: [], expect: 3100, rideMin: 1, pauseMin: 0 },
  { name: '60 с', rideEndSec: 60, pauses: [], expect: 3100, rideMin: 1, pauseMin: 0 },
  { name: '61 с', rideEndSec: 61, pauses: [], expect: 3700, rideMin: 2, pauseMin: 0 },
  { name: '15 мин ровно', rideEndSec: 900, pauses: [], expect: 11500, rideMin: 15, pauseMin: 0 },
  {
    name: '10 мин + пауза 4:20 + 5 мин',
    rideEndSec: 1160,
    pauses: [[600, 860]],
    expect: 12500,
    rideMin: 15,
    pauseMin: 5,
  },
  { name: 'пауза 30 с', rideEndSec: 30, pauses: [[0, 30]], expect: 2700, rideMin: 0, pauseMin: 1 },
];

let failed = 0;
console.log(`тариф: unlock=${DEFAULT_TARIFF.unlockFee}, ride=${DEFAULT_TARIFF.ridePerMinute}/мин, pause=${DEFAULT_TARIFF.pausePerMinute}/мин (тыйын)`);
console.log('сценарий'.padEnd(32), 'ожидалось'.padEnd(10), 'получено'.padEnd(10), 'мин(езда/пауза)', 'итог');
for (const c of cases) {
  const { ride, pauses } = scenario(c.rideEndSec, c.pauses);
  const b = calcRidePrice(ride, pauses, T0 + c.rideEndSec * 1000, DEFAULT_TARIFF);
  const ok = b.total === c.expect && b.rideMinutes === c.rideMin && b.pauseMinutes === c.pauseMin;
  if (!ok) failed += 1;
  console.log(
    c.name.padEnd(32),
    String(c.expect).padEnd(10),
    String(b.total).padEnd(10),
    `${b.rideMinutes}/${b.pauseMinutes}`.padEnd(14),
    ok ? 'OK' : 'MISMATCH',
  );
  if (!ok) console.log('   breakdown:', JSON.stringify(b));
}

// целочисленность всех полей (деньги не должны быть float)
const allInt = cases.every((c) => {
  const { ride, pauses } = scenario(c.rideEndSec, c.pauses);
  const b = calcRidePrice(ride, pauses, T0 + c.rideEndSec * 1000, DEFAULT_TARIFF);
  return Number.isInteger(b.total) && Number.isInteger(b.unlockFee) && Number.isInteger(b.rideAmount) && Number.isInteger(b.pauseAmount);
});
console.log(`\nцелочисленность всех сумм: ${allInt ? 'OK' : 'НАРУШЕНА'}`);
if (!allInt) failed += 1;

console.log(failed === 0 ? '\nСВЕРКА ПРОЙДЕНА: все сценарии совпали с эталоном DOMAIN.md §5' : `\nСВЕРКА ПРОВАЛЕНА: расхождений ${failed}`);
process.exit(failed === 0 ? 0 : 1);
