/**
 * What a server function that threw may send to the browser (SEC-9): TanStack Start would otherwise serialize the
 * whole Error, with its stack and every own property. A refusal meant for people (UserError) keeps only its message;
 * any other Error becomes one generic sentence. Anything that is not an Error (a redirect, a not-found result) passes
 * through unchanged. The caller logs the original.
 */
export const GENERIC_SERVER_ERROR = "The request could not be completed. Try again.";
export function clientSafeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const safe = new Error(error.name === "UserError" ? error.message : GENERIC_SERVER_ERROR);
  // No stack trace (bundle paths) for the client.
  try { delete (safe as { stack?: string }).stack; } catch { /* Not configurable here. */ }
  if (Object.prototype.hasOwnProperty.call(safe, "stack")) safe.stack = "";
  return safe;
}
