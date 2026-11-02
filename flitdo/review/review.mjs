// The review page: fetches the latest ciphertext, decrypts it here and shows the certificate. The
// password is read from the field once and goes nowhere else.
import { EnvelopeError, decryptEnvelope, parseEnvelope, readCertificate } from './envelope.mjs';

const form = document.getElementById('unlock');
const password = document.getElementById('password');
const decrypt = document.getElementById('decrypt');
const status = document.getElementById('status');
const result = document.getElementById('result');
const certificate = document.getElementById('certificate');
const copy = document.getElementById('copy');
const updated = document.getElementById('updated');
const expires = document.getElementById('expires');
const expired = document.getElementById('expired');

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });

const MESSAGES = {
  loading: 'Loading the latest certificate…',
  loaded: 'The latest certificate is ready to decrypt.',
  unavailable: 'The certificate file could not be loaded. Check your connection and reload this page.',
  damaged: 'The certificate file is damaged. Reload this page in a few minutes.',
  password: 'Could not decrypt. Check the password and try again.',
  decrypted: 'Certificate decrypted.',
  copied: 'Certificate copied.',
  copyFailed: 'Could not copy. Select the certificate and copy it by hand.',
};

function say(message) {
  status.textContent = MESSAGES[message];
}

function clear() {
  password.value = '';
  certificate.value = '';
  result.hidden = true;
}

/** Past the browser cache and the CDN: the file is replaced every 15 days under the same name. */
async function loadLatest() {
  const response = await fetch(`license.enc?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new EnvelopeError('unavailable');
  return parseEnvelope(await response.text());
}

function failure(error) {
  return error instanceof EnvelopeError ? error.kind : 'unavailable';
}

function show(text) {
  const { issuedAt, expiresAt } = readCertificate(text);
  certificate.value = text;
  updated.textContent = `${dateFormat.format(issuedAt)} UTC`;
  expires.textContent = `${dateFormat.format(expiresAt)} UTC`;
  expired.hidden = expiresAt.getTime() > Date.now();
  result.hidden = false;
}

async function refresh() {
  say('loading');
  decrypt.disabled = true;
  try {
    await loadLatest();
    say('loaded');
  } catch (error) {
    say(failure(error));
  }
  decrypt.disabled = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  decrypt.disabled = true;
  result.hidden = true;
  try {
    show(await decryptEnvelope(await loadLatest(), password.value.trim()));
    password.value = '';
    say('decrypted');
    copy.focus();
  } catch (error) {
    say(failure(error));
  }
  decrypt.disabled = false;
});

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(certificate.value);
    say('copied');
  } catch {
    certificate.select();
    say(document.execCommand('copy') ? 'copied' : 'copyFailed');
  }
});

// On every opening, including a return through the back button.
window.addEventListener('pageshow', refresh);
window.addEventListener('pagehide', clear);
