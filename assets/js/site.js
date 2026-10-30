// Lyrels — small progressive enhancements. Pages work without this file (English is shown).
(function () {
  var root = document.documentElement;
  var KEY = 'lyrels-lang';

  function setLang(lang, remember) {
    root.setAttribute('data-lang', lang);
    root.lang = lang === 'zh' ? 'zh-CN' : 'en';
    var title = document.querySelector('meta[name="title-' + lang + '"]');
    if (title) document.title = title.content;
    var btn = document.querySelector('.lang-toggle');
    if (btn) {
      btn.textContent = lang === 'zh' ? 'EN' : '中文';
      btn.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换到中文');
    }
    if (remember) {
      try { localStorage.setItem(KEY, lang); } catch (e) { /* storage unavailable: choice lasts this page */ }
    }
  }

  setLang(root.getAttribute('data-lang') === 'zh' ? 'zh' : 'en', false);

  var toggle = document.querySelector('.lang-toggle');
  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', function () {
      setLang(root.getAttribute('data-lang') === 'zh' ? 'en' : 'zh', true);
    });
  }

  // Header hairline once the page scrolls.
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 4); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Highlight the current section in a document's table of contents.
  var links = document.querySelectorAll('.toc a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('active'); });
        var link = byId[entry.target.id];
        if (link) link.classList.add('active');
      });
    }, { rootMargin: '-90px 0px -70% 0px' });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) observer.observe(el);
    });
  }

  var year = document.querySelectorAll('[data-year]');
  year.forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
