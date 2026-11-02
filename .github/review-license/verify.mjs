// Fetches the certificate from the public address, decrypts it and checks its signature, the way a
// reviewer and the app would. With --expect-sha256 it waits for that exact file to be deployed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkPublished, loadPassword, publicKeyFromText, sha256 } from './lib.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://lyrels.github.io/flitdo/review/' },
    'expect-sha256': { type: 'string' },
    'timeout-seconds': { type: 'string', default: '600' },
  },
});

const here = dirname(fileURLToPath(import.meta.url));
const publicKey = publicKeyFromText(readFileSync(join(here, 'public-key.txt'), 'utf8'));
const password = loadPassword(process.env.REVIEW_DECRYPT_PASSWORD);
const base = values.url.endsWith('/') ? values.url : `${values.url}/`;
const deadline = Date.now() + Number(values['timeout-seconds']) * 1000;

async function fetchLatest(name) {
  const response = await fetch(`${base}${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.text();
}

for (;;) {
  try {
    const envelope = await fetchLatest('license.enc');
    const metadata = await fetchLatest('license.json');
    const wanted = values['expect-sha256'];
    if (wanted && sha256(envelope) !== wanted) throw new Error('the new certificate is not deployed yet');
    const checked = await checkPublished(envelope, metadata, password, publicKey);
    console.log(`Public certificate verified: updated ${checked.updatedAt}, expires ${checked.expiresAt}.`);
    break;
  } catch (error) {
    if (Date.now() >= deadline) {
      console.error(`Public certificate check failed: ${error.message}`);
      process.exit(1);
    }
    console.log(`Waiting: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}
