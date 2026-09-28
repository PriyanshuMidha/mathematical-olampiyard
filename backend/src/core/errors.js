export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new AppError(400, message);
export const notFound = (what = "Resource") => new AppError(404, `${what} not found`);
export const conflict = (message) => new AppError(409, message);
export const unauthorized = (message = "Unauthorized") => new AppError(401, message);
export const tooMany = (message = "Too many requests, please try again later") => new AppError(429, message);
