import {
  clearAuthSession,
  getAccount,
  getAllAccounts,
  getAuthSession,
  putAccount,
  saveAuthSession,
} from '../db/database';
import { ADMIN_EMAIL, type Account, type UserRole } from '../types';
import { nowIso } from '../util/hash';
import { GOOGLE_CLIENT_ID } from './googleClient';
import { verifyGoogleIdToken } from './googleToken';
import { normalizeEmail } from './password';

let verifiedCache: { token: string; account: Account } | null = null;

export function roleForEmail(email: string): UserRole {
  return normalizeEmail(email) === ADMIN_EMAIL ? 'admin' : 'member';
}

export async function getSessionAccount(): Promise<Account | null> {
  const session = await getAuthSession();
  if (!session?.idToken || !session.expiresAt) {
    if (session) await clearAuthSession();
    verifiedCache = null;
    return null;
  }
  if (session.expiresAt * 1000 <= Date.now()) {
    await clearAuthSession();
    verifiedCache = null;
    return null;
  }
  if (verifiedCache?.token === session.idToken) {
    return verifiedCache.account;
  }

  try {
    const identity = await verifyGoogleIdToken(session.idToken, GOOGLE_CLIENT_ID);
    if (identity.email !== normalizeEmail(session.email)) {
      throw new Error('Signed-in email does not match the Google token.');
    }
    const account = await upsertFromGoogle(identity.email, identity.name);
    verifiedCache = { token: session.idToken, account };
    return account;
  } catch {
    await clearAuthSession();
    verifiedCache = null;
    return null;
  }
}

export async function signInWithGoogleIdToken(idToken: string): Promise<Account> {
  const identity = await verifyGoogleIdToken(idToken, GOOGLE_CLIENT_ID);
  const account = await upsertFromGoogle(identity.email, identity.name);
  await saveAuthSession({
    id: 'current',
    email: account.email,
    createdAt: nowIso(),
    idToken,
    expiresAt: identity.expiresAt,
  });
  verifiedCache = { token: idToken, account };
  return account;
}

export async function logout(): Promise<void> {
  verifiedCache = null;
  await clearAuthSession();
}

export async function listAccountsForAdmin(): Promise<Account[]> {
  await requireAdmin();
  const accounts = await getAllAccounts();
  return accounts
    .map((account) => ({ ...account, role: roleForEmail(account.email) }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function upsertFromGoogle(email: string, displayName: string): Promise<Account> {
  const normalized = normalizeEmail(email);
  const existing = await getAccount(normalized);
  const account: Account = {
    email: normalized,
    displayName: displayName.trim() || existing?.displayName || normalized,
    role: roleForEmail(normalized),
    status: 'approved',
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await putAccount(account);
  return account;
}

async function requireAdmin(): Promise<Account> {
  const account = await getSessionAccount();
  if (!account || account.role !== 'admin' || account.email !== ADMIN_EMAIL) {
    throw new Error('Only the verified admin Google account can manage access.');
  }
  return account;
}

export function canViewEntry(ownerEmail: string | undefined, account: Account | null): boolean {
  if (!account || account.status !== 'approved') return false;
  if (account.role === 'admin' && account.email === ADMIN_EMAIL) return true;
  return ownerEmail === account.email;
}
