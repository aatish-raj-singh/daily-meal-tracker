import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL } from '../types';
import { clearAllData, resetDbPromise } from '../db/database';
import {
  getSessionAccount,
  login,
  logout,
  registerAccount,
  setAccountStatus,
} from './accounts';

async function reset(): Promise<void> {
  try {
    await clearAllData();
  } catch {
    // first run
  }
  resetDbPromise();
}

describe('accounts and admin access', () => {
  beforeEach(async () => {
    await reset();
  });

  it('creates the designated email as the approved admin', async () => {
    const admin = await registerAccount({
      email: 'BiasThakur.Aatish@gmail.com',
      password: 'admin-pass-1',
      displayName: 'Aatish',
    });
    expect(admin.email).toBe(ADMIN_EMAIL);
    expect(admin.role).toBe('admin');
    expect(admin.status).toBe('approved');
    expect((await getSessionAccount())?.email).toBe(ADMIN_EMAIL);
  });

  it('keeps other people pending until the admin approves them', async () => {
    await registerAccount({
      email: ADMIN_EMAIL,
      password: 'admin-pass-1',
      displayName: 'Aatish',
    });
    const member = await registerAccount({
      email: 'friend@example.com',
      password: 'friend-pass-1',
      displayName: 'Friend',
    });
    expect(member.status).toBe('pending');
    expect(member.role).toBe('member');

    await logout();
    const pendingLogin = await login('friend@example.com', 'friend-pass-1');
    expect(pendingLogin.status).toBe('pending');

    await logout();
    await login(ADMIN_EMAIL, 'admin-pass-1');
    const approved = await setAccountStatus('friend@example.com', 'approved');
    expect(approved.status).toBe('approved');

    await logout();
    const signedIn = await login('friend@example.com', 'friend-pass-1');
    expect(signedIn.status).toBe('approved');
  });

  it('rejects a bad password and blocks members from approving access', async () => {
    await registerAccount({
      email: ADMIN_EMAIL,
      password: 'admin-pass-1',
      displayName: 'Aatish',
    });
    await registerAccount({
      email: 'friend@example.com',
      password: 'friend-pass-1',
      displayName: 'Friend',
    });
    await logout();
    await expect(login(ADMIN_EMAIL, 'wrong-password')).rejects.toThrow(/Incorrect password/);

    await login('friend@example.com', 'friend-pass-1');
    await expect(setAccountStatus('friend@example.com', 'approved')).rejects.toThrow(
      /Only the admin/,
    );
  });

  it('does not allow the admin account to be revoked', async () => {
    await registerAccount({
      email: ADMIN_EMAIL,
      password: 'admin-pass-1',
      displayName: 'Aatish',
    });
    await expect(setAccountStatus(ADMIN_EMAIL, 'denied')).rejects.toThrow(/cannot be denied/);
  });
});
