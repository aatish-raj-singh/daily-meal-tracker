/** Public OAuth web client ID. It is not a secret; Google shows it in the browser. */
const CONFIGURED_CLIENT_ID = '492144338713-hm2aii8op74u52olk8r7eb94ai61culd.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID = (import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '').trim() || CONFIGURED_CLIENT_ID;
