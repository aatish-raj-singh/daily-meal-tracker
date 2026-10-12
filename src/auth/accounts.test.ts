import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL } from '../types';
import { clearAllData, resetDbPromise, saveAuthSession } from '../db/database';
import { getSessionAccount, roleForEmail } from './accounts';
import { assertGoogleClaims } from './googleToken';
import { nowIso } from '../util/hash';

async function reset(): Promise<void> {
  try {
    await clearAllData();
  } catch {
    // first run
  }
  resetDbPromise();
}

describe('google admin access', () => {
  beforeEach(async () => {
    await reset();
  });

  it('grants admin only to the designated email', () => {
    expect(roleForEmail('BiasThakur.Aatish@gmail.com')).toBe('admin');
    expect(roleForEmail(ADMIN_EMAIL)).toBe('admin');
    expect(roleForEmail('friend@example.com')).toBe('member');
  });

  it('accepts a verified Google token for the configured client', () => {
    const identity = assertGoogleClaims(
      {
        iss: 'https://accounts.google.com',
        aud: 'client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: 'BiasThakur.Aatish@gmail.com',
        email_verified: true,
        name: 'Aatish',
        sub: 'google-subject',
      },
      'client-id',
    );
    expect(identity.email).toBe(ADMIN_EMAIL);
    expect(roleForEmail(identity.email)).toBe('admin');
  });

  it('rejects unverified emails and the wrong app', () => {
    const base = {
      iss: 'https://accounts.google.com',
      aud: 'client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'friend@example.com',
      email_verified: true,
    };
    expect(() => assertGoogleClaims({ ...base, email_verified: false }, 'client-id')).toThrow(
      /not verified/,
    );
    expect(() => assertGoogleClaims({ ...base, aud: 'other-app' }, 'client-id')).toThrow(
      /different app/,
    );
    expect(() => assertGoogleClaims({ ...base, iss: 'https://evil.example' }, 'client-id')).toThrow(
      /not issued by Google/,
    );
  });

  it('ignores old password sessions that have no Google token', async () => {
    await saveAuthSession({
      id: 'current',
      email: ADMIN_EMAIL,
      createdAt: nowIso(),
    });
    expect(await getSessionAccount()).toBeNull();
  });
});
