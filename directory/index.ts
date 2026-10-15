import { handleDirectoryRequest, type AccountStore } from '../src/auth/directoryHandler';
import { GOOGLE_CLIENT_ID } from '../src/auth/googleClient';
import { verifyRs256Jwt, type RsaJwk } from '../src/auth/googleClaims';
import type { SignedInPerson } from '../src/auth/accessPolicy';
import type { Account } from '../src/types';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

interface KvListResult {
  keys: Array<{ name: string }>;
  list_complete: boolean;
  cursor?: string;
}

interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options?: { cursor?: string }): Promise<KvListResult>;
}

interface Env {
  ACCOUNTS: KvNamespace;
}

let cachedKeys: { at: number; keys: RsaJwk[] } | null = null;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleDirectoryRequest(request, kvStore(env.ACCOUNTS), verifyToken);
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

function kvStore(kv: KvNamespace): AccountStore {
  return {
    async get(email) {
      const raw = await kv.get(email);
      return raw ? (JSON.parse(raw) as Account) : null;
    },
    async put(account) {
      await kv.put(account.email, JSON.stringify(account));
    },
    async list() {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await kv.list(cursor ? { cursor } : {});
        keys.push(...page.keys.map((key) => key.name));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      const rows = await Promise.all(keys.map((key) => kv.get(key)));
      return rows.filter((row): row is string => Boolean(row)).map((row) => JSON.parse(row) as Account);
    },
  };
}
