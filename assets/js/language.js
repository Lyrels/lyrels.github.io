(function () {
  var key = 'lyrels-site-lang';
  var root = document.documentElement;
  var staticPage = root.hasAttribute('data-static-lang');

  function language(tag) {
    if (!tag) return null;
    if (/^zh(?:-(?:Hant|TW|HK|MO))\b/i.test(tag)) return 'zh-TW';
    if (/^zh(?:-|$)/i.test(tag)) return 'zh-CN';
    var base = tag.toLowerCase().split('-')[0];
    return ['en', 'ja', 'ko'].indexOf(base) === -1 ? null : base;
  }

  function remember(value) {
    try { localStorage.setItem(key, value); } catch (e) { /* Static language links still work. */ }
  }

  var explicit = language(new URLSearchParams(location.search).get('lang'));
  var oldChineseAnchor = staticPage && /^#zh-/.test(location.hash);
  var preferred = staticPage && root.lang !== 'en' ? root.lang : explicit;
  if (!preferred && oldChineseAnchor) preferred = 'zh-CN';
  if (!preferred) {
    try {
      preferred = language(localStorage.getItem(key) || localStorage.getItem('flitdo-privacy-lang') || localStorage.getItem('lyrels-lang'));
    } catch (e) { /* Use the browser language. */ }
  }
  if (!preferred) {
    preferred = (navigator.languages || [navigator.language]).map(language).find(Boolean) || 'en';
  }
  if (explicit || (staticPage && root.lang !== 'en')) remember(preferred);

  if (staticPage && root.lang === 'en') {
    var anchor = location.hash.replace(/^#zh-/, '#');
    if (preferred !== 'en') {
      location.replace('./' + preferred + '/' + anchor);
      return;
    }
    if (oldChineseAnchor) location.replace(anchor);
  }

  var code = preferred === 'zh-CN' ? 'zh' : preferred.toLowerCase();
  if (!staticPage) {
    root.lang = preferred;
    root.setAttribute('data-lang', code);
    var title = document.querySelector('meta[name="title-' + code + '"]');
    if (title) document.title = title.content;
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!staticPage) {
      ['aria-label', 'alt'].forEach(function (attribute) {
        var localized = 'data-' + attribute + '-' + code;
        document.querySelectorAll('[' + localized + ']').forEach(function (element) {
          element.setAttribute(attribute, element.getAttribute(localized));
        });
      });
      var current = document.querySelector('.policy-languages a[hreflang="' + preferred + '"]');
      if (current) current.setAttribute('aria-current', 'page');
    }
    var menu = document.querySelector('.policy-language-menu');
    if (!menu) return;
    document.addEventListener('click', function (event) {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener('keydown', function (event) {
      if (menu.open && event.key === 'Escape') {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  });
})();
