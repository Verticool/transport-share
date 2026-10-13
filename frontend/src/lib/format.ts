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

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Момент времени для истории и счетов: «13 октября, 11:34». */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** Длительность в минутах для истории: «12 мин», «1 ч 05 мин». */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${String(rest).padStart(2, '0')} мин`;
}
