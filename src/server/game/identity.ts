import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Anonymous player identity: an httpOnly, SameSite=Lax cookie `<playerId>.<hmac>`. The HMAC
 * (GAME_COOKIE_SECRET, else BETTER_AUTH_SECRET) means a guessed or forged value is ignored and
 * a fresh identity is issued instead. A session id alone never grants access: every game query
 * filters by the playerKey derived here.
 */
export const PLAYER_COOKIE = "scamper_player";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const value = process.env.GAME_COOKIE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("GAME_COOKIE_SECRET or BETTER_AUTH_SECRET (32+ chars) is required");
  return value;
}

const mac = (id: string) => createHmac("sha256", secret()).update(`scamper-player:${id}`).digest("base64url");

export function signPlayerId(id: string): string {
  return `${id}.${mac(id)}`;
}

export function verifyPlayerCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(mac(id));
  const given = Buffer.from(value.slice(dot + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function resolvePlayer(request: Request): { playerKey: string; setCookie: string | null } {
  const existing = verifyPlayerCookie(readCookie(request, PLAYER_COOKIE));
  if (existing) return { playerKey: `anon:${existing}`, setCookie: null };
  const id = randomUUID();
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const cookie = [`${PLAYER_COOKIE}=${signPlayerId(id)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_SECONDS}`, ...(secure ? ["Secure"] : [])].join("; ");
  return { playerKey: `anon:${id}`, setCookie: cookie };
}

/** Same-origin check for mutations (defense in depth on top of SameSite=Lax). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients; the cookie is still required for access
  try {
    const originHost = new URL(origin).host;
    const hosts = new Set([new URL(request.url).host, request.headers.get("x-forwarded-host"), request.headers.get("host")].filter(Boolean));
    return hosts.has(originHost);
  } catch {
    return false;
  }
}
