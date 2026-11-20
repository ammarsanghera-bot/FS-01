export type FieldError = { path?: string; message: string };

export class AppError extends Error {
  status: number;
  errors: FieldError[];
  code?: string;

  constructor(message: string, status = 400, errors: FieldError[] = [], code?: string) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

export class QuoteError extends AppError {
  constructor(message: string, status = 400) {
    super(message, status);
  }
}
