/**
 * Форматирование величин для интерфейса.
 *
 * Отдельный модуль, потому что одни и те же подписи нужны в списке парка, в карточке самоката
 * и позже в деталях поездки: держать их в компонентах — значит получить три разных написания
 * одного и того же числа.
 */

/** Расстояние в метрах → «320 м» или «1,4 км» (в русском интерфейсе разделитель — запятая). */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} м`;
  }
  const km = meters / 1000;
  return `${km.toFixed(1).replace('.', ',')} км`;
}

/** Заряд в процентах → «87 %». */
export function formatPercent(value: number): string {
  return `${Math.round(value)} %`;
}
