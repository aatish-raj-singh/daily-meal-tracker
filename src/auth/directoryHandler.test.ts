import { describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, type Account } from '../types';
import { accountWhenDirectoryUnavailable, type SignedInPerson } from './accessPolicy';
import { handleDirectoryRequest, type AccountStore } from './directoryHandler';

function memoryStore(): AccountStore {
  const rows = new Map<string, Account>();
  return {
    async get(email) {
      return rows.get(email) ?? null;
    },
    async put(account) {
      rows.set(account.email, account);
    },
    async list() {
      return [...rows.values()];
    },
  };
}

const verify = async (token: string): Promise<SignedInPerson> => {
  switch (token) {
    case 'admin':
      return { email: ADMIN_EMAIL, name: 'Aatish' };
    case 'friend':
      return { email: 'friend@example.com', name: 'Friend' };
    default:
      throw new Error('Sign in again.');
  }
};

function call(store: AccountStore, path: string, token: string, method = 'GET', body?: unknown): Promise<Response> {
  return handleDirectoryRequest(
    new Request(`https://directory.example${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    }),
    store,
    verify,
  );
}

describe('shared approval list', () => {
  it('holds a new person until the admin allows them, on any device', async () => {
    const store = memoryStore();
    const joined = await call(store, '/v1/session', 'friend', 'POST');
    expect((await joined.json()).status).toBe('pending');

    const hidden = await call(store, '/v1/accounts', 'friend');
    expect(hidden.status).toBe(400);

    const listed = await call(store, '/v1/accounts', 'admin');
    expect(await listed.json()).toEqual([
      expect.objectContaining({ email: 'friend@example.com', status: 'pending' }),
    ]);

    const allowed = await call(store, '/v1/accounts/status', 'admin', 'POST', {
      email: 'friend@example.com',
      status: 'approved',
    });
    expect((await allowed.json()).status).toBe('approved');

    const again = await call(store, '/v1/session', 'friend', 'POST');
    expect((await again.json()).status).toBe('approved');
  });

  it('does not treat a locally approved member as allowed when the shared list is unreachable', () => {
    const account = accountWhenDirectoryUnavailable(
      { email: 'friend@example.com', name: 'Friend' },
      {
        email: 'friend@example.com',
        displayName: 'Friend',
        role: 'member',
        status: 'approved',
        createdAt: 't',
        updatedAt: 't',
      },
      null,
      'now',
    );
    expect(account.status).toBe('pending');
  });
});
