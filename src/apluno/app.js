(function initAplunoSite() {
  'use strict';

  document.documentElement.classList.add('js');

  var params = new URLSearchParams(window.location.search);
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  if (isLocal && window.location.pathname === '/workspace/' && params.get('preview') === 'internal') {
    window.location.replace('/workspace/preview.html?preview=internal');
    return;
  }

  function ready() {
    var header = document.querySelector('[data-apluno-header]');
    var menuButton = document.querySelector('[data-menu-toggle]');
    var mobileNav = document.querySelector('[data-mobile-nav]');

    function closeMenu() {
      if (!menuButton || !mobileNav) return;
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Abrir menú');
      mobileNav.hidden = true;
      document.body.classList.remove('apluno-menu-open');
      if (header) header.classList.remove('is-menu-open');
    }

    if (menuButton && mobileNav) {
      menuButton.addEventListener('click', function () {
        var willOpen = menuButton.getAttribute('aria-expanded') !== 'true';
        menuButton.setAttribute('aria-expanded', String(willOpen));
        menuButton.setAttribute('aria-label', willOpen ? 'Cerrar menú' : 'Abrir menú');
        mobileNav.hidden = !willOpen;
        document.body.classList.toggle('apluno-menu-open', willOpen);
        if (header) header.classList.toggle('is-menu-open', willOpen);
      });

      mobileNav.addEventListener('click', function (event) {
        if (event.target.closest('a')) closeMenu();
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          var wasOpen = menuButton.getAttribute('aria-expanded') === 'true';
          closeMenu();
          if (wasOpen) menuButton.focus();
        }
      });

      window.addEventListener('resize', function () {
        if (window.innerWidth > 980) closeMenu();
      });
    }

    function updateHeader() {
      if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
    }
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });

    var revealItems = Array.from(document.querySelectorAll('[data-reveal]'));
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealItems.forEach(function (item) { item.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px' });
    revealItems.forEach(function (item) { observer.observe(item); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}());
