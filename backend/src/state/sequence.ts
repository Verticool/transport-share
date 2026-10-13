/**
 * Монотонный счётчик сообщений.
 *
 * Единый источник `seq` для REST и WebSocket: клиент сравнивает номер с последним применённым и
 * отбрасывает устаревшие сообщения — так гонки при реконнекте не откатывают состояние назад.
 */
export class Sequence {
  private value: number;

  constructor(start = 0) {
    this.value = start;
  }

  next(): number {
    this.value += 1;
    return this.value;
  }

  get current(): number {
    return this.value;
  }
}
