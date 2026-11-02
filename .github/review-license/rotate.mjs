// Replaces flitdo/review/license.enc and license.json when a rotation is due, or with --force.
// Prints nothing secret, and the certificate never reaches a file in the clear.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRelease,
  checkPublished,
  loadPassword,
  loadPrivateKey,
  publicKeyFromText,
  publicKeyText,
  rotationDue,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..', '..', 'flitdo', 'review');
const envelopePath = join(site, 'license.enc');
const metadataPath = join(site, 'license.json');

function output(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
}

function currentMetadata() {
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

const metadata = currentMetadata();
if (!process.argv.includes('--force') && !rotationDue(metadata)) {
  console.log(`Not due: updated ${metadata.updatedAt}, next rotation on ${metadata.nextRotationOn}.`);
  output({ changed: 'false', sha256: metadata.sha256 });
  process.exit(0);
}

const privateKey = loadPrivateKey(process.env.REVIEW_SIGNING_PRIVATE_KEY);
const password = loadPassword(process.env.REVIEW_DECRYPT_PASSWORD);
const expected = readFileSync(join(here, 'public-key.txt'), 'utf8').trim();
if (publicKeyText(privateKey) !== expected) {
  throw new Error('REVIEW_SIGNING_PRIVATE_KEY does not match public-key.txt: the app would refuse its certificates');
}

const release = await buildRelease(privateKey, password);
await checkPublished(release.envelope, release.metadata, password, publicKeyFromText(expected));
writeFileSync(envelopePath, release.envelope);
writeFileSync(metadataPath, release.metadata);

const written = JSON.parse(release.metadata);
console.log(`Rotated: updated ${written.updatedAt}, expires ${written.expiresAt}.`);
output({ changed: 'true', sha256: written.sha256 });
