import { ADMIN_EMAIL, type Account, type AccountStatus } from '../types';
import { normalizeEmail } from './password';

export interface SignedInPerson {
  email: string;
  name: string;
}

export function roleForEmail(email: string): Account['role'] {
  return normalizeEmail(email) === ADMIN_EMAIL ? 'admin' : 'member';
}

export function statusForSignIn(email: string, existing: AccountStatus | undefined): AccountStatus {
  if (roleForEmail(email) === 'admin') return 'approved';
  return existing ?? 'pending';
}

export function nextAccount(person: SignedInPerson, existing: Account | null, now: string): Account {
  const email = normalizeEmail(person.email);
  const role = roleForEmail(email);
  return {
    email,
    displayName: person.name.trim() || existing?.displayName || email,
    role,
    status: statusForSignIn(email, existing?.status),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

/** A saved "approved" record on this device is not approval. Only the shared list, or a status it already confirmed, counts. */
export function accountWhenDirectoryUnavailable(
  person: SignedInPerson,
  existing: Account | null,
  confirmed: AccountStatus | null,
  now: string,
): Account {
  const email = normalizeEmail(person.email);
  if (roleForEmail(email) === 'admin') return nextAccount(person, existing, now);
  const status = confirmed ?? 'pending';
  return {
    email,
    displayName: person.name.trim() || existing?.displayName || email,
    role: 'member',
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function applyStatusChange(
  actorEmail: string,
  target: Account,
  status: 'approved' | 'denied',
  now: string,
): Account {
  if (roleForEmail(actorEmail) !== 'admin') {
    throw new Error('You can’t manage people.');
  }
  if (roleForEmail(target.email) === 'admin') {
    throw new Error('The admin account stays allowed.');
  }
  switch (status) {
    case 'approved':
    case 'denied':
      return { ...target, role: 'member', status, updatedAt: now };
    default: {
      const exhaustive: never = status;
      throw new Error(`Unknown decision: ${String(exhaustive)}`);
    }
  }
}
