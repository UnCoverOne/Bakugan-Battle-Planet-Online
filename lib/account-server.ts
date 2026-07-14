const SESSION_COOKIE = "bbp_session";
const SESSION_DAYS = 30;
const PASSWORD_ITERATIONS = 75_000;
const encoder = new TextEncoder();

export type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  faction: string;
  createdAt: number;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  display_name: string;
  faction: string;
  created_at: number;
};

export async function getDatabase() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("The account database is unavailable.");
  return env.DB;
}

export async function ensureAccountSchema() {
  const db = await getDatabase();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL, display_name TEXT NOT NULL, faction TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS user_data (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
  ]);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateAccountInput(email: string, password: string, displayName?: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error("Enter a valid email address.");
  if (password.length < 10 || password.length > 128) throw new Error("Password must be between 10 and 128 characters.");
  if (displayName != null && (!displayName.trim() || displayName.trim().length > 20)) throw new Error("Brawler name must be between 1 and 20 characters.");
  return normalized;
}

export async function createPasswordRecord(password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return { salt: toBase64Url(salt), hash: await derivePassword(password, salt, PASSWORD_ITERATIONS), iterations: PASSWORD_ITERATIONS };
}

export async function verifyPassword(password: string, row: Pick<UserRow, "password_hash" | "password_salt" | "password_iterations">) {
  const derived = await derivePassword(password, fromBase64Url(row.password_salt), row.password_iterations);
  return constantTimeEqual(derived, row.password_hash);
}

function parseCookie(header: string | null, key: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === key) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export async function createSession(request: Request, userId: string) {
  const db = await getDatabase();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(tokenHash, userId, now, expiresAt).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}${secure}`;
}

export async function revokeSession(request: Request) {
  const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return;
  const db = await getDatabase();
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function getSessionUser(request: Request): Promise<AccountUser | null> {
  await ensureAccountSchema();
  const token = parseCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const db = await getDatabase();
  const now = Date.now();
  const row = await db.prepare("SELECT users.id, users.email, users.display_name, users.faction, users.created_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?")
    .bind(await sha256(token), now).first<{ id: string; email: string; display_name: string; faction: string; created_at: number }>();
  if (!row) return null;
  return { id: row.id, email: row.email, displayName: row.display_name, faction: row.faction, createdAt: row.created_at };
}

export async function getUserByEmail(email: string) {
  const db = await getDatabase();
  return db.prepare("SELECT id, email, password_hash, password_salt, password_iterations, display_name, faction, created_at FROM users WHERE email = ? COLLATE NOCASE")
    .bind(normalizeEmail(email)).first<UserRow>();
}

export function publicUser(row: Pick<UserRow, "id" | "email" | "display_name" | "faction" | "created_at">): AccountUser {
  return { id: row.id, email: row.email, displayName: row.display_name, faction: row.faction, createdAt: row.created_at };
}
