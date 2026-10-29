import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { clientSafeError } from "./lib/server-fn-errors";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Server functions that throw (a failed input check, a database error in a read) would otherwise reach the browser as
 * the whole serialized Error, with its stack and every own property (SEC-9). The browser gets only the message of a
 * refusal meant for people (UserError) or one generic sentence; the full error is logged here. Redirects and not-found
 * results are not Errors and pass through unchanged.
 */
const serverFunctionErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof Error && error.name !== "UserError") console.error("Server function failed", error);
    throw clientSafeError(error);
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [serverFunctionErrors],
}));
