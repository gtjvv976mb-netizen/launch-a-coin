import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { HANDLE_RE, START_BALANCE, isReservedHandle } from "../constants";
import { UserError, USER_COLUMNS, bumpRev, bumpRevIfChanged, newId, q, readBatch, stmt, db, type Query, type UserRow } from "./db.server";

export const SESSION_COOKIE = "carddex_session";
const YEAR = 60 * 60 * 24 * 365;

export type SessionUser = UserRow;

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TOKEN_RE = /^[a-f0-9]{64}$/;

/** Hash of a session token, or null when there is no well-formed token (no database call either way). */
export async function tokenHash(token: string | undefined | null): Promise<string | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  return sha256(token);
}

/** Hash of the current request's session cookie (server functions only). */
export async function sessionTokenHash(): Promise<string | null> {
  return tokenHash(getCookie(SESSION_COOKIE));
}

/**
 * The player behind a session hash, as a query that can ride along in a read batch (P1-3), so pages that
 * depend on the viewer still take one round trip. A null hash matches nothing.
 */
export function viewerQuery(hash: string | null): Query<SessionUser> {
  const cols = USER_COLUMNS.split(", ")
    .map((c) => `u.${c}`)
    .join(", ");
  return q<SessionUser>(
    `SELECT ${cols} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    hash,
  );
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  const hash = await tokenHash(token);
  if (!hash) return null;
  const [rows] = await readBatch(viewerQuery(hash));
  return rows[0] ?? null;
}

/** Current player from the session cookie (server functions only). */
export async function currentUser(): Promise<SessionUser | null> {
  return userFromToken(getCookie(SESSION_COOKIE));
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new UserError("Enter Launch a Card first to do that.");
  return u;
}

/** Read the session from a raw request (server routes). */
export async function userFromRequest(request: Request): Promise<SessionUser | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return userFromToken(match?.[1]);
}

export async function enterWithHandle(rawHandle: string): Promise<SessionUser> {
  const handle = rawHandle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    throw new UserError("Handles are 3 to 16 characters: letters, numbers or underscores.");
  }
  // Official, partner and demo bot handles (backlog P0-6), so nobody can pose as the team or a bot.
  if (isReservedHandle(handle)) throw new UserError("That handle is reserved. Try another one.");
  const id = newId(12);
  const token = randomToken();
  const now = Date.now();
  try {
    // The UNIQUE handle (NOCASE) decides who gets a handle; no separate lookup round trip first.
    await db().batch([
      stmt(
        "INSERT INTO users (id, handle, balance, is_npc, faucet_at, created_at) VALUES (?, ?, ?, 0, 0, ?)",
        id,
        handle,
        START_BALANCE,
        now,
      ),
      stmt(
        "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)",
        await sha256(token),
        id,
        now,
      ),
      // The player count on Home changed.
      bumpRev(),
    ]);
  } catch (e) {
    if (/constraint|unique/i.test(e instanceof Error ? e.message : String(e))) {
      throw new UserError("That handle is taken. Try another one.");
    }
    throw e;
  }
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: YEAR,
  });
  return { id, handle, balance: START_BALANCE, faucet_at: 0, created_at: now };
}

export async function signOutCurrent() {
  const hash = await sessionTokenHash();
  // Bump the data revision too: polled pages carry the viewer (holding, open bid, owner controls), and revPoll
  // keeps its cached copy while the revision stands still, so without the bump the account that just left
  // would stay on screen until the minute rolled over. Only when a session row actually went.
  if (hash) await db().batch([stmt("DELETE FROM sessions WHERE token_hash = ?", hash), bumpRevIfChanged()]);
  deleteCookie(SESSION_COOKIE, { path: "/" });
}
