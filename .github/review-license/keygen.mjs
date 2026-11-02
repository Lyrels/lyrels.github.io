// First-time setup: makes the signing key and the decryption password. Run once, on your own machine:
//
//   node .github/review-license/keygen.mjs <folder outside any repository>
//
// It writes three files to that folder and refuses to replace any of them. The private key and the
// password are never printed. See README.md for what to do with them.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { publicKeyText } from './lib.mjs';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node keygen.mjs <folder outside any repository>');
  process.exit(2);
}

const target = resolve(folder);
const paths = {
  privateKey: join(target, 'review-signing-private-key.txt'),
  password: join(target, 'review-decrypt-password.txt'),
  publicKey: join(target, 'review-public-key.txt'),
};
const taken = Object.values(paths).filter(existsSync);
if (taken.length > 0) {
  console.error(`Refusing to replace ${taken.join(', ')}. The signing key must never change.`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
const { privateKey } = generateKeyPairSync('ed25519');
const publicKey = publicKeyText(privateKey);
writeFileSync(paths.privateKey, `${privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')}\n`, { mode: 0o600 });
writeFileSync(paths.password, `${randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
writeFileSync(paths.publicKey, `${publicKey}\n`);

console.log(`Written to ${target}`);
console.log(`Public key: ${publicKey}`);
