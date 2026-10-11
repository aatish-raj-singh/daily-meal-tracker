import {
  clearAuthSession,
  getAccount,
  getAllAccounts,
  getAuthSession,
  putAccount,
  saveAuthSession,
} from '../db/database';
import { ADMIN_EMAIL, type Account, type AccountStatus } from '../types';
import { nowIso } from '../util/hash';
import { hashPassword, isValidEmail, normalizeEmail, verifyPassword } from './password';

export async function getSessionAccount(): Promise<Account | null> {
  const session = await getAuthSession();
  if (!session) return null;
  const account = await getAccount(session.email);
  return account ?? null;
}

export async function adminExists(): Promise<boolean> {
  const admin = await getAccount(ADMIN_EMAIL);
  return Boolean(admin);
}

export async function registerAccount(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<Account> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
  if (displayName.length < 2) throw new Error('Enter your name.');
  if (input.password.length < 8) throw new Error('Password must be at least 8 characters.');

  const existing = await getAccount(email);
  if (existing) throw new Error('An account with this email already exists. Sign in instead.');

  const admin = await getAccount(ADMIN_EMAIL);
  if (!admin && email !== ADMIN_EMAIL) {
    throw new Error('The admin account must be created before anyone else can request access.');
  }

  const hashed = await hashPassword(input.password);
  const isAdmin = email === ADMIN_EMAIL;
  const account: Account = {
    email,
    displayName,
    role: isAdmin ? 'admin' : 'member',
    status: isAdmin ? 'approved' : 'pending',
    passwordSalt: hashed.passwordSalt,
    passwordHash: hashed.passwordHash,
    passwordIterations: hashed.passwordIterations,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await putAccount(account);
  if (isAdmin) {
    await saveAuthSession({ id: 'current', email, createdAt: nowIso() });
  }
  return account;
}

export async function login(emailInput: string, password: string): Promise<Account> {
  const email = normalizeEmail(emailInput);
  const account = await getAccount(email);
  if (!account) throw new Error('No account for that email.');
  const ok = await verifyPassword(
    password,
    account.passwordSalt,
    account.passwordHash,
    account.passwordIterations,
  );
  if (!ok) throw new Error('Incorrect password.');
  await saveAuthSession({ id: 'current', email, createdAt: nowIso() });
  return account;
}

export async function logout(): Promise<void> {
  await clearAuthSession();
}

export async function listAccountsForAdmin(): Promise<Account[]> {
  await requireAdmin();
  const accounts = await getAllAccounts();
  return accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function setAccountStatus(targetEmail: string, status: AccountStatus): Promise<Account> {
  await requireAdmin();
  const email = normalizeEmail(targetEmail);
  if (email === ADMIN_EMAIL && status !== 'approved') {
    throw new Error('The admin account cannot be denied or revoked.');
  }
  const account = await getAccount(email);
  if (!account) throw new Error('Account not found.');
  const updated: Account = { ...account, status, updatedAt: nowIso() };
  await putAccount(updated);
  return updated;
}

async function requireAdmin(): Promise<Account> {
  const account = await getSessionAccount();
  if (!account || account.role !== 'admin' || account.status !== 'approved') {
    throw new Error('Only the admin can manage access.');
  }
  if (account.email !== ADMIN_EMAIL) {
    throw new Error('Admin access is reserved for the designated admin email.');
  }
  return account;
}

export function canViewEntry(ownerEmail: string | undefined, account: Account | null): boolean {
  if (!account || account.status !== 'approved') return false;
  if (account.role === 'admin') return true;
  return ownerEmail === account.email;
}
