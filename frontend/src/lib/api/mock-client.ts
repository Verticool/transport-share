import { ScooterSchema, ServiceZoneSchema, toIso, type ServiceZone } from '@sharing/shared';
import { z } from 'zod';

import { ApiClientError, type ApiClient, type ParkSnapshot } from './types';

export interface MockApiClientOptions {
  /** Префикс пути к статике мок-данных; по умолчанию — относительный корень. */
  baseUrl?: string;
  /** Нижняя граница имитируемой задержки сети, мс. */
  minDelayMs?: number;
  /** Верхняя граница имитируемой задержки сети, мс. */
  maxDelayMs?: number;
}

/**
 * Клиент мок-данных: забирает JSON статикой по HTTP и проверяет его zod-схемами.
 *
 * Почему HTTP, а не чтение файлов: этот клиент работает в браузере. Файлы `mock/*.json`
 * подключены к Vite как `publicDir`, поэтому доступны по обычным относительным путям —
 * тот же код переживёт замену на настоящий сервер (S11), поменяется только `baseUrl`.
 */
export class MockApiClient implements ApiClient {
  private readonly baseUrl: string;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(options: MockApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.minDelayMs = options.minDelayMs ?? 120;
    this.maxDelayMs = options.maxDelayMs ?? 300;
  }

  /** Имитация сети: интерфейс должен проверяться вместе с состояниями загрузки, а не мгновенно. */
  private async applyDelay(): Promise<void> {
    const delay =
      this.minDelayMs === this.maxDelayMs
        ? this.minDelayMs
        : Math.floor(Math.random() * (this.maxDelayMs - this.minDelayMs + 1)) + this.minDelayMs;
    await new Promise((done) => setTimeout(done, delay));
  }

  /** Забирает JSON по относительному пути и приводит сбои к единому виду. */
  private async fetchJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`);
    } catch {
      throw new ApiClientError('network', 'Не удалось связаться с источником данных');
    }

    if (!response.ok) {
      throw new ApiClientError('network', 'Данные недоступны: источник ответил ошибкой');
    }

    try {
      const raw: unknown = await response.json();
      return raw;
    } catch {
      throw new ApiClientError('invalid_payload', 'Ответ источника не удалось прочитать');
    }
  }

  async getZone(): Promise<ServiceZone> {
    await this.applyDelay();
    const raw = await this.fetchJson('/service-zone.json');
    const parsed = ServiceZoneSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные зоны обслуживания не прошли проверку');
    }
    return parsed.data;
  }

  async getPark(): Promise<ParkSnapshot> {
    await this.applyDelay();
    const raw = await this.fetchJson('/scooters.json');
    const parsed = z.array(ScooterSchema).safeParse(raw);
    if (!parsed.success) {
      throw new ApiClientError('invalid_payload', 'Данные парка не прошли проверку');
    }

    // Порядок фиксирован: список в интерфейсе не должен «прыгать» между запросами.
    const scooters = [...parsed.data].sort((left, right) =>
      left.code.localeCompare(right.code, 'en'),
    );

    return { scooters, serverTime: toIso(Date.now()) };
  }
}
