import { adminExists, login, logout, registerAccount } from '../auth/accounts';
import { ADMIN_EMAIL, type Account, type AccountStatus } from '../types';
import { escapeHtml } from '../util/hash';

export async function renderAuthGate(
  host: HTMLElement,
  account: Account | null,
  notice?: string,
): Promise<void> {
  if (account && account.status !== 'approved') {
    renderLocked(host, account);
    return;
  }

  const hasAdmin = await adminExists();
  host.innerHTML = `
    <main class="auth-wrap">
      <div class="card">
        <h1>Daily Meal Tracker</h1>
        <p class="muted">Sign in to use the food log. Access is approved by ${escapeHtml(ADMIN_EMAIL)}.</p>
        ${notice ? `<div class="banner info">${escapeHtml(notice)}</div>` : ''}
        <div class="btn-row" style="margin-bottom:12px">
          <button type="button" class="secondary" id="show-login">Sign in</button>
          ${hasAdmin ? '<button type="button" class="ghost" id="show-register">Request access</button>' : ''}
        </div>
        <form id="auth-form"></form>
      </div>
    </main>
  `;

  const form = host.querySelector('#auth-form') as HTMLFormElement;
  const showLogin = () => {
    form.innerHTML = loginFields(hasAdmin);
    form.dataset.mode = 'login';
  };
  const showRegister = () => {
    form.innerHTML = hasAdmin ? registerFields() : setupFields();
    form.dataset.mode = hasAdmin ? 'register' : 'setup';
  };

  if (hasAdmin) showLogin();
  else showRegister();

  host.querySelector('#show-login')?.addEventListener('click', showLogin);
  host.querySelector('#show-register')?.addEventListener('click', showRegister);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errorBox = form.querySelector('#auth-error') as HTMLElement;
    errorBox.textContent = '';
    errorBox.hidden = true;
    const mode = form.dataset.mode ?? 'login';
    const password = (form.querySelector('#auth-password') as HTMLInputElement).value;
    try {
      if (mode === 'login') {
        const email = (form.querySelector('#auth-email') as HTMLInputElement).value;
        const signedIn = await login(email, password);
        window.dispatchEvent(
          new CustomEvent('meal-tracker:auth-changed', { detail: signedIn }),
        );
        return;
      }
      const displayName = (form.querySelector('#auth-name') as HTMLInputElement).value;
      const confirm = (form.querySelector('#auth-confirm') as HTMLInputElement).value;
      if (password !== confirm) throw new Error('Passwords do not match.');
      const email =
        mode === 'setup'
          ? ADMIN_EMAIL
          : (form.querySelector('#auth-email') as HTMLInputElement).value;
      const created = await registerAccount({ email, password, displayName });
      if (created.status === 'approved') {
        window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed', { detail: created }));
        return;
      }
      await renderAuthGate(
        host,
        null,
        `Request sent for ${created.email}. Sign in after the admin approves you on this device.`,
      );
    } catch (err) {
      errorBox.hidden = false;
      errorBox.style.display = 'block';
      errorBox.textContent = err instanceof Error ? err.message : String(err);
    }
  });
}

function renderLocked(host: HTMLElement, account: Account): void {
  host.innerHTML = `
    <main class="auth-wrap">
      <div class="card">
        <h1>${escapeHtml(statusTitle(account.status))}</h1>
        <p class="muted">${escapeHtml(statusBody(account))}</p>
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

function statusBody(account: Account): string {
  switch (account.status) {
    case 'pending':
      return `Your request is pending. ${ADMIN_EMAIL} must approve it on this device before the tracker opens.`;
    case 'denied':
      return 'The admin has not allowed this account. Ask them to approve you from the Admin tab.';
    case 'approved':
      return 'Access granted.';
    default: {
      const exhaustive: never = account.status;
      return exhaustive;
    }
  }
}

function setupFields(): string {
  return `
    <h2>Create admin account</h2>
    <p class="muted">Admin access is reserved for ${escapeHtml(ADMIN_EMAIL)}. Choose a password for this device.</p>
    <div class="field"><label for="auth-name">Name</label><input id="auth-name" required autocomplete="name" /></div>
    <div class="field"><label for="auth-email">Email</label><input id="auth-email" value="${escapeHtml(ADMIN_EMAIL)}" disabled /></div>
    <div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" required minlength="8" autocomplete="new-password" /></div>
    <div class="field"><label for="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" required minlength="8" autocomplete="new-password" /></div>
    <p id="auth-error" class="banner error" hidden></p>
    <button class="primary" type="submit">Create admin and continue</button>
  `;
}

function loginFields(hasAdmin: boolean): string {
  return `
    <h2>Sign in</h2>
    ${hasAdmin ? '' : '<p class="muted">Create the admin account first.</p>'}
    <div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" required autocomplete="username" /></div>
    <div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" required autocomplete="current-password" /></div>
    <p id="auth-error" class="banner error" hidden></p>
    <button class="primary" type="submit">Sign in</button>
  `;
}

function registerFields(): string {
  return `
    <h2>Request access</h2>
    <p class="muted">The admin reviews requests on this device and decides who can open the tracker.</p>
    <div class="field"><label for="auth-name">Name</label><input id="auth-name" required autocomplete="name" /></div>
    <div class="field"><label for="auth-email">Email</label><input id="auth-email" type="email" required autocomplete="username" /></div>
    <div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" required minlength="8" autocomplete="new-password" /></div>
    <div class="field"><label for="auth-confirm">Confirm password</label><input id="auth-confirm" type="password" required minlength="8" autocomplete="new-password" /></div>
    <p id="auth-error" class="banner error" hidden></p>
    <button class="primary" type="submit">Request access</button>
  `;
}
