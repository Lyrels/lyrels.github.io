(function () {
  var key = 'flitdo-privacy-lang';
  var locale = document.documentElement.lang;

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

  if (locale !== 'en') {
    remember(locale);
    return;
  }

  var explicit = language(new URLSearchParams(location.search).get('lang'));
  var oldChineseAnchor = /^#zh-/.test(location.hash);
  var preferred = explicit || (oldChineseAnchor ? 'zh-CN' : null);
  if (!preferred) {
    try { preferred = language(localStorage.getItem(key) || localStorage.getItem('lyrels-lang')); } catch (e) { /* Use the browser language. */ }
  }
  if (!preferred) {
    preferred = (navigator.languages || [navigator.language]).map(language).find(Boolean);
  }
  if (explicit) remember(explicit);

  var anchor = location.hash.replace(/^#zh-/, '#');
  if (preferred && preferred !== 'en') {
    location.replace('./' + preferred + '/' + anchor);
  } else if (oldChineseAnchor) {
    location.replace(anchor);
  }
})();
