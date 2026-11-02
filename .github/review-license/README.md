# Flitdo review certificate

Google Play's reviewers need Flitdo Pro without paying. This folder issues the certificate they use,
and GitHub Actions keeps it current. The app side is in the Flitdo repository, in
`docs/PLAY_REVIEW_ACCESS.md`.

| Published on GitHub Pages | Not published (`.github` stays out of Pages) |
|---|---|
| `flitdo/review/index.html`, `review.mjs`, `envelope.mjs`, `review.css`: the page, which can only decrypt | `lib.mjs`, `rotate.mjs`, `verify.mjs`, `keygen.mjs`: issuing and checking |
| `flitdo/review/license.enc`: the certificate, encrypted | `public-key.txt`: the key the app holds |
| `flitdo/review/license.json`: dates and a hash, nothing secret | `.github/workflows/rotate-review-certificate.yml` |

**Format.** A certificate is `FLITDO-REVIEW-1.<claims>.<signature>`: base64url JSON (`purpose`, `app`,
`id`, `iat`, `exp`), signed with Ed25519 over the text before the last dot. `license.enc` holds it
encrypted with AES-256-GCM, under a key from PBKDF2-HMAC-SHA256 with 600,000 iterations and a new salt
and nonce at each rotation. The header is authenticated with the ciphertext.

## Secrets

Two repository secrets, in **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Value | Changes |
|---|---|---|
| `REVIEW_SIGNING_PRIVATE_KEY` | The content of `review-signing-private-key.txt` | Never |
| `REVIEW_DECRYPT_PASSWORD` | The content of `review-decrypt-password.txt` | Never, unless it leaks |

Both files were made once by `keygen.mjs` and are in `D:\Android\keys\flitdo-review\`, outside every
repository. To set them, paste each file's content into the web form. Or, from Git Bash after
`gh auth login`, read them from the files, so the values reach neither the screen nor the shell history:

```bash
gh secret set REVIEW_SIGNING_PRIVATE_KEY --repo Lyrels/lyrels.github.io < D:/Android/keys/flitdo-review/review-signing-private-key.txt
```

```bash
gh secret set REVIEW_DECRYPT_PASSWORD --repo Lyrels/lyrels.github.io < D:/Android/keys/flitdo-review/review-decrypt-password.txt
```

The workflow needs no other setting: it asks for `contents: write` and `pages: write` itself, and Pages
stays on *Deploy from a branch*, `main`, `/ (root)`.

**Back up both files** somewhere other than this disk, in a password manager or on an encrypted drive.
They are in no repository, and GitHub will never show a secret again. Then you can recover like this:

| Lost or leaked | What happens | What to do |
|---|---|---|
| Private key lost, with no backup | Certificates can no longer be issued, and the current one runs out within 30 days | Run `keygen.mjs` in a new folder, update `public-key.txt`, the secret and `REVIEW_PUBLIC_KEY` in the app, and release a new version of the app |
| Private key leaked | Anyone can make certificates | The same, at once. Old versions of the app keep trusting the leaked key |
| Password lost or leaked | Reviewers cannot decrypt, or anyone can | Put a new password of at least 32 characters in the secret, run the workflow, and update Play Console |

## How it runs

The workflow starts every day and for a manual run. It tests these tools, then `rotate.mjs` reads
`license.json` and issues a new certificate only when 15 whole UTC days have passed since the last one.
Counting days means a late or early start changes nothing; each certificate lasts 30 days, so 15 days of
missed runs still leave a valid one online. After a rotation it commits the two files, asks for a Pages
build, and `verify.mjs` fetches the public address until the new file is there, decrypts it and checks
its signature, purpose, app and expiry. That check also runs on days with no rotation, so the job fails
by itself if the public certificate stops working. A failed run sends GitHub's usual email.

**Run it by hand:** Actions → *Rotate review certificate* → *Run workflow*. *Force* (on by default)
issues a new certificate whether one is due or not.

The page tells a reviewer how to get the certificate and nothing more. What to do with it in the app
belongs in Play Console only, because this repository and the site are public; a test enforces that.

GitHub turns off scheduled workflows in a public repository after 60 days without activity. Rotation
commits happen every 15 days, so this should not arise. If a rotation is ever missed by weeks, check
that the workflow is enabled in the Actions tab.

## Tests

```bash
node --test .github/review-license/test/license.test.mjs
```

```bash
python .github/review-license/test/page_test.py
```

The first needs only Node and runs in the workflow. The second drives the page in Chromium and needs
Python Playwright, so it runs on a developer's machine.
