import { listAccountsForAdmin, setAccountStatus } from '../auth/accounts';
import type { Account, AccountStatus } from '../types';
import { escapeHtml } from '../util/hash';
import { setBanner } from './state';

export function adminViewHtml(accounts: Account[]): string {
  const waiting = accounts.filter((account) => account.role !== 'admin' && account.status !== 'approved');
  const people = accounts.filter((account) => account.status === 'approved');
  return `
    <div class="card">
      <h2>Users</h2>
      <div class="grid-macros">
        ${metric('Enrolled', accounts.length)}
        ${metric('Active', accounts.filter((account) => account.status === 'approved').length)}
        ${metric('Waiting', accounts.filter((account) => account.status === 'pending').length)}
        ${metric('Denied', accounts.filter((account) => account.status === 'denied').length)}
      </div>
    </div>
    <div class="card">
      <h2>Approvals</h2>
      ${accountList(waiting)}
    </div>
    <div class="card">
      <h2>People</h2>
      ${accountList(people)}
    </div>
  `;
}

export async function renderAdmin(root: HTMLElement): Promise<void> {
  const accounts = await listAccountsForAdmin();
  root.innerHTML = adminViewHtml(accounts);

  root.querySelectorAll<HTMLButtonElement>('[data-decision]').forEach((button) => {
    button.addEventListener('click', async () => {
      const email = button.getAttribute('data-email');
      const decision = parseDecision(button.getAttribute('data-decision'));
      if (!email || !decision) return;
      button.disabled = true;
      try {
        await setAccountStatus(email, decision);
        setBanner('success', decision === 'approved' ? 'Access allowed.' : 'Access revoked.');
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      } catch (err) {
        setBanner('error', err instanceof Error ? err.message : String(err));
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      }
    });
  });
}

function metric(label: string, count: number): string {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${count}</div></div>`;
}

function accountList(accounts: Account[]): string {
  if (accounts.length === 0) return '';
  return `<div class="list">${accounts
    .map((account) => {
      const allow =
        account.status === 'approved'
          ? ''
          : `<button type="button" class="primary" data-email="${escapeHtml(account.email)}" data-decision="approved">Allow</button>`;
      const revoke =
        account.role === 'admin' || account.status === 'denied'
          ? ''
          : `<button type="button" class="danger" data-email="${escapeHtml(account.email)}" data-decision="denied">Revoke access</button>`;
      const label = account.role === 'admin' ? 'Admin' : statusLabel(account.status);
      const actions = allow || revoke ? `<div class="btn-row">${allow}${revoke}</div>` : '';
      return `
        <div class="list-item">
          <div class="title">${escapeHtml(account.displayName)}</div>
          <div class="meta">${escapeHtml(account.email)} · ${escapeHtml(label)}</div>
          ${actions}
        </div>`;
    })
    .join('')}</div>`;
}

function parseDecision(value: string | null): 'approved' | 'denied' | null {
  switch (value) {
    case 'approved':
    case 'denied':
      return value;
    default:
      return null;
  }
}

function statusLabel(status: AccountStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'approved':
      return 'Allowed';
    case 'denied':
      return 'Denied';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
