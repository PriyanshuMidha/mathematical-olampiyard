// Express 4 does not forward rejected promises to the error handler; wrap async route handlers with this.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
