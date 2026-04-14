export class AppError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly internalMessage?: string;

  constructor(status: number, publicMessage: string, internalMessage?: string) {
    super(internalMessage ?? publicMessage);
    this.name = "AppError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.internalMessage = internalMessage;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
