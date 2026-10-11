const DEFAULT_ITERATIONS = 150_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function hashPassword(
  password: string,
  saltHex?: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<{ passwordSalt: string; passwordHash: string; passwordIterations: number }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return {
    passwordSalt: bytesToHex(salt),
    passwordHash: bytesToHex(new Uint8Array(bits)),
    passwordIterations: iterations,
  };
}

export async function verifyPassword(
  password: string,
  passwordSalt: string,
  passwordHash: string,
  passwordIterations: number,
): Promise<boolean> {
  const next = await hashPassword(password, passwordSalt, passwordIterations);
  if (next.passwordHash.length !== passwordHash.length) return false;
  let diff = 0;
  for (let i = 0; i < passwordHash.length; i += 1) {
    diff |= next.passwordHash.charCodeAt(i) ^ passwordHash.charCodeAt(i);
  }
  return diff === 0;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
