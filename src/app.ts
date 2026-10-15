import { getSessionAccount, logout, refreshSessionAccount } from './auth/accounts';
import { getPendingWrites } from './db/database';
import { APP_VERSION, type Account } from './types';
import { renderAdmin } from './ui/admin';
import { renderAuthGate } from './ui/authScreen';
import { renderBreakdown } from './ui/breakdown';
import { renderDashboard } from './ui/dashboard';
import { renderExcelSetup } from './ui/excelSetup';
import { renderHistory } from './ui/history';
import { renderLogFood } from './ui/logFood';
import { renderSettings } from './ui/settings';
import { clearBanner, type TabId, uiState } from './ui/state';
import { escapeHtml } from './util/hash';

const BASE_TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Home', icon: '◉' },
  { id: 'log', label: 'Log', icon: '+' },
  { id: 'history', label: 'History', icon: '☰' },
  { id: 'excel', label: 'Excel', icon: '▦' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

let listenersBound = false;
let shownGate = '';

export async function mountApp(host: HTMLElement): Promise<void> {
  if (!listenersBound) {
    listenersBound = true;
    window.addEventListener('online', () => void renderRoot(host));
    window.addEventListener('offline', () => void renderRoot(host));
    window.addEventListener('meal-tracker:auth-changed', () => void renderRoot(host));
    window.addEventListener('meal-tracker:refresh', () => {
      if (host.dataset.mode === 'app') void renderView(host);
    });
    window.addEventListener('meal-tracker:navigate', ((ev: CustomEvent<TabId>) => {
      uiState.tab = ev.detail;
      if (host.dataset.mode === 'app') void renderView(host);
    }) as EventListener);
    window.setInterval(() => {
      void refreshSessionAccount().then((account) => {
        const gate = account?.status ?? 'signed-out';
        if (gate === shownGate) return;
        shownGate = gate;
        window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed'));
      });
    }, 8000);
  }
  await renderRoot(host);
}

async function renderRoot(host: HTMLElement): Promise<void> {
  const account = await getSessionAccount();
  shownGate = account?.status ?? 'signed-out';
  if (!account || account.status !== 'approved') {
    host.dataset.mode = 'auth';
    await renderAuthGate(host, account);
    return;
  }
  if (host.dataset.mode !== 'app') {
    host.dataset.mode = 'app';
    buildShell(host, account);
  }
  await renderView(host);
}

function tabsFor(account: Account): Array<{ id: TabId; label: string; icon: string }> {
  if (account.role === 'admin') {
    return [...BASE_TABS, { id: 'admin', label: 'Admin', icon: '✦' }];
  }
  return BASE_TABS;
}

function buildShell(host: HTMLElement, account: Account): void {
  const tabs = tabsFor(account);
  host.innerHTML = `
    <header class="app-header">
      <div class="brand">
        <h1>Daily Meal Tracker</h1>
        <p class="user-email">${escapeHtml(account.email)}</p>
      </div>
      <div class="header-actions">
        <span class="version-pill" title="Deployed app version">v${APP_VERSION}</span>
        <span id="net-status" class="status-pill">Online</span>
        <span id="sync-status" class="status-pill">Sync —</span>
        <button type="button" class="ghost" id="open-settings">Settings</button>
        <button type="button" class="ghost" id="logout-btn">Log out</button>
      </div>
    </header>
    <div id="banner-host"></div>
    <main id="view" tabindex="-1"></main>
    <nav class="tab-bar" aria-label="Primary" style="--tabs:${tabs.length}">
      ${tabs
        .map(
          (t) =>
            `<button type="button" data-tab="${t.id}" aria-label="${t.label}"><span class="icon" aria-hidden="true">${t.icon}</span>${t.label}</button>`,
        )
        .join('')}
    </nav>
    <div id="sw-toast" class="update-toast" role="status">
      <span>A new app version is available.</span>
      <button class="primary" id="sw-refresh" type="button">Update</button>
    </div>
  `;

  host.querySelectorAll('.tab-bar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('data-tab');
      if (!next || !isTabId(next)) return;
      uiState.tab = next;
      clearBanner();
      void renderView(host);
    });
  });

  host.querySelector('#open-settings')?.addEventListener('click', () => {
    uiState.tab = 'settings';
    clearBanner();
    void renderView(host);
  });

  host.querySelector('#logout-btn')?.addEventListener('click', async () => {
    if (!window.confirm('Log out?')) return;
    await logout();
    uiState.tab = 'dashboard';
    clearBanner();
    window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed'));
  });
}

function isTabId(value: string): value is TabId {
  switch (value) {
    case 'dashboard':
    case 'log':
    case 'history':
    case 'excel':
    case 'settings':
    case 'admin':
    case 'breakdown':
      return true;
    default:
      return false;
  }
}

async function renderView(host: HTMLElement): Promise<void> {
  const view = host.querySelector('#view') as HTMLElement | null;
  if (!view) return;
  const account = await getSessionAccount();
  if (!account || account.status !== 'approved') {
    await renderRoot(host);
    return;
  }
  if (uiState.tab === 'admin' && account.role !== 'admin') {
    uiState.tab = 'dashboard';
  }

  const highlighted = uiState.tab === 'breakdown' ? 'dashboard' : uiState.tab;
  host.querySelectorAll('.tab-bar button').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === highlighted);
  });

  const bannerHost = host.querySelector('#banner-host') as HTMLElement | null;
  if (bannerHost) {
    bannerHost.innerHTML = uiState.banner
      ? `<div class="banner ${uiState.banner.type}" style="margin:12px 16px 0">${escapeHtml(uiState.banner.text)}</div>`
      : '';
  }

  const net = host.querySelector('#net-status') as HTMLElement | null;
  if (net) {
    uiState.offline = !navigator.onLine;
    net.textContent = uiState.offline ? 'Offline' : 'Online';
    net.className = `status-pill ${uiState.offline ? 'warn' : 'ok'}`;
  }
  const sync = host.querySelector('#sync-status') as HTMLElement | null;
  if (sync) {
    const pending = await getPendingWrites();
    if (pending.length === 0) {
      sync.textContent = 'Saved';
      sync.className = 'status-pill ok';
    } else {
      sync.textContent = `${pending.length} to save`;
      sync.className = 'status-pill warn';
    }
  }

  window.scrollTo(0, 0);

  switch (uiState.tab) {
    case 'dashboard':
      await renderDashboard(view);
      break;
    case 'breakdown':
      await renderBreakdown(view);
      break;
    case 'log':
      await renderLogFood(view);
      break;
    case 'history':
      await renderHistory(view);
      break;
    case 'excel':
      await renderExcelSetup(view);
      break;
    case 'settings':
      await renderSettings(view);
      break;
    case 'admin':
      await renderAdmin(view);
      break;
    default: {
      const exhaustive: never = uiState.tab;
      throw new Error(`Unknown tab: ${exhaustive}`);
    }
  }
}

export function showServiceWorkerUpdateToast(onRefresh: () => void): void {
  const toast = document.querySelector('#sw-toast');
  const button = document.querySelector('#sw-refresh');
  if (!toast || !button) return;
  toast.classList.add('show');
  button.addEventListener(
    'click',
    () => {
      onRefresh();
    },
    { once: true },
  );
}
