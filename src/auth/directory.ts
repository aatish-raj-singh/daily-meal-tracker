import type { Account, AccountStatus } from '../types';
import { nowIso } from '../util/hash';
import { accountWhenDirectoryUnavailable, type SignedInPerson } from './accessPolicy';
import { confirmedStatus } from './directoryHandler';
import { normalizeEmail } from './password';

/** Public approval service. It is not a secret; the browser calls it directly. */
const CONFIGURED_DIRECTORY_URL = 'https://daily-meal-tracker-directory.daily-meal-tracker.workers.dev';

const STATUS_KEY = 'dmt-directory-status';

export function directoryUrl(): string {
  const fromEnv = (import.meta.env?.VITE_DIRECTORY_URL ?? '').trim();
  return fromEnv || CONFIGURED_DIRECTORY_URL;
}

export async function syncSession(
  idToken: string,
  person: SignedInPerson,
  existing: Account | null,
): Promise<Account> {
  const url = directoryUrl();
  if (!url) return unavailable(person, existing);
  try {
    const account = await request<Account>(`${url}/v1/session`, idToken, { method: 'POST' });
    remember(account);
    return account;
  } catch {
    return unavailable(person, existing);
  }
}

export async function listDirectoryAccounts(idToken: string): Promise<Account[]> {
  const url = directoryUrl();
  if (!url) throw new Error("Couldn't load people.");
  return request<Account[]>(`${url}/v1/accounts`, idToken, { method: 'GET' });
}

export async function setDirectoryStatus(
  idToken: string,
  email: string,
  status: 'approved' | 'denied',
): Promise<Account> {
  const url = directoryUrl();
  if (!url) throw new Error("Couldn't update access.");
  const account = await request<Account>(`${url}/v1/accounts/status`, idToken, {
    method: 'POST',
    body: JSON.stringify({ email, status }),
  });
  remember(account);
  return account;
}

function unavailable(person: SignedInPerson, existing: Account | null): Account {
  return accountWhenDirectoryUnavailable(person, existing, readConfirmed(person.email), nowIso());
}

async function request<T>(url: string, idToken: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new Error("Couldn't reach the approval list.");
  }
  const body = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? body.error : '';
    throw new Error(message || "Couldn't reach the approval list.");
  }
  return body as T;
}

function remember(account: Account): void {
  if (typeof sessionStorage === 'undefined') return;
  const all = readMap();
  all[account.email] = account.status;
  sessionStorage.setItem(STATUS_KEY, JSON.stringify(all));
}

function readConfirmed(email: string): AccountStatus | null {
  return confirmedStatus(readMap()[normalizeEmail(email)] ?? null);
}

function readMap(): Record<string, string> {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STATUS_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}
