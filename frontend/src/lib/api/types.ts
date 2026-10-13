import type { Iso, Scooter, ServiceZone } from '@sharing/shared';

/** Снимок парка: список самокатов + серверное время (RULES §D: время считаем от сервера). */
export interface ParkSnapshot {
  scooters: Scooter[];
  /** ISO-8601 UTC; на моках — время клиента, на реальном API — `server_time` из ответа. */
  serverTime: Iso;
}

export interface ApiClient {
  /** Зона обслуживания (полигон). */
  getZone(): Promise<ServiceZone>;
  /** Парк: все самокаты со статусами и зарядом. */
  getPark(): Promise<ParkSnapshot>;
}

/** Ошибка уровня клиента: единый формат для моков и будущего http-клиента. */
export class ApiClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
