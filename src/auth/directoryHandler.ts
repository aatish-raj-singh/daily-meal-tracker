import type { Account, AccountStatus } from '../types';
import { nowIso } from '../util/hash';
import { applyStatusChange, nextAccount, roleForEmail, type SignedInPerson } from './accessPolicy';
import { normalizeEmail } from './password';

export interface AccountStore {
  get(email: string): Promise<Account | null>;
  put(account: Account): Promise<void>;
  list(): Promise<Account[]>;
}

const ALLOWED_ORIGINS = new Set([
  'https://aatish-raj-singh.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

type Route = 'session' | 'list' | 'status' | 'unknown';

export async function handleDirectoryRequest(
  request: Request,
  store: AccountStore,
  verify: (token: string) => Promise<SignedInPerson>,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), origin);
  try {
    const person = await verify(bearerToken(request));
    const url = new URL(request.url);
    const route = routeOf(request.method, url.pathname);
    switch (route) {
      case 'session':
        return withCors(json(await saveSession(store, person)), origin);
      case 'list': {
        if (roleForEmail(person.email) !== 'admin') throw new Error('You can’t manage people.');
        const accounts = (await store.list()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return withCors(json(accounts), origin);
      }
      case 'status':
        return withCors(json(await saveStatus(store, person.email, request)), origin);
      case 'unknown':
        return withCors(json({ error: 'Not found.' }, 404), origin);
      default: {
        const exhaustive: never = route;
        return exhaustive;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Approval list unavailable.';
    return withCors(json({ error: message }, 400), origin);
  }
}

async function saveSession(store: AccountStore, person: SignedInPerson): Promise<Account> {
  const existing = await store.get(normalizeEmail(person.email));
  if (existing) return { ...existing, role: roleForEmail(existing.email) };
  const created = nextAccount(person, null, nowIso());
  await store.put(created);
  return created;
}

async function saveStatus(store: AccountStore, actorEmail: string, request: Request): Promise<Account> {
  const body = (await request.json()) as { email?: string; status?: string };
  const email = normalizeEmail(body.email ?? '');
  const existing = await store.get(email);
  if (!existing) throw new Error('That person has not signed in.');
  const updated = applyStatusChange(actorEmail, existing, parseStatus(body.status), nowIso());
  await store.put(updated);
  return updated;
}

function routeOf(method: string, pathname: string): Route {
  if ((method === 'GET' || method === 'POST') && pathname === '/v1/session') return 'session';
  if (method === 'GET' && pathname === '/v1/accounts') return 'list';
  if (method === 'POST' && pathname === '/v1/accounts/status') return 'status';
  return 'unknown';
}

function parseStatus(value: string | undefined): 'approved' | 'denied' {
  switch (value) {
    case 'approved':
    case 'denied':
      return value;
    default:
      throw new Error('Choose allow or revoke.');
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw new Error('Sign in again.');
  return match[1];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

export function confirmedStatus(value: string | null): AccountStatus | null {
  switch (value) {
    case 'approved':
    case 'pending':
    case 'denied':
      return value;
    default:
      return null;
  }
}
