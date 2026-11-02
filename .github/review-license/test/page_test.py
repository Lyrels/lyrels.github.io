"""The review page in a real browser. Needs Python Playwright with Chromium; run it on its own:

    python .github/review-license/test/page_test.py
"""
import http.server
import json
import pathlib
import shutil
import subprocess
import tempfile
import threading
from functools import partial

from playwright.sync_api import expect, sync_playwright

REPOSITORY = pathlib.Path(__file__).resolve().parents[3]
TOOLS = REPOSITORY / '.github' / 'review-license'
PASSWORD = 'a-password-for-this-test-only-0123456789'


class Quiet(http.server.SimpleHTTPRequestHandler):
    # As GitHub Pages serves it; a Windows registry can say otherwise.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript'}

    def log_message(self, *args):
        pass


def issue(folder, age_days=0):
    command = ['node', str(TOOLS / 'test-fixture.mjs'), str(folder), PASSWORD, str(age_days)]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()


def corrupted(text):
    envelope = json.loads(text)
    flipped = 'A' if envelope['data'][0] != 'A' else 'B'
    envelope['data'] = flipped + envelope['data'][1:]
    return json.dumps(envelope)


def main():
    root = pathlib.Path(tempfile.mkdtemp(prefix='review-page-'))
    site = root / 'flitdo' / 'review'
    shutil.copytree(REPOSITORY / 'flitdo' / 'review', site)
    shutil.copytree(REPOSITORY / 'assets', root / 'assets')
    certificate = issue(site)

    handler = partial(Quiet, directory=str(root))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_address[1]}'
    page_url = f'{origin}/flitdo/review/'

    passed = []

    def check(name):
        passed.append(name)
        print(f'ok - {name}')

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(permissions=['clipboard-read', 'clipboard-write'])
            page = context.new_page()
            requests, console_errors = [], []
            page.on('request', lambda request: requests.append(request))
            page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            page.on('pageerror', lambda error: console_errors.append(str(error)))

            status = page.locator('#status')
            password = page.locator('#password')
            result = page.locator('#result')

            page.goto(page_url)
            expect(status).to_have_text('The latest certificate is ready to decrypt.')
            expect(result).to_be_hidden()
            first = [r.url for r in requests if 'license.enc' in r.url]
            page.reload()
            expect(status).to_have_text('The latest certificate is ready to decrypt.')
            fetched = [r.url for r in requests if 'license.enc' in r.url]
            assert len(fetched) > len(first), 'every opening fetches the ciphertext'
            assert len(set(fetched)) == len(fetched), 'every fetch has its own address, so no cache can answer'
            check('fetches the ciphertext on every opening, past any cache')

            password.fill(PASSWORD + 'x')
            page.locator('#decrypt').click()
            expect(status).to_have_text('Could not decrypt. Check the password and try again.')
            expect(result).to_be_hidden()
            check('wrong password shows no certificate')

            password.fill(f'  {PASSWORD}\n'.strip('\n'))
            page.locator('#decrypt').click()
            expect(status).to_have_text('Certificate decrypted.')
            expect(page.locator('#certificate')).to_have_value(certificate)
            expect(page.locator('#updated')).to_contain_text('UTC')
            expect(page.locator('#expires')).to_contain_text('UTC')
            expect(page.locator('#expired')).to_be_hidden()
            expect(password).to_have_value('')
            check('right password shows the certificate and dates and empties the field')

            page.locator('#copy').click()
            expect(status).to_have_text('Certificate copied.')
            assert page.evaluate('navigator.clipboard.readText()') == certificate
            check('one click copies the certificate')

            kept = page.evaluate('''() => ({
                local: Object.keys(localStorage).length,
                session: Object.keys(sessionStorage).length,
                cookie: document.cookie,
            })''')
            assert kept == {'local': 0, 'session': 0, 'cookie': ''}, kept
            assert context.cookies() == []
            for request in requests:
                assert request.url.startswith(origin), f'left the site: {request.url}'
                assert request.method == 'GET', f'{request.method} {request.url}'
                assert PASSWORD not in request.url
            check('stores nothing, sends nothing, stays on the site')

            newest = issue(site)
            assert newest != certificate
            page.reload()
            password.fill(PASSWORD)
            page.locator('#decrypt').click()
            expect(page.locator('#certificate')).to_have_value(newest)
            check('a rotated file is what the next opening gets')

            def serve(handler_fn):
                page.route('**/license.enc*', handler_fn)
                page.reload()

            text = (site / 'license.enc').read_text()
            serve(lambda route: route.fulfill(status=200, body=corrupted(text)))
            password.fill(PASSWORD)
            page.locator('#decrypt').click()
            expect(status).to_have_text('Could not decrypt. Check the password and try again.')
            expect(result).to_be_hidden()
            page.unroute('**/license.enc*')
            check('a changed ciphertext shows no certificate')

            serve(lambda route: route.fulfill(status=200, body='<html>not the file</html>'))
            expect(status).to_have_text('The certificate file is damaged. Reload this page in a few minutes.')
            page.unroute('**/license.enc*')
            check('a file that is not an envelope is called damaged')

            serve(lambda route: route.fulfill(status=404, body='missing'))
            expect(status).to_have_text('The certificate file could not be loaded. Check your connection and reload this page.')
            page.unroute('**/license.enc*')
            check('a missing file is reported')

            issue(site, age_days=31)
            page.reload()
            password.fill(PASSWORD)
            page.locator('#decrypt').click()
            expect(page.locator('#expired')).to_be_visible()
            check('an expired certificate is flagged')

            issue(site)
            page.reload()
            password.fill(PASSWORD)
            page.locator('#decrypt').click()
            expect(result).to_be_visible()
            page.goto(f'{origin}/assets/css/site.css')
            page.go_back()
            expect(result).to_be_hidden()
            expect(password).to_have_value('')
            check('leaving the page clears it')

            csp = [m for m in console_errors if 'Content Security Policy' in m]
            assert not csp, csp
            check('nothing on the page breaks its security policy')

            browser.close()
    finally:
        server.shutdown()
        shutil.rmtree(root, ignore_errors=True)
    print(f'{len(passed)} checks passed')


if __name__ == '__main__':
    main()
