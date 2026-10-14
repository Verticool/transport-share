/**
 * Подводит строку к видимой части списка, двигая только сам список.
 *
 * `scrollIntoView` здесь не годится: он прокручивает всех предков, вместе с колонкой панели —
 * панель поездки уезжала вверх за пределы экрана, и управление самокатом становилось недоступным
 * (проверено замером на 390 px: верх панели поездки оказывался выше области просмотра).
 */
export interface ScrollableList {
  scrollTop: number;
  getBoundingClientRect(): { top: number; bottom: number };
}

export interface MeasurableRow {
  getBoundingClientRect(): { top: number; bottom: number };
}

export function scrollRowIntoList(list: ScrollableList | null, row: MeasurableRow | null): void {
  if (list === null || row === null) {
    return;
  }
  const listBox = list.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  if (rowBox.top < listBox.top) {
    list.scrollTop -= listBox.top - rowBox.top;
    return;
  }
  if (rowBox.bottom > listBox.bottom) {
    list.scrollTop += rowBox.bottom - listBox.bottom;
  }
}

