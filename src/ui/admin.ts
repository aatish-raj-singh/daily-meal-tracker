import { listAccountsForAdmin } from '../auth/accounts';
import { ADMIN_EMAIL } from '../types';
import { escapeHtml } from '../util/hash';

export async function renderAdmin(root: HTMLElement): Promise<void> {
  const accounts = await listAccountsForAdmin();

  root.innerHTML = `
    <div class="card">
      <h2>Admin</h2>
      <p class="muted">Only the Google account ${escapeHtml(ADMIN_EMAIL)} is the admin. Signing in with another Google account cannot grant admin access, on this device or any other.</p>
    </div>
    <div class="card">
      <h2>Google accounts on this device</h2>
      ${
        accounts.length === 0
          ? '<p class="muted">No accounts stored on this device yet.</p>'
          : `<div class="list">${accounts
              .map(
                (account) => `
            <div class="list-item">
              <div class="title">${escapeHtml(account.displayName)}</div>
              <div class="meta">${escapeHtml(account.email)} · ${escapeHtml(account.role)}</div>
            </div>`,
              )
              .join('')}</div>`
      }
    </div>
  `;
}
