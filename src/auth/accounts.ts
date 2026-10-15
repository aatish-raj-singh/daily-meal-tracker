import {
  clearAuthSession,
  getAccount,
  getAuthSession,
  putAccount,
  saveAuthSession,
} from '../db/database';
import { ADMIN_EMAIL, type Account } from '../types';
import { nowIso } from '../util/hash';
import { roleForEmail } from './accessPolicy';
import { listDirectoryAccounts, setDirectoryStatus, syncSession } from './directory';
import { GOOGLE_CLIENT_ID } from './googleClient';
import { verifyGoogleIdToken } from './googleToken';
import { normalizeEmail } from './password';

export { roleForEmail, statusForSignIn } from './accessPolicy';

let verifiedCache: { token: string; account: Account } | null = null;

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
  if (verifiedCache?.token === session.idToken) return verifiedCache.account;

  try {
    const identity = await verifyGoogleIdToken(session.idToken, GOOGLE_CLIENT_ID);
    if (identity.email !== normalizeEmail(session.email)) {
      throw new Error('Signed-in email does not match the Google token.');
    }
    const account = await syncStoredAccount(session.idToken, identity.email, identity.name);
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
  const account = await syncStoredAccount(idToken, identity.email, identity.name);
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

export async function refreshSessionAccount(): Promise<Account | null> {
  verifiedCache = null;
  return getSessionAccount();
}

export async function setAccountStatus(
  email: string,
  status: 'approved' | 'denied',
): Promise<void> {
  await requireAdmin();
  const normalized = normalizeEmail(email);
  if (roleForEmail(normalized) === 'admin') {
    throw new Error('The admin account stays allowed.');
  }
  const session = await getAuthSession();
  if (!session?.idToken) throw new Error('You can’t manage people.');
  const updated = await setDirectoryStatus(session.idToken, normalized, status);
  await putAccount(updated);
}

export async function listAccountsForAdmin(): Promise<Account[]> {
  const session = await requireAdmin();
  const accounts = await listDirectoryAccounts(session.idToken ?? '');
  for (const account of accounts) await putAccount({ ...account, role: roleForEmail(account.email) });
  return accounts
    .map((account) => ({ ...account, role: roleForEmail(account.email) }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function syncStoredAccount(idToken: string, email: string, name: string): Promise<Account> {
  const existing = await getAccount(normalizeEmail(email));
  const account = await syncSession(idToken, { email, name }, existing ?? null);
  const stored = { ...account, role: roleForEmail(account.email) };
  await putAccount(stored);
  return stored;
}

async function requireAdmin(): Promise<Account & { idToken: string }> {
  const account = await getSessionAccount();
  const session = await getAuthSession();
  if (!account || account.role !== 'admin' || account.email !== ADMIN_EMAIL || !session?.idToken) {
    throw new Error('You can’t manage people.');
  }
  return { ...account, idToken: session.idToken };
}

export function canViewEntry(ownerEmail: string | undefined, account: Account | null): boolean {
  if (!account || account.status !== 'approved') return false;
  if (account.role === 'admin' && account.email === ADMIN_EMAIL) return true;
  return ownerEmail === account.email;
}
