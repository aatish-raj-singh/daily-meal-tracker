import { signInWithGoogleIdToken } from './accounts';
import { GOOGLE_CLIENT_ID } from './googleClient';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      theme: 'filled_black';
      size: 'large';
      width: number;
      text: 'signin_with';
      shape: 'pill';
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

export function googleSignInConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

export async function renderGoogleSignInButton(
  parent: HTMLElement,
  onFailure: (message: string) => void,
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
      void signInWithGoogleIdToken(response.credential)
        .then((account) => {
          window.dispatchEvent(new CustomEvent('meal-tracker:auth-changed', { detail: account }));
        })
        .catch((err: unknown) => {
          onFailure(err instanceof Error ? err.message : String(err));
        });
    },
  });
  api.renderButton(parent, {
    theme: 'filled_black',
    size: 'large',
    width: 320,
    text: 'signin_with',
    shape: 'pill',
  });
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
