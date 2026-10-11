import { listAccountsForAdmin, setAccountStatus } from '../auth/accounts';
import { ADMIN_EMAIL, type AccountStatus } from '../types';
import { escapeHtml } from '../util/hash';
import { setBanner } from './state';

export async function renderAdmin(root: HTMLElement): Promise<void> {
  const accounts = await listAccountsForAdmin();
  const pending = accounts.filter((a) => a.status === 'pending');
  const others = accounts.filter((a) => a.email !== ADMIN_EMAIL && a.status !== 'pending');

  root.innerHTML = `
    <div class="card">
      <h2>Access</h2>
      <p class="muted">You are the admin (${escapeHtml(ADMIN_EMAIL)}). Approve people who request access on this device. Accounts stay in this browser; a JSON backup includes them so you can restore access on your phone.</p>
    </div>
    <div class="card">
      <h2>Waiting for approval (${pending.length})</h2>
      ${
        pending.length === 0
          ? '<p class="muted">No pending requests.</p>'
          : `<div class="list">${pending.map((a) => accountRow(a)).join('')}</div>`
      }
    </div>
    <div class="card">
      <h2>Other accounts</h2>
      ${
        others.length === 0
          ? '<p class="muted">No other accounts yet.</p>'
          : `<div class="list">${others.map((a) => accountRow(a)).join('')}</div>`
      }
    </div>
  `;

  root.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const email = btn.getAttribute('data-email');
      const action = btn.getAttribute('data-action');
      if (!email || !action) return;
      const status = actionToStatus(action);
      if (!status) return;
      const verb = status === 'approved' ? 'Approve' : status === 'denied' ? 'Deny' : 'Revoke';
      if (!window.confirm(`${verb} access for ${email}?`)) return;
      try {
        await setAccountStatus(email, status);
        setBanner('success', `${email} is now ${status}.`);
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      } catch (err) {
        setBanner('error', err instanceof Error ? err.message : String(err));
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      }
    });
  });
}

function actionToStatus(action: string): AccountStatus | null {
  switch (action) {
    case 'approve':
      return 'approved';
    case 'deny':
      return 'denied';
    case 'revoke':
      return 'denied';
    default:
      return null;
  }
}

function accountRow(account: {
  email: string;
  displayName: string;
  status: AccountStatus;
}): string {
  const actions =
    account.status === 'pending'
      ? `<button type="button" class="primary" data-action="approve" data-email="${escapeHtml(account.email)}">Approve</button>
         <button type="button" class="danger" data-action="deny" data-email="${escapeHtml(account.email)}">Deny</button>`
      : account.status === 'approved'
        ? `<button type="button" class="danger" data-action="revoke" data-email="${escapeHtml(account.email)}">Revoke</button>`
        : `<button type="button" class="secondary" data-action="approve" data-email="${escapeHtml(account.email)}">Approve</button>`;
  return `
    <div class="list-item">
      <div class="title">${escapeHtml(account.displayName)}</div>
      <div class="meta">${escapeHtml(account.email)} · ${escapeHtml(account.status)}</div>
      <div class="btn-row">${actions}</div>
    </div>
  `;
}
