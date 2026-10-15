export interface GoogleIdentity {
  email: string;
  name: string;
  subject: string;
  expiresAt: number;
}

export interface RsaJwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
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

const CLOCK_SKEW_SEC = 60;

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

export async function verifyRs256Jwt(idToken: string, clientId: string, keys: RsaJwk[]): Promise<GoogleIdentity> {
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
  const key = keys.find((item) => item.kid === header.kid);
  if (!key) {
    throw new Error('Google signing key for this token was not found.');
  }
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

export function decodeJson<T>(segment: string): T {
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
