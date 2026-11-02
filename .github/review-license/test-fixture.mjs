// Writes license.enc and license.json for the browser test, with a key made on the spot.
// Usage: node test-fixture.mjs <folder> <password> [age in days]
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRelease } from './lib.mjs';

const [folder, password, age = '0'] = process.argv.slice(2);
const { privateKey } = generateKeyPairSync('ed25519');
const release = await buildRelease(privateKey, password, Date.now() - Number(age) * 86_400_000);
writeFileSync(join(folder, 'license.enc'), release.envelope);
writeFileSync(join(folder, 'license.json'), release.metadata);
console.log(release.certificate);
