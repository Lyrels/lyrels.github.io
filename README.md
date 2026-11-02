# lyrels.github.io

The official website of **Lyrels**, served by GitHub Pages at <https://lyrels.github.io/>.

| Page | URL | Source |
|---|---|---|
| Brand home | <https://lyrels.github.io/> | `index.html` |
| Flitdo product page | <https://lyrels.github.io/flitdo/> | `flitdo/index.html` |
| Flitdo privacy policy (used in Google Play Console) | <https://lyrels.github.io/flitdo/privacy/> | `flitdo/privacy/index.html` |
| Flitdo review access (Google Play reviewers only, not indexed) | <https://lyrels.github.io/flitdo/review/> | `flitdo/review/`, see [`.github/review-license/README.md`](.github/review-license/README.md) |
| Not found | any other path | `404.html` |

Plain static HTML and CSS — no build step, no frameworks, no external requests (no web fonts, CDNs,
cookies or analytics). `.nojekyll` tells GitHub Pages to publish the files as they are.

## Languages
Every page is bilingual (English and Simplified Chinese). Text comes in pairs:
`<span class="en">…</span><span class="zh">…</span>`; the `data-lang` attribute on `<html>` decides
which one shows. The language is picked from `?lang=en|zh`, then the visitor's saved choice, then the
browser language. Without JavaScript the English text is shown.

## Structure
```
index.html                 brand home
flitdo/index.html          Flitdo product page
flitdo/privacy/index.html  Flitdo privacy policy (EN + 简体中文)
flitdo/review/             review access: decrypting page and the encrypted certificate
404.html
assets/css/site.css        all styles; colours mirror the Flitdo app palette
assets/js/site.js          language toggle, header hairline, table-of-contents highlight
assets/img/                Lyrels avatar (JPEG/PNG sizes); Flitdo icon (SVG, 512 px PNG for Play, touch icon)
robots.txt, sitemap.xml
```

## Preview locally
```bash
python -m http.server 8080
```
Then open <http://localhost:8080/>. Paths are root-relative (`/assets/...`), so open the site through a
server rather than as a file.

## Deploy
Push to `main`. GitHub Pages publishes the repository root of the default branch
(Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`).

## Updating the privacy policy
Edit both language versions in `flitdo/privacy/index.html` and change the **Last updated** date
(both languages) and `<lastmod>` in `sitemap.xml`. Update the policy **before** shipping an app
version that changes how data is handled — for example adding network access, in-app purchases,
analytics or crash reporting — and update the Data safety form in Play Console to match.
