import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EnvelopeError,
  base64ToBytes,
  bytesToBase64,
  decryptEnvelope,
  parseEnvelope,
  readCertificate,
} from '../../../flitdo/review/envelope.mjs';
import {
  CERTIFICATE_PATTERN,
  buildRelease,
  checkPublished,
  encryptEnvelope,
  issueCertificate,
  loadPassword,
  loadPrivateKey,
  publicKeyFromText,
  publicKeyText,
  rotationDue,
  sha256,
  verifyCertificate,
} from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '..', '..', '..');
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2, 12);
const PASSWORD = 'correct-horse-battery-staple-0123456789';
// Few iterations: these tests are about the format, not the cost of an attack.
const FAST = 100_000;

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function rejects(kind) {
  return (error) => error instanceof EnvelopeError && error.kind === kind;
}

/** The same envelope with one base64 field changed by one bit. */
function flipped(envelopeText, read, write) {
  const envelope = JSON.parse(envelopeText);
  const bytes = base64ToBytes(read(envelope));
  bytes[bytes.length - 1] ^= 1;
  write(envelope, bytesToBase64(bytes));
  return envelope;
}

describe('certificate', () => {
  it('verifies, and states the 30 days it was issued for', () => {
    const claims = verifyCertificate(issueCertificate(privateKey, NOW), publicKey, NOW);
    assert.equal(claims.exp - claims.iat, 30 * DAY);
    assert.equal(claims.purpose, 'flitdo-pro-play-review');
    assert.equal(claims.app, 'com.lyrels.flitdo');
  });

  it('has a different id every time', () => {
    assert.notEqual(issueCertificate(privateKey, NOW), issueCertificate(privateKey, NOW));
  });

  it('refuses a forged signature', () => {
    const other = generateKeyPairSync('ed25519').privateKey;
    assert.throws(() => verifyCertificate(issueCertificate(other, NOW), publicKey, NOW), /bad signature/);
  });

  it('refuses changed claims under the original signature', () => {
    const [prefix, payload, signature] = issueCertificate(privateKey, NOW).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    claims.exp += 365 * DAY;
    const changed = Buffer.from(JSON.stringify(claims)).toString('base64url');
    assert.throws(() => verifyCertificate(`${prefix}.${changed}.${signature}`, publicKey, NOW), /bad signature/);
  });

  it('refuses another purpose, another app and an expired certificate', () => {
    assert.throws(() => verifyCertificate(issueCertificate(privateKey, NOW, { purpose: 'x' }), publicKey, NOW), /wrong purpose/);
    assert.throws(() => verifyCertificate(issueCertificate(privateKey, NOW, { app: 'x' }), publicKey, NOW), /wrong app/);
    const certificate = issueCertificate(privateKey, NOW);
    assert.ok(verifyCertificate(certificate, publicKey, NOW + 30 * DAY - 1));
    assert.throws(() => verifyCertificate(certificate, publicKey, NOW + 30 * DAY), /expired/);
  });

  it('gives the dates the page shows', () => {
    const { issuedAt, expiresAt } = readCertificate(issueCertificate(privateKey, NOW));
    assert.equal(issuedAt.getTime(), NOW);
    assert.equal(expiresAt.getTime(), NOW + 30 * DAY);
    assert.throws(() => readCertificate('nonsense'), rejects('damaged'));
    assert.throws(() => readCertificate('FLITDO-REVIEW-1.%%%.abc'), rejects('damaged'));
  });

  it('keeps the public key in the form the app reads', () => {
    const text = publicKeyText(publicKey);
    assert.match(text, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(publicKeyText(publicKeyFromText(`${text}\n`)), text);
  });
});

describe('envelope', () => {
  const certificate = issueCertificate(privateKey, NOW);

  it('opens with the right password and uses the working parameters by default', async () => {
    const text = await encryptEnvelope(certificate, PASSWORD);
    const envelope = parseEnvelope(text);
    assert.equal(await decryptEnvelope(envelope, PASSWORD), certificate);
    assert.equal(envelope.kdf.iterations, 600_000);
    assert.equal(base64ToBytes(envelope.kdf.salt).length, 16);
    assert.equal(base64ToBytes(envelope.cipher.iv).length, 12);
  });

  it('refuses a wrong password', async () => {
    const envelope = parseEnvelope(await encryptEnvelope(certificate, PASSWORD, FAST));
    await assert.rejects(decryptEnvelope(envelope, `${PASSWORD}x`), rejects('password'));
  });

  it('refuses a changed ciphertext, nonce or salt', async () => {
    const text = await encryptEnvelope(certificate, PASSWORD, FAST);
    const cases = [
      flipped(text, (e) => e.data, (e, value) => { e.data = value; }),
      flipped(text, (e) => e.cipher.iv, (e, value) => { e.cipher.iv = value; }),
      flipped(text, (e) => e.kdf.salt, (e, value) => { e.kdf.salt = value; }),
    ];
    for (const envelope of cases) await assert.rejects(decryptEnvelope(envelope, PASSWORD), rejects('password'));
  });

  it('authenticates the iteration count', async () => {
    const envelope = JSON.parse(await encryptEnvelope(certificate, PASSWORD, FAST));
    envelope.kdf.iterations += 1;
    await assert.rejects(decryptEnvelope(envelope, PASSWORD), rejects('password'));
  });

  it('calls anything that is not an envelope damaged', async () => {
    for (const text of ['', 'not json', '[]', 'null', '{"format":"other"}']) {
      assert.throws(() => parseEnvelope(text), rejects('damaged'));
    }
    const envelope = JSON.parse(await encryptEnvelope(certificate, PASSWORD, FAST));
    assert.throws(() => parseEnvelope(JSON.stringify({ ...envelope, version: 2 })), rejects('damaged'));
    assert.throws(() => parseEnvelope(JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, iterations: 1 } })), rejects('damaged'));
    await assert.rejects(decryptEnvelope({ ...envelope, data: '***' }, PASSWORD), rejects('damaged'));
  });

  it('never repeats a salt or nonce', async () => {
    const first = JSON.parse(await encryptEnvelope(certificate, PASSWORD, FAST));
    const second = JSON.parse(await encryptEnvelope(certificate, PASSWORD, FAST));
    assert.notEqual(first.kdf.salt, second.kdf.salt);
    assert.notEqual(first.cipher.iv, second.cipher.iv);
    assert.notEqual(first.data, second.data);
  });
});

