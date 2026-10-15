import { logout } from '../auth/accounts';
import { googleSignInConfigured, renderGoogleSignInButton } from '../auth/googleSignIn';
import { type Account, type AccountStatus } from '../types';
import { escapeHtml } from '../util/hash';

export async function renderAuthGate(
  host: HTMLElement,
  account: Account | null,
): Promise<void> {
  if (account && account.status !== 'approved') {
    renderLocked(host, account);
    return;
  }

  host.innerHTML = loginScreen(`
    <section class="login-card">
      <p id="auth-status" class="login-status" role="status" hidden>Signing in…</p>
      <p id="auth-error" class="banner error" hidden></p>
      <div id="google-button" class="google-signin"></div>
      ${
        googleSignInConfigured()
          ? ''
          : `<div class="banner warning">Sign-in unavailable</div>`
      }
      <div class="login-split" aria-hidden="true">
        <span></span>
        ${smallLeaf()}
        <span></span>
      </div>
      <p class="login-privacy">${shieldIcon()}Your health data stays yours.</p>
    </section>
  `);

  if (!googleSignInConfigured()) return;

  const errorBox = host.querySelector('#auth-error') as HTMLElement;
  const statusBox = host.querySelector('#auth-status') as HTMLElement;
  const buttonHost = host.querySelector('#google-button') as HTMLElement;
  try {
    await renderGoogleSignInButton(buttonHost, {
      onStart() {
        errorBox.hidden = true;
        statusBox.hidden = false;
      },
      onFinish() {
        statusBox.hidden = true;
      },
      onFailure(message) {
        errorBox.hidden = false;
        errorBox.textContent = message;
      },
    });
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = err instanceof Error ? err.message : String(err);
  }
}

function renderLocked(host: HTMLElement, account: Account): void {
  host.innerHTML = loginScreen(`
    <section class="login-card">
      <h2>${escapeHtml(statusTitle(account.status))}</h2>
      <p class="auth-person"><strong>${escapeHtml(account.displayName)}</strong><span>${escapeHtml(account.email)}</span></p>
      <button type="button" class="ghost auth-switch" id="locked-logout">Use another account</button>
    </section>
  `);
  host.querySelector('#locked-logout')?.addEventListener('click', async () => {
    await logout();
    window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed'));
  });
}

function loginScreen(body: string): string {
  return `
    <main class="login-screen">
      <div class="login-decor" aria-hidden="true">
        <svg class="leaf-left" viewBox="0 0 64 64">${leafShape()}</svg>
        <svg class="leaf-right" viewBox="0 0 64 64">${leafShape()}</svg>
      </div>
      <div class="login-content">
        <div class="login-logo" aria-hidden="true">
          <svg viewBox="0 0 64 64">${leafForkLogo()}</svg>
        </div>
        <h1 class="login-title"><span>Daily</span> <span class="meal">Meal</span> <span>Tracker</span></h1>
        <p class="login-tagline">Your nutrition, one day at a time.</p>
        ${body}
      </div>
    </main>
  `;
}

function leafShape(): string {
  return `<path fill="currentColor" d="M32 2C20 16 8 30 8 42c0 12 10 20 24 22 14-2 24-10 24-22C56 30 44 16 32 2z"/>`;
}

function leafForkLogo(): string {
  return `
    <path fill="#34D399" d="M32 2C20 16 8 30 8 42c0 12 10 20 24 22 14-2 24-10 24-22C56 30 44 16 32 2z"/>
    <path fill="none" stroke="#07111A" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" d="M23.5 25.5v8.5M32 15.5v14M40.5 25.5v8.5M23.5 34.5h17M32 34.5v20"/>
  `;
}

function smallLeaf(): string {
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${leafShape()}</svg>`;
}

function shieldIcon(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5 4.5 5.4v6.3c0 4.6 3.2 8.8 7.5 9.8 4.3-1 7.5-5.2 7.5-9.8V5.4L12 2.5zm0 2.3 5.5 2.2v4.7c0 3.5-2.3 6.8-5.5 7.7-3.2-.9-5.5-4.2-5.5-7.7V7l5.5-2.2z"/></svg>`;
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
