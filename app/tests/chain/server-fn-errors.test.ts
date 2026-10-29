import { describe, expect, test } from "bun:test";
import { clientSafeError, GENERIC_SERVER_ERROR } from "../../src/lib/server-fn-errors";

// What a throwing server function sends the browser (SEC-9): the middleware in src/start.ts throws clientSafeError's
// answer. No network, no Worker. UserError (db.server) is matched by its name, as the middleware does.
class UserError extends Error { constructor(message: string) { super(message); this.name = "UserError"; } }
describe("server function errors reach the browser without internals (SEC-9)", () => {
  test("a plain Error becomes one generic sentence with no stack or own properties", () => {
    const thrown = Object.assign(new Error("D1_ERROR: no such column: secret_column at /bundle/worker.js:12"), { cause: "provider-key-123", query: "SELECT *" });
    const safe = clientSafeError(thrown) as Error;
    expect(safe).toBeInstanceOf(Error); expect(safe).not.toBe(thrown);
    expect(safe.message).toBe(GENERIC_SERVER_ERROR);
    expect(safe.stack ?? "").toBe("");
    expect(JSON.stringify(Object.getOwnPropertyNames(safe).map(name => (safe as unknown as Record<string, unknown>)[name]))).not.toMatch(/D1_ERROR|provider-key|bundle|SELECT/);
  });
  test("a refusal meant for people keeps its message, and nothing else", () => {
    const safe = clientSafeError(new UserError("Choose a supported pump.fun quote asset.")) as Error;
    expect(safe.message).toBe("Choose a supported pump.fun quote asset.");
    expect(safe.stack ?? "").toBe("");
  });
  test("a redirect or not-found result (not an Error) passes through unchanged", () => {
    const redirect = { isRedirect: true, to: "/launch", statusCode: 307 }, notFound = { isNotFound: true };
    expect(clientSafeError(redirect)).toBe(redirect);
    expect(clientSafeError(notFound)).toBe(notFound);
    expect(clientSafeError(undefined)).toBeUndefined();
  });
});
