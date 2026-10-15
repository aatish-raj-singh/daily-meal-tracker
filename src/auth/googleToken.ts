import { getGoogleCertCache, saveGoogleCertCache } from '../db/database';
import { decodeJson, verifyRs256Jwt, type GoogleIdentity, type RsaJwk } from './googleClaims';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CERT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export { assertGoogleClaims, type GoogleIdentity } from './googleClaims';

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Google sign-in token is malformed.');
  }
  const header = decodeJson<{ kid?: string }>(parts[0]);
  if (!header.kid) {
    throw new Error('Google sign-in token uses an unsupported signature.');
  }
  const keys = await loadCerts(header.kid);
  return verifyRs256Jwt(idToken, clientId, keys);
}

async function loadCerts(kid: string): Promise<RsaJwk[]> {
  const cached = await readFreshCerts();
  if (cached?.some((key) => key.kid === kid)) return cached;
  return fetchCerts();
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
