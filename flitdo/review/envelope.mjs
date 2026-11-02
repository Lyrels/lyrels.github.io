// The decrypting half of the Flitdo review certificate. It runs in the reviewer's browser, on Web
// Crypto alone, and also in the Node tests, so what is tested is what the page runs. Encrypting and
// signing are not here: nothing on this site can make a certificate.

export const ENVELOPE_FORMAT = 'flitdo-review-license';
export const ENVELOPE_VERSION = 1;
export const CERTIFICATE_PREFIX = 'FLITDO-REVIEW-1';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Why a certificate could not be shown: 'password' cannot be told from a damaged ciphertext. */
export class EnvelopeError extends Error {
  constructor(kind) {
    super(kind);
    this.name = 'EnvelopeError';
    this.kind = kind;
  }
}

export function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** The header is authenticated with the ciphertext, so its fields cannot be swapped unnoticed. */
export function additionalData(iterations, salt) {
  return encoder.encode(`${ENVELOPE_FORMAT}/${ENVELOPE_VERSION}/${iterations}/${salt}`);
}

export async function deriveKey(password, salt, iterations, usages) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

/** The fields of license.enc, or an EnvelopeError('damaged') if it is not one. */
export function parseEnvelope(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new EnvelopeError('damaged');
  }
  const valid = envelope?.format === ENVELOPE_FORMAT
    && envelope.version === ENVELOPE_VERSION
    && envelope.kdf?.name === 'PBKDF2'
    && envelope.kdf.hash === 'SHA-256'
    && Number.isInteger(envelope.kdf.iterations)
    && envelope.kdf.iterations >= 100_000
    && envelope.kdf.iterations <= 10_000_000
    && typeof envelope.kdf.salt === 'string'
    && envelope.cipher?.name === 'AES-GCM'
    && typeof envelope.cipher.iv === 'string'
    && typeof envelope.data === 'string';
  if (!valid) throw new EnvelopeError('damaged');
  return envelope;
}

/** The certificate inside [envelope]. A wrong password and a changed ciphertext fail alike. */
export async function decryptEnvelope(envelope, password) {
  let salt, iv, data;
  try {
    salt = base64ToBytes(envelope.kdf.salt);
    iv = base64ToBytes(envelope.cipher.iv);
    data = base64ToBytes(envelope.data);
  } catch {
    throw new EnvelopeError('damaged');
  }
  try {
    const key = await deriveKey(password, salt, envelope.kdf.iterations, ['decrypt']);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(envelope.kdf.iterations, envelope.kdf.salt) },
      key,
      data,
    );
    return decoder.decode(plain);
  } catch {
    throw new EnvelopeError('password');
  }
}

/** The dates a certificate states, for display. The app checks the signature; this page does not. */
export function readCertificate(certificate) {
  const parts = certificate.split('.');
  if (parts.length !== 3 || parts[0] !== CERTIFICATE_PREFIX) throw new EnvelopeError('damaged');
  try {
    const padded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const claims = JSON.parse(decoder.decode(base64ToBytes(padded)));
    if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) throw new Error('dates');
    return { issuedAt: new Date(claims.iat), expiresAt: new Date(claims.exp) };
  } catch {
    throw new EnvelopeError('damaged');
  }
}