describe('rotation', () => {
  const updatedAt = (time) => ({ updatedAt: new Date(time).toISOString() });

  it('is due when nothing has been published', () => {
    assert.equal(rotationDue(null, NOW), true);
    assert.equal(rotationDue({}, NOW), true);
    assert.equal(rotationDue({ updatedAt: 'nonsense' }, NOW), true);
  });

  it('waits 15 days', () => {
    assert.equal(rotationDue(updatedAt(NOW), NOW), false);
    assert.equal(rotationDue(updatedAt(NOW), NOW + 14 * DAY), false);
    assert.equal(rotationDue(updatedAt(NOW), NOW + 15 * DAY), true);
  });

  it('counts days, so a run a few hours early still rotates', () => {
    assert.equal(rotationDue(updatedAt(NOW), NOW + 15 * DAY - 6 * 3_600_000), true);
  });

  it('catches up after days of missed runs', () => {
    assert.equal(rotationDue(updatedAt(NOW), NOW + 22 * DAY), true);
  });
});

describe('release', () => {
  it('passes the check it runs on itself', async () => {
    const release = await buildRelease(privateKey, PASSWORD, NOW);
    const metadata = await checkPublished(release.envelope, release.metadata, PASSWORD, publicKey, NOW);
    assert.equal(metadata.sha256, sha256(release.envelope));
    assert.equal(metadata.updatedAt, new Date(NOW).toISOString());
    assert.equal(metadata.expiresAt, new Date(NOW + 30 * DAY).toISOString());
    assert.equal(metadata.nextRotationOn, '2026-11-17');
  });

  it('shows neither the certificate nor the password', async () => {
    const release = await buildRelease(privateKey, PASSWORD, NOW);
    for (const published of [release.envelope, release.metadata]) {
      assert.ok(!CERTIFICATE_PATTERN.test(published));
      assert.ok(!published.includes(release.certificate));
      assert.ok(!published.includes(PASSWORD));
    }
  });

  it('fails the public check on a wrong password, a stale pair or a forged key', async () => {
    const release = await buildRelease(privateKey, PASSWORD, NOW);
    await assert.rejects(checkPublished(release.envelope, release.metadata, `${PASSWORD}x`, publicKey, NOW), rejects('password'));
    const older = await buildRelease(privateKey, PASSWORD, NOW);
    await assert.rejects(checkPublished(release.envelope, older.metadata, PASSWORD, publicKey, NOW), /does not match/);
    const other = generateKeyPairSync('ed25519').publicKey;
    await assert.rejects(checkPublished(release.envelope, release.metadata, PASSWORD, other, NOW), /bad signature/);
  });

  it('fails the public check once the certificate has expired', async () => {
    const release = await buildRelease(privateKey, PASSWORD, NOW);
    await assert.rejects(checkPublished(release.envelope, release.metadata, PASSWORD, publicKey, NOW + 31 * DAY), /expired/);
  });

  it('refuses a missing or weak secret', () => {
    assert.throws(() => loadPrivateKey(undefined), /REVIEW_SIGNING_PRIVATE_KEY/);
    assert.throws(() => loadPrivateKey('AAAA'), /REVIEW_SIGNING_PRIVATE_KEY/);
    assert.throws(() => loadPassword(undefined), /REVIEW_DECRYPT_PASSWORD/);
    assert.throws(() => loadPassword('short'), /REVIEW_DECRYPT_PASSWORD/);
    assert.equal(loadPassword(`  ${PASSWORD}
`), PASSWORD);
    const der = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    assert.equal(publicKeyText(loadPrivateKey(der)), publicKeyText(publicKey));
  });
});

