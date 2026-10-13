export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code ?? (statusCode === 401 ? 'unauthorized' : statusCode === 404 ? 'not_found' : 'invalid_request');
  }
}
