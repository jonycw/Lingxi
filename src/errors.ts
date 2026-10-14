export type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 504;

export class ApiError extends Error {
  readonly status: ErrorStatus;
  readonly type: string;
  readonly code: string;
  readonly headers: Record<string, string>;
  readonly logDetail?: string;

  constructor(
    status: ErrorStatus,
    message: string,
    type: string,
    code: string,
    headers: Record<string, string> = {},
    logDetail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.code = code;
    this.headers = headers;
    this.logDetail = logDetail;
  }
}

export function errorBody(error: ApiError): { error: { message: string; type: string; code: string } } {
  return {
    error: {
      message: error.message,
      type: error.type,
      code: error.code,
    },
  };
}