describe('keygen', () => {
  it('writes the three files, prints no secret and refuses to run twice', () => {
    const folder = mkdtempSync(join(tmpdir(), 'review-keygen-'));
    try {
      const script = join(here, '..', 'keygen.mjs');
      const printed = execFileSync(process.execPath, [script, folder], { encoding: 'utf8' });
      const privateText = readFileSync(join(folder, 'review-signing-private-key.txt'), 'utf8').trim();
      const password = readFileSync(join(folder, 'review-decrypt-password.txt'), 'utf8').trim();
      const publicText = readFileSync(join(folder, 'review-public-key.txt'), 'utf8').trim();
      assert.equal(publicKeyText(loadPrivateKey(privateText)), publicText);
      assert.equal(loadPassword(password), password);
      assert.ok(password.length >= 43);
      assert.ok(!printed.includes(privateText));
      assert.ok(!printed.includes(password));
      assert.throws(() => execFileSync(process.execPath, [script, folder], { stdio: 'pipe' }));
      assert.equal(readFileSync(join(folder, 'review-decrypt-password.txt'), 'utf8').trim(), password);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('repository', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
  const published = tracked.filter((path) => !path.startsWith('.github/'));
  const read = (path) => readFileSync(join(repository, path)).toString('latin1');

  it('publishes the decrypting code only', () => {
    const page = read('flitdo/review/index.html') + read('flitdo/review/review.mjs') + read('flitdo/review/envelope.mjs');
    for (const forbidden of ['encrypt(', 'sign(', 'PRIVATE KEY', 'localStorage', 'sessionStorage', 'document.cookie']) {
      assert.ok(!page.includes(forbidden), forbidden);
    }
  });

  it('holds no certificate, private key or configured secret', () => {
    const secrets = [process.env.REVIEW_DECRYPT_PASSWORD, process.env.REVIEW_SIGNING_PRIVATE_KEY].filter(Boolean);
    for (const path of tracked.filter((file) => existsSync(join(repository, file)))) {
      const text = read(path);
      assert.ok(!CERTIFICATE_PATTERN.test(text), `a certificate in ${path}`);
      if (path !== '.github/review-license/test/license.test.mjs') assert.ok(!text.includes('BEGIN PRIVATE KEY'), `a key in ${path}`);
      for (const secret of secrets) assert.ok(!text.includes(secret), `a secret in ${path}`);
    }
    assert.ok(published.length > 5);
  });

  it('keeps the page out of search and away from other hosts', () => {
    const page = read('flitdo/review/index.html');
    assert.match(page, /name="robots" content="noindex/);
    assert.match(page, /default-src 'none'/);
    assert.match(page, /form-action 'none'/);
    assert.match(page, /connect-src 'self'/);
    assert.ok(!/https?:\/\/(?!lyrels\.github\.io)/.test(page.replace(/<!--[\s\S]*?-->/g, '')));
    assert.ok(!read('sitemap.xml').includes('review'));
  });

  // Anything said here would be public too, so this counts steps instead of naming what must not appear.
  it('stops at getting the certificate', () => {
    const steps = read('flitdo/review/index.html').match(/<ol class="steps">([\s\S]*?)<\/ol>/)[1];
    assert.equal(steps.match(/<li>/g).length, 2);
  });

  it('fetches the latest file every time', () => {
    const script = read('flitdo/review/review.mjs');
    assert.match(script, /cache: 'no-store'/);
    assert.match(script, /license\.enc\?/);
  });
});
