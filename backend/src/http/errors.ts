import type { ApiError } from '@sharing/shared';

/**
 * Ошибка, которую обработчик может бросить, чтобы ответить клиенту по контракту.
 *
 * Коды совпадают с теми, что знает фронт (`ApiErrorCode`), а HTTP-статус выводится из кода:
 * так интерфейс не разбирает текст ошибки, чтобы понять, что произошло.
 */
export type ApiErrorCode =
  | 'invalid_payload'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'outside_zone'
  | 'internal';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_payload: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  outside_zone: 422,
  internal: 500,
};

export class ApiProblem extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiProblem';
    this.code = code;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  /** Представление для тела ответа — то же, что описано в контракте `ApiErrorSchema`. */
  toApiError(): ApiError {
    return { code: this.code, message: this.message };
  }
}

export const unauthorized = (message = 'Нужно войти в аккаунт'): ApiProblem =>
  new ApiProblem('unauthorized', message);
export const notFound = (message = 'Не найдено'): ApiProblem => new ApiProblem('not_found', message);
export const conflict = (message: string): ApiProblem => new ApiProblem('conflict', message);
export const invalidPayload = (message: string): ApiProblem => new ApiProblem('invalid_payload', message);
/** Запрос понятен по форме, но бессмысленный: например, неизвестная сторона движения. */
export const badRequest = (message: string): ApiProblem => new ApiProblem('invalid_payload', message);
export const outsideZone = (message: string): ApiProblem => new ApiProblem('outside_zone', message);
