// Lyrels progressive enhancements shared by the public pages.
(function () {
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
