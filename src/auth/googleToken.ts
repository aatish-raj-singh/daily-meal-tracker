import { getGoogleCertCache, saveGoogleCertCache } from '../db/database';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CERT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

export interface GoogleIdentity {
  email: string;
  name: string;
  subject: string;
  expiresAt: number;
}

interface GoogleClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  sub?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface RsaJwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

export function assertGoogleClaims(claims: GoogleClaims, clientId: string, nowSec = unixNow()): GoogleIdentity {
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new Error('Google sign-in token was not issued by Google.');
  }
  const audience = claims.aud;
  const audienceOk = Array.isArray(audience) ? audience.includes(clientId) : audience === clientId;
  if (!audienceOk) {
    throw new Error('Google sign-in token is for a different app.');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec - CLOCK_SKEW_SEC) {
    throw new Error('Google sign-in expired. Sign in again.');
  }
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + CLOCK_SKEW_SEC) {
    throw new Error('Google sign-in token is not valid yet.');
  }
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new Error('Google has not verified this email address.');
  }
  const email = claims.email?.trim().toLowerCase() ?? '';
  if (!email.includes('@')) {
    throw new Error('Google did not return an email address.');
  }
  return {
    email,
    name: claims.name?.trim() || email,
    subject: claims.sub ?? email,
    expiresAt: claims.exp,
  };
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity> {
  if (!clientId) {
    throw new Error('Google sign-in is not configured.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Google sign-in token is malformed.');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJson<JwtHeader>(encodedHeader);
  const claims = decodeJson<GoogleClaims>(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Google sign-in token uses an unsupported signature.');
  }

  const key = await findCert(header.kid);
  const signed = toArrayBuffer(new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
  const signature = toArrayBuffer(base64UrlToBytes(encodedSignature));
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signed);
  if (!valid) {
    throw new Error('Google sign-in token signature is invalid.');
  }
  return assertGoogleClaims(claims, clientId);
}

async function findCert(kid: string): Promise<RsaJwk> {
  const cached = await readFreshCerts();
  const fromCache = cached?.find((key) => key.kid === kid);
  if (fromCache) return fromCache;

  const fresh = await fetchCerts();
  const match = fresh.find((key) => key.kid === kid);
  if (!match) {
    throw new Error('Google signing key for this token was not found.');
  }
  return match;
}

async function readFreshCerts(): Promise<RsaJwk[] | null> {
  const cached = await getGoogleCertCache();
  if (!cached) return null;
  const age = Date.now() - Date.parse(cached.fetchedAt);
  if (!Number.isFinite(age) || age > CERT_MAX_AGE_MS) return null;
  return cached.keys as RsaJwk[];
}

async function fetchCerts(): Promise<RsaJwk[]> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_CERTS_URL);
  } catch {
    const stale = await getGoogleCertCache();
    if (stale?.keys.length) return stale.keys as RsaJwk[];
    throw new Error('Could not reach Google to verify sign-in. Check your connection.');
  }
  if (!response.ok) {
    throw new Error('Google signing keys could not be downloaded.');
  }
  const body = (await response.json()) as { keys?: RsaJwk[] };
  const keys = body.keys ?? [];
  if (!keys.length) {
    throw new Error('Google returned no signing keys.');
  }
  await saveGoogleCertCache({
    id: 'jwks',
    fetchedAt: new Date().toISOString(),
    keys: keys as JsonWebKey[],
  });
  return keys;
}

function decodeJson<T>(segment: string): T {
  const text = new TextDecoder().decode(base64UrlToBytes(segment));
  return JSON.parse(text) as T;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function base64UrlToBytes(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
