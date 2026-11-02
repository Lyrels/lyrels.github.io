// Issues, encrypts and checks Flitdo review certificates. Node only, no dependencies. This folder is
// not published: GitHub Pages leaves `.github` out.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import {
  CERTIFICATE_PREFIX,
  ENVELOPE_FORMAT,
  ENVELOPE_VERSION,
  additionalData,
  bytesToBase64,
  decryptEnvelope,
  deriveKey,
  parseEnvelope,
} from '../../flitdo/review/envelope.mjs';

// The Android app checks the same two values (ReviewAccess.kt).
export const PURPOSE = 'flitdo-pro-play-review';
export const APP = 'com.lyrels.flitdo';

export const LIFETIME_DAYS = 30;
export const ROTATE_AFTER_DAYS = 15;
export const KDF_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 32;
export const METADATA_FORMAT = 'flitdo-review-license-metadata';

const DAY_MS = 86_400_000;

/** A full certificate, wherever it appears. Used to prove none is ever written in the clear. */
export const CERTIFICATE_PATTERN = new RegExp(`${CERTIFICATE_PREFIX}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}`);

export function loadPrivateKey(base64) {
  try {
    const key = createPrivateKey({ key: Buffer.from(base64 ?? '', 'base64'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('type');
    return key;
  } catch {
    throw new Error('REVIEW_SIGNING_PRIVATE_KEY is missing or is not an Ed25519 key in base64 PKCS#8');
  }
}

/** Trimmed as the page trims what is typed: a line break from a file must not change the key. */
export function loadPassword(password) {
  const trimmed = password?.trim();
  if (typeof trimmed !== 'string' || trimmed.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`REVIEW_DECRYPT_PASSWORD is missing or shorter than ${MIN_PASSWORD_LENGTH} characters`);
  }
  return trimmed;
}

/** The public key as the app holds it: the raw 32 bytes in base64url. */
export function publicKeyText(key) {
  return (key.type === 'public' ? key : createPublicKey(key)).export({ format: 'jwk' }).x;
}

export function publicKeyFromText(text) {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: text.trim() }, format: 'jwk' });
}

export function issueCertificate(privateKey, now = Date.now(), claims = {}) {
  const payload = {
    purpose: PURPOSE,
    app: APP,
    id: randomBytes(16).toString('base64url'),
    iat: now,
    exp: now + LIFETIME_DAYS * DAY_MS,
    ...claims,
  };
  const body = `${CERTIFICATE_PREFIX}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${body}.${sign(null, Buffer.from(body, 'ascii'), privateKey).toString('base64url')}`;
}

/** The claims of a certificate, or an Error saying what is wrong with it. Same rules as the app. */
export function verifyCertificate(certificate, publicKey, now = Date.now()) {
  const parts = certificate.split('.');
  if (parts.length !== 3 || parts[0] !== CERTIFICATE_PREFIX) throw new Error('not a certificate');
  const signature = Buffer.from(parts[2], 'base64url');
  if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), publicKey, signature)) throw new Error('bad signature');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (claims.purpose !== PURPOSE) throw new Error('wrong purpose');
  if (claims.app !== APP) throw new Error('wrong app');
  if (!(claims.exp > now)) throw new Error('expired');
  return claims;
}

/** A fresh salt and nonce every time, so each rotation is unrelated to the last one. */
export async function encryptEnvelope(plaintext, password, iterations = KDF_ITERATIONS) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const saltText = bytesToBase64(salt);
  const key = await deriveKey(password, salt, iterations, ['encrypt']);
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(iterations, saltText) },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope = {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: saltText },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    data: bytesToBase64(new Uint8Array(data)),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function utcDay(time) {
  return Math.floor(time / DAY_MS);
}

/**
 * Whether the published certificate is due for replacement. Whole UTC days are compared, so a daily
 * job that starts a few hours late or early still rotates on the same day.
 */
export function rotationDue(metadata, now = Date.now()) {
  const updated = Date.parse(metadata?.updatedAt);
  if (Number.isNaN(updated)) return true;
  return utcDay(now) - utcDay(updated) >= ROTATE_AFTER_DAYS;
}

/** license.enc and license.json for a new certificate. */
export async function buildRelease(privateKey, password, now = Date.now()) {
  const certificate = issueCertificate(privateKey, now);
  const envelope = await encryptEnvelope(certificate, password);
  const metadata = {
    format: METADATA_FORMAT,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LIFETIME_DAYS * DAY_MS).toISOString(),
    nextRotationOn: new Date((utcDay(now) + ROTATE_AFTER_DAYS) * DAY_MS).toISOString().slice(0, 10),
    sha256: sha256(envelope),
  };
  return { certificate, envelope, metadata: `${JSON.stringify(metadata, null, 2)}\n` };
}

/** Decrypts and verifies what is published; throws unless every check passes. */
export async function checkPublished(envelopeText, metadataText, password, publicKey, now = Date.now()) {
  const metadata = JSON.parse(metadataText);
  if (metadata.format !== METADATA_FORMAT) throw new Error('license.json is not review metadata');
  if (metadata.sha256 !== sha256(envelopeText)) throw new Error('license.json does not match license.enc');
  if (CERTIFICATE_PATTERN.test(envelopeText) || CERTIFICATE_PATTERN.test(metadataText)) {
    throw new Error('a certificate is readable in the published files');
  }
  const certificate = await decryptEnvelope(parseEnvelope(envelopeText), password);
  const claims = verifyCertificate(certificate, publicKey, now);
  if (new Date(claims.exp).toISOString() !== metadata.expiresAt) throw new Error('license.json states another expiry');
  return metadata;
}
