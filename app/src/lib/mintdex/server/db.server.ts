import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

import { bindings } from "../../bindings.server";

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function db(): D1Database {
  const { DB } = bindings();
  if (!DB) throw new Error("Database binding missing");
  return DB;
}

export async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db().prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db().prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export function stmt(sql: string, ...params: unknown[]): D1PreparedStatement {
  return db().prepare(sql).bind(...params);
}

// ---------------------------------------------------------------- batched reads (backlog P1-3)

/** A read statement that remembers its row type. Build several, then run them in one round trip with readBatch. */
export type Query<T> = { readonly s: D1PreparedStatement; readonly __row?: (row: T) => void };

export function q<T>(sql: string, ...params: unknown[]): Query<T> {
  return { s: stmt(sql, ...params) };
}

type RowsOf<Q extends readonly Query<never>[]> = { [K in keyof Q]: Q[K] extends Query<infer R> ? R[] : never };

/**
 * Run every query in ONE D1 round trip (a batch is a single request, executed in order inside one
 * transaction, so all results come from the same snapshot). Returns one row array per query, in order.
 */
export async function readBatch<const Q extends readonly Query<never>[]>(...queries: Q): Promise<RowsOf<Q>> {
  const res = await db().batch(queries.map((x) => x.s));
  return res.map((r) => r.results ?? []) as unknown as RowsOf<Q>;
}

// ---------------------------------------------------------------- data revision (backlog P0-12)

/**
 * Every write bumps one counter in `meta` (key 'rev') in the same batch as the write. Pollers compare revisions
 * and skip the heavy read when nothing changed. RETURNING hands the new value back with the batch.
 */
export function bumpRev(): D1PreparedStatement {
  return stmt(
    `INSERT INTO meta (key, value) VALUES ('rev', '1')
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
     RETURNING value`,
  );
}

/**
 * bumpRev, but only when the statement right before it in the batch changed a row (SQLite's changes() reads the
 * previous statement on the same connection, and a batch runs in order on one). A rejected write (a faucet claim
 * that is not due, a lore edit by a non-owner) then leaves the revision alone. Returns no row when it skips.
 */
export function bumpRevIfChanged(): D1PreparedStatement {
  return stmt(
    `INSERT INTO meta (key, value) SELECT 'rev', '1' WHERE changes() > 0
     ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
     RETURNING value`,
  );
}

export function revQuery(): Query<{ value: string }> {
  return q<{ value: string }>("SELECT value FROM meta WHERE key = 'rev'");
}

/** Revisions also roll every minute, so time-based figures (24h change, 24h volume) never go stale for long. */
export const REV_BUCKET_MS = 60_000;

/** The public revision string: write counter plus the current minute. Equal strings mean nothing changed. */
export function revString(counter: string | number | null | undefined, now = Date.now()): string {
  return `${Number(counter) || 0}.${Math.floor(now / REV_BUCKET_MS)}`;
}

// ---------------------------------------------------------------- writes

/** Statement that aborts the surrounding batch unless `conditionSql` (with params) is true. */
export function guard(conditionSql: string, ...params: unknown[]): D1PreparedStatement {
  return stmt(`INSERT INTO tx_guard (ok) SELECT CASE WHEN (${conditionSql}) THEN 1 ELSE 0 END`, ...params);
}

export function clearGuard(): D1PreparedStatement {
  return stmt("DELETE FROM tx_guard");
}

function isConstraintError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /constraint|CHECK/i.test(msg);
}

/** A player row, as the session lookup returns it. */
export type UserRow = { id: string; handle: string; balance: number; faucet_at: number; created_at: number };

export const USER_COLUMNS = "id, handle, balance, faucet_at, created_at";

export function userQuery(userId: string): Query<UserRow> {
  return q<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, userId);
}

/**
 * What a write hands back so the client can free its button at once (P0-12): the player's fresh row (balance)
 * and the new data revision, both read inside the same batch as the write, so no extra round trip.
 */
export type Settled = { me: UserRow | null; rev: number | null };

/**
 * Run an atomic batch built from fresh reads. If a guard or CHECK constraint
 * trips (state changed underneath us, insufficient balance), rebuild and retry.
 * Every batch also bumps the data revision; with `meId` it returns that player's row after the write.
 */
export async function atomic(
  build: () => Promise<D1PreparedStatement[]>,
  failMessage: string,
  attempts = 3,
  opts: { meId?: string } = {},
): Promise<Settled & { results: D1Result[] }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const statements = await build();
    const tail = [bumpRev()];
    if (opts.meId) tail.push(userQuery(opts.meId).s);
    try {
      const res = await db().batch([...statements, ...tail]);
      return { results: res.slice(0, statements.length), ...settledFrom(res, statements.length, !!opts.meId) };
    } catch (e) {
      lastErr = e;
      if (!isConstraintError(e)) throw e;
    }
  }
  console.error("atomic batch failed", lastErr);
  throw new UserError(failMessage);
}

/** Read the bumpRev result at `at` (and the user row right after it when `withMe`) out of a batch result. */
export function settledFrom(res: D1Result[], at: number, withMe: boolean): Settled {
  const revRow = res[at]?.results?.[0] as { value?: string } | undefined;
  const meRow = withMe ? (res[at + 1]?.results?.[0] as UserRow | undefined) : undefined;
  return { rev: revRow?.value != null ? Number(revRow.value) : null, me: meRow ?? null };
}

/** Split rows into multi-row INSERT statements under D1's 100-parameter cap. */
export function bulkInsert(table: string, columns: string[], rows: unknown[][]): D1PreparedStatement[] {
  if (!rows.length) return [];
  const per = Math.max(1, Math.floor(99 / columns.length));
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const chunk = rows.slice(i, i + per);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    out.push(stmt(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`, ...chunk.flat()));
  }
  return out;
}

export function newId(len = 10) {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
