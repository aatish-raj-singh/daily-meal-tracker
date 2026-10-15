import { signInWithGoogleIdToken } from './accounts';
import { GOOGLE_CLIENT_ID } from './googleClient';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleButtonOptions {
  theme: 'outline';
  size: 'large';
  width: number;
  text: 'continue_with';
  shape: 'pill';
  logo_alignment: 'left';
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
}

interface SignInHandlers {
  onFailure: (message: string) => void;
  onStart?: () => void;
  onFinish?: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

export function googleSignInConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

let signInFlight: Promise<void> | null = null;
let buttonObserver: ResizeObserver | null = null;

export async function renderGoogleSignInButton(
  parent: HTMLElement,
  handlers: SignInHandlers,
): Promise<void> {
  await loadGoogleScript();
  const api = window.google?.accounts.id;
  if (!api) {
    throw new Error('Google sign-in did not start. Refresh and try again.');
  }
  parent.replaceChildren();
  api.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => {
      if (signInFlight) return;
      handlers.onStart?.();
      parent.classList.add('is-busy');
      parent.setAttribute('aria-busy', 'true');
      signInFlight = signInWithGoogleIdToken(response.credential)
        .then((account) => {
          window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed', { detail: account }));
        })
        .catch((err: unknown) => {
          handlers.onFailure(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          signInFlight = null;
          parent.classList.remove('is-busy');
          parent.removeAttribute('aria-busy');
          handlers.onFinish?.();
        });
    },
  });
  paintGoogleButton(api, parent);
  buttonObserver?.disconnect();
  let painted = googleButtonWidth(parent);
  buttonObserver = new ResizeObserver(() => {
    if (signInFlight || !parent.isConnected) return;
    const next = googleButtonWidth(parent);
    if (Math.abs(next - painted) < 8) return;
    painted = next;
    paintGoogleButton(api, parent);
  });
  buttonObserver.observe(parent);
}

function paintGoogleButton(api: GoogleIdApi, parent: HTMLElement): void {
  api.renderButton(parent, {
    theme: 'outline',
    size: 'large',
    width: googleButtonWidth(parent),
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'left',
  });
}

function googleButtonWidth(parent: HTMLElement): number {
  const available = Math.floor(parent.clientWidth);
  return Math.max(200, Math.min(400, available || 280));
}

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>('script[data-google-gsi]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google sign-in.')), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.dataset.googleGsi = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    document.head.appendChild(script);
  });
}
