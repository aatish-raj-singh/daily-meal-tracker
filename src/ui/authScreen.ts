import { logout } from '../auth/accounts';
import { googleSignInConfigured, renderGoogleSignInButton } from '../auth/googleSignIn';
import { ADMIN_EMAIL, type Account, type AccountStatus } from '../types';
import { escapeHtml } from '../util/hash';

export async function renderAuthGate(
  host: HTMLElement,
  account: Account | null,
): Promise<void> {
  if (account && account.status !== 'approved') {
    renderLocked(host, account);
    return;
  }

  host.innerHTML = `
    <main class="auth-wrap">
      <div class="card">
        <h1>Daily Meal Tracker</h1>
        <p class="muted">Sign in with Google. Admin access is granted only to the verified account ${escapeHtml(ADMIN_EMAIL)}. Every other Google account is a regular user.</p>
        <p id="auth-error" class="banner error" hidden></p>
        <div id="google-button"></div>
        ${
          googleSignInConfigured()
            ? ''
            : `<div class="banner warning">Google sign-in is not configured yet. Add a Google OAuth web client ID as <code>VITE_GOOGLE_CLIENT_ID</code> before this button can appear.</div>`
        }
      </div>
    </main>
  `;

  if (!googleSignInConfigured()) return;

  const errorBox = host.querySelector('#auth-error') as HTMLElement;
  const buttonHost = host.querySelector('#google-button') as HTMLElement;
  try {
    await renderGoogleSignInButton(buttonHost, (message) => {
      errorBox.hidden = false;
      errorBox.textContent = message;
    });
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = err instanceof Error ? err.message : String(err);
  }
}

function renderLocked(host: HTMLElement, account: Account): void {
  host.innerHTML = `
    <main class="auth-wrap">
      <div class="card">
        <h1>${escapeHtml(statusTitle(account.status))}</h1>
        <p class="muted">${escapeHtml(statusBody(account.status))}</p>
        <p><strong>${escapeHtml(account.displayName)}</strong><br>${escapeHtml(account.email)}</p>
        <div class="btn-row">
          <button type="button" class="ghost" id="locked-logout">Use another account</button>
        </div>
      </div>
    </main>
  `;
  host.querySelector('#locked-logout')?.addEventListener('click', async () => {
    await logout();
    window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed'));
  });
}

function statusTitle(status: AccountStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting for approval';
    case 'denied':
      return 'Access denied';
    case 'approved':
      return 'Signed in';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function statusBody(status: AccountStatus): string {
  switch (status) {
    case 'pending':
      return 'This Google account is not approved on this device.';
    case 'denied':
      return 'This Google account is not allowed on this device.';
    case 'approved':
      return 'Access granted.';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
