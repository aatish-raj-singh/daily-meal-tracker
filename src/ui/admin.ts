import { listAccountsForAdmin, setAccountStatus } from '../auth/accounts';
import type { Account, AccountStatus, UserRole } from '../types';
import { escapeHtml } from '../util/hash';
import { setBanner, uiState } from './state';

export function adminViewHtml(accounts: Account[]): string {
  const pending = accounts.filter(
    (account) => account.role !== 'admin' && account.status === 'pending',
  );
  return `
    <div id="admin-screen">
      <section class="admin-page-head">
        <div>
          <p class="eyebrow">Administration</p>
          <h2>Admin Console</h2>
          <p>Manage users and access</p>
        </div>
        <span class="role-badge">Admin</span>
      </section>

      <section class="admin-stats" aria-label="User statistics">
        ${metric('registered', 'Registered users', accounts.length)}
        ${metric(
          'active',
          'Active users',
          accounts.filter((account) => account.status === 'approved').length,
        )}
        ${metric(
          'pending',
          'Pending approvals',
          accounts.filter((account) => account.status === 'pending').length,
        )}
        ${metric(
          'admins',
          'Administrators',
          accounts.filter((account) => account.role === 'admin').length,
        )}
      </section>

      <section class="card admin-section">
        <div class="section-head">
          <div>
            <h2>Approvals</h2>
            <p class="section-subtitle">New access requests</p>
          </div>
          ${pending.length ? `<span class="count-badge pending">${pending.length}</span>` : ''}
        </div>
        ${
          pending.length
            ? `<div class="admin-user-list">${pending.map((account) => approvalCard(account)).join('')}</div>`
            : emptyState('pending', 'No pending approvals')
        }
      </section>

      <section class="card admin-section">
        <div class="section-head">
          <div>
            <h2>People</h2>
            <p class="section-subtitle">Registered users and access</p>
          </div>
          <span class="count-badge">${accounts.length}</span>
        </div>
        <div class="admin-filters">
          <div class="field admin-search">
            <label for="admin-search">Search</label>
            <input id="admin-search" type="search" placeholder="Name or email" autocomplete="off" />
          </div>
          <div class="field">
            <label for="admin-status">Status</label>
            <select id="admin-status">
              <option value="all">All statuses</option>
              <option value="approved">Allowed</option>
              <option value="pending">Pending</option>
              <option value="denied">Revoked</option>
            </select>
          </div>
          <div class="field">
            <label for="admin-role">Role</label>
            <select id="admin-role">
              <option value="all">All roles</option>
              <option value="admin">Admin</option>
              <option value="member">User</option>
            </select>
          </div>
          <button type="button" class="ghost clear-filters" id="admin-clear">Clear</button>
        </div>
        <div id="admin-user-results">${peopleList(accounts)}</div>
      </section>
    </div>
  `;
}

let adminWatch = 0;
let adminWatchTimer = 0;
let accountsSignature = '';

export async function renderAdmin(root: HTMLElement): Promise<void> {
  const watch = ++adminWatch;
  window.clearInterval(adminWatchTimer);
  root.innerHTML = loadingState();
  accountsSignature = '';
  await loadAdmin(root);
  adminWatchTimer = window.setInterval(() => {
    if (watch !== adminWatch || !root.isConnected || uiState.tab !== 'admin') {
      window.clearInterval(adminWatchTimer);
      return;
    }
    void loadAdmin(root);
  }, 8000);
}

async function loadAdmin(root: HTMLElement): Promise<void> {
  try {
    const accounts = await listAccountsForAdmin();
    const signature = JSON.stringify(accounts);
    if (signature === accountsSignature && root.querySelector('#admin-screen')) return;
    accountsSignature = signature;
    root.innerHTML = adminViewHtml(accounts);
    bindAdminActions(root, accounts);
  } catch (err) {
    accountsSignature = '';
    root.innerHTML = errorState(err instanceof Error ? err.message : 'Couldn’t load people.');
    root.querySelector('#retry-admin')?.addEventListener('click', () => {
      root.innerHTML = loadingState();
      void loadAdmin(root);
    });
  }
}

function bindAdminActions(root: HTMLElement, accounts: Account[]): void {
  const updateResults = () => {
    const query = (root.querySelector('#admin-search') as HTMLInputElement).value;
    const status = (root.querySelector('#admin-status') as HTMLSelectElement).value;
    const role = (root.querySelector('#admin-role') as HTMLSelectElement).value;
    const filtered = filterAccounts(accounts, query, status, role);
    const results = root.querySelector('#admin-user-results');
    if (results) results.innerHTML = peopleList(filtered, true);
    bindDecisionButtons(root);
  };

  root.querySelector('#admin-search')?.addEventListener('input', updateResults);
  root.querySelector('#admin-status')?.addEventListener('change', updateResults);
  root.querySelector('#admin-role')?.addEventListener('change', updateResults);
  root.querySelector('#admin-clear')?.addEventListener('click', () => {
    (root.querySelector('#admin-search') as HTMLInputElement).value = '';
    (root.querySelector('#admin-status') as HTMLSelectElement).value = 'all';
    (root.querySelector('#admin-role') as HTMLSelectElement).value = 'all';
    updateResults();
  });
  bindDecisionButtons(root);
}

function bindDecisionButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-decision]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', async () => {
      const email = button.dataset.email;
      const name = button.dataset.name;
      const decision = parseDecision(button.dataset.decision);
      if (!email || !name || !decision) return;
      if (decision === 'denied' && !confirmRevoke(name, email, button.dataset.pending === 'true')) {
        return;
      }
      const idleLabel = button.textContent ?? '';
      button.disabled = true;
      button.textContent = decision === 'approved' ? 'Allowing…' : 'Revoking…';
      try {
        await setAccountStatus(email, decision);
        setBanner('success', decision === 'approved' ? 'Access allowed.' : 'Access revoked.');
        accountsSignature = '';
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      } catch (err) {
        setBanner('error', err instanceof Error ? err.message : String(err));
        button.disabled = false;
        button.textContent = idleLabel;
        window.dispatchEvent(new CustomEvent('meal-tracker:refresh'));
      }
    });
  });
}

export function filterAccounts(
  accounts: Account[],
  query: string,
  status: string,
  role: string,
): Account[] {
  const needle = query.trim().toLowerCase();
  return accounts.filter((account) => {
    if (
      needle &&
      !account.displayName.toLowerCase().includes(needle) &&
      !account.email.toLowerCase().includes(needle)
    ) {
      return false;
    }
    if (status !== 'all' && account.status !== status) return false;
    if (role !== 'all' && account.role !== role) return false;
    return true;
  });
}

function metric(
  kind: 'registered' | 'active' | 'pending' | 'admins',
  label: string,
  count: number,
): string {
  return `
    <div class="admin-stat ${kind}">
      <span class="admin-stat-icon" aria-hidden="true">${metricIcon(kind)}</span>
      <div>
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${count}</div>
      </div>
    </div>
  `;
}

function approvalCard(account: Account): string {
  return `
    <article class="admin-user-card approval-card">
      ${avatar(account)}
      <div class="admin-user-info">
        <div class="admin-user-title">
          <strong>${escapeHtml(account.displayName)}</strong>
          ${statusBadge(account.status)}
        </div>
        <div class="admin-email">${escapeHtml(account.email)}</div>
        <div class="admin-user-meta">Requested ${formatDate(account.createdAt)}</div>
      </div>
      <div class="admin-actions">
        ${decisionButton(account, 'approved', 'Approve', 'primary')}
        ${decisionButton(account, 'denied', 'Reject', 'danger', true)}
      </div>
    </article>`;
}

function peopleList(accounts: Account[], filtered = false): string {
  if (accounts.length === 0) {
    return emptyState(
      filtered ? 'search' : 'users',
      filtered ? 'No users match your filters' : 'No registered users',
    );
  }
  return `<div class="admin-user-list">${accounts.map((account) => peopleCard(account)).join('')}</div>`;
}

function peopleCard(account: Account): string {
  const actions =
    account.role === 'admin'
      ? ''
      : account.status === 'approved'
        ? decisionButton(account, 'denied', 'Revoke', 'danger')
        : decisionButton(account, 'approved', 'Allow', 'primary');
  return `
    <article class="admin-user-card">
      ${avatar(account)}
      <div class="admin-user-info">
        <div class="admin-user-title">
          <strong>${escapeHtml(account.displayName)}</strong>
          ${roleBadge(account.role)}
          ${statusBadge(account.status)}
        </div>
        <div class="admin-email">${escapeHtml(account.email)}</div>
        <div class="admin-user-meta">Joined ${formatDate(account.createdAt)} · Updated ${formatDate(account.updatedAt)}</div>
      </div>
      ${actions ? `<div class="admin-actions">${actions}</div>` : ''}
    </article>`;
}

function decisionButton(
  account: Account,
  decision: 'approved' | 'denied',
  label: string,
  className: 'primary' | 'danger',
  pending = false,
): string {
  return `<button type="button" class="${className}" data-email="${escapeHtml(account.email)}" data-name="${escapeHtml(account.displayName)}" data-decision="${decision}" data-pending="${pending}">${label}</button>`;
}

function avatar(account: Account): string {
  const initial = account.displayName.trim().charAt(0).toUpperCase() || account.email.charAt(0).toUpperCase();
  return `<span class="admin-avatar" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function roleBadge(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '<span class="user-badge role-admin">Admin</span>';
    case 'member':
      return '<span class="user-badge role-user">User</span>';
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}

function statusBadge(status: AccountStatus): string {
  return `<span class="user-badge status-${status}">${statusLabel(status)}</span>`;
}

function emptyState(kind: 'pending' | 'search' | 'users', message: string): string {
  return `
    <div class="admin-empty">
      <span aria-hidden="true">${emptyIcon(kind)}</span>
      <strong>${escapeHtml(message)}</strong>
    </div>`;
}

function loadingState(): string {
  return `
    <div class="admin-loading" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>Loading users…</span>
    </div>`;
}

function errorState(message: string): string {
  return `
    <div class="card admin-error" role="alert">
      <h2>Couldn’t load users</h2>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="primary" id="retry-admin">Try again</button>
    </div>`;
}

function confirmRevoke(name: string, email: string, pending: boolean): boolean {
  const action = pending ? 'Reject access request' : 'Revoke access';
  const consequence = pending
    ? 'This person will be denied access until you allow them later.'
    : 'This person will lose access to the application.';
  return window.confirm(`${action} for ${name} (${email})?\n\n${consequence}`);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function parseDecision(value: string | undefined): 'approved' | 'denied' | null {
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
      return 'Pending';
    case 'approved':
      return 'Allowed';
    case 'denied':
      return 'Revoked';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function metricIcon(kind: 'registered' | 'active' | 'pending' | 'admins'): string {
  switch (kind) {
    case 'registered':
      return '◎';
    case 'active':
      return '✓';
    case 'pending':
      return '◷';
    case 'admins':
      return '◆';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function emptyIcon(kind: 'pending' | 'search' | 'users'): string {
  switch (kind) {
    case 'pending':
      return '✓';
    case 'search':
      return '⌕';
    case 'users':
      return '◎';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
