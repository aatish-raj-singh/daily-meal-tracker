import { describe, expect, it } from 'vitest';
import type { Account } from '../types';
import { adminViewHtml, filterAccounts } from './admin';

const accounts: Account[] = [
  {
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'approved',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    email: 'waiting@example.com',
    displayName: 'Waiting User',
    role: 'member',
    status: 'pending',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  },
  {
    email: 'revoked@example.com',
    displayName: 'Revoked User',
    role: 'member',
    status: 'denied',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  },
];

describe('admin console markup', () => {
  it('shows real statistics and supported account actions', () => {
    const html = adminViewHtml(accounts);

    expect(html).toContain('Registered users');
    expect(html).toContain('Pending approvals');
    expect(html).toContain('Waiting User');
    expect(html).toContain('data-decision="approved"');
    expect(html).toContain('data-decision="denied"');
    expect(html).toContain('Revoked');
  });

  it('shows an explained approvals empty state', () => {
    const html = adminViewHtml([accounts[0]!]);

    expect(html).toContain('No pending approvals');
    expect(html).not.toContain('data-decision="denied"');
  });

  it('filters users by name, status, and role', () => {
    expect(filterAccounts(accounts, 'waiting', 'all', 'all')).toEqual([accounts[1]]);
    expect(filterAccounts(accounts, '', 'denied', 'all')).toEqual([accounts[2]]);
    expect(filterAccounts(accounts, '', 'approved', 'admin')).toEqual([accounts[0]]);
    expect(filterAccounts(accounts, 'missing', 'all', 'all')).toEqual([]);
  });
});
