import { handleDirectoryRequest, type AccountStore } from '../src/auth/directoryHandler';
import { GOOGLE_CLIENT_ID } from '../src/auth/googleClient';
import { verifyRs256Jwt, type RsaJwk } from '../src/auth/googleClaims';
import type { SignedInPerson } from '../src/auth/accessPolicy';
import type { Account } from '../src/types';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Prepared;
}

interface Env {
  DB: D1Database;
}

interface AccountRow {
  email: string;
  display_name: string;
  role: Account['role'];
  status: Account['status'];
  created_at: string;
  updated_at: string;
}

let cachedKeys: { at: number; keys: RsaJwk[] } | null = null;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleDirectoryRequest(request, d1Store(env.DB), verifyToken);
  },
};

async function verifyToken(token: string): Promise<SignedInPerson> {
  try {
    return person(await verifyRs256Jwt(token, GOOGLE_CLIENT_ID, await googleKeys(false)));
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return person(await verifyRs256Jwt(token, GOOGLE_CLIENT_ID, await googleKeys(true)));
    }
    throw err;
  }
}

function person(identity: { email: string; name: string }): SignedInPerson {
  return { email: identity.email, name: identity.name };
}

async function googleKeys(force: boolean): Promise<RsaJwk[]> {
  if (!force && cachedKeys && Date.now() - cachedKeys.at < 60 * 60 * 1000) return cachedKeys.keys;
  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) throw new Error('Google signing keys could not be downloaded.');
  const body = (await response.json()) as { keys?: RsaJwk[] };
  const keys = body.keys ?? [];
  if (!keys.length) throw new Error('Google returned no signing keys.');
  cachedKeys = { at: Date.now(), keys };
  return keys;
}

function d1Store(db: D1Database): AccountStore {
  const select = `SELECT email, display_name, role, status, created_at, updated_at FROM accounts`;
  return {
    async get(email) {
      const row = await db.prepare(`${select} WHERE email = ?`).bind(email).first<AccountRow>();
      return row ? toAccount(row) : null;
    },
    async put(account) {
      await db
        .prepare(
          `INSERT INTO accounts (email, display_name, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             display_name = excluded.display_name,
             role = excluded.role,
             status = excluded.status,
             updated_at = excluded.updated_at`,
        )
        .bind(
          account.email,
          account.displayName,
          account.role,
          account.status,
          account.createdAt,
          account.updatedAt,
        )
        .run();
    },
    async list() {
      const result = await db.prepare(select).all<AccountRow>();
      return (result.results ?? []).map(toAccount);
    },
  };
}

function toAccount(row: AccountRow): Account {
  return {
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
