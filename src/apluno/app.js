(function initAplunoSite() {
  'use strict';

  document.documentElement.classList.add('js');

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

    initLauncher();

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

  function initLauncher() {
    var list = document.getElementById('apluno-launcher-list');
    var input = document.getElementById('apluno-search-input');
    if (!list || !input) return;

    var maxResults = 12;
    var activeCategory = 'all';
    var data = window.APLUNO_TOOLS || { tools: [], categories: [], popular: [] };
    var chips = document.querySelector('[data-launcher-chips]');
    var clearBtn = document.querySelector('[data-launcher-clear]');
    var form = document.getElementById('apluno-launcher-search');
    var emptyEl = document.querySelector('[data-launcher-empty]');
    var statusEl = document.querySelector('[data-launcher-status]');
    var allLink = document.querySelector('[data-launcher-all]');
    var moreBtn = document.querySelector('[data-launcher-more]');
    var moreWrap = document.querySelector('.apluno-chips-more');

    var catLabelById = {};
    var catHrefById = {};
    var toolBySlug = {};
    (data.categories || []).forEach(function (cat) {
      catLabelById[cat.id] = cat.label || cat.id;
      catHrefById[cat.id] = cat.href || '';
    });
    (data.tools || []).forEach(function (tool) { toolBySlug[tool.slug] = tool; });

    if (window.ToolistoSearch && data.tools && data.tools.length) {
      window.ToolistoSearch.buildIndexFromData(data.tools);
    }

    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatLabel(tool) {
      var parts = [];
      if (tool.inputFmt) parts.push(String(tool.inputFmt).toUpperCase());
      if (tool.outputFmt && tool.outputFmt !== tool.inputFmt) parts.push('→ ' + String(tool.outputFmt).toUpperCase());
      return parts.join(' ');
    }

    function renderItems(items, total) {
      var html = items.map(function (tool) {
        var href = tool.href || ('/' + (tool.slug || ''));
        var catLabel = catLabelById[tool.category] || tool.category || '';
        var fmt = formatLabel(tool);
        return '<li><a class="apluno-launcher-result" href="' + esc(href) + '">'
          + '<span class="apluno-launcher-result-name">' + esc(tool.name) + '</span>'
          + (tool.summary || tool.desc ? '<span class="apluno-launcher-result-desc">' + esc(tool.summary || tool.desc) + '</span>' : '')
          + '<span class="apluno-launcher-result-meta">' + esc(catLabel) + (fmt ? ' · ' + esc(fmt) : '') + '</span>'
          + '</a></li>';
      }).join('');
      list.innerHTML = html;
      if (emptyEl) emptyEl.hidden = items.length > 0;
      if (statusEl) statusEl.textContent = items.length ? (items.length + ' herramientas coincidentes') : '';
      if (allLink) {
        var href = '/toolisto';
        var label = 'Ver todas las ' + (total || data.tools.length) + ' herramientas';
        if (activeCategory !== 'all' && catHrefById[activeCategory]) {
          href = catHrefById[activeCategory];
          label = 'Ver las ' + (total || 0) + ' herramientas de esta categoría';
        }
        allLink.innerHTML = '<a href="' + esc(href) + '">' + esc(label) + '</a>';
      }
    }

    function toolsOfCategory(category) {
      return data.tools.filter(function (tool) { return tool.category === category; });
    }

    function run(query) {
      var q = (query || '').trim();
      if (q.length >= 2 && window.ToolistoSearch) {
        var hits = window.ToolistoSearch.search(q, maxResults).filter(function (hit) {
          return activeCategory === 'all' || hit.category === activeCategory;
        });
        renderItems(hits, hits.length);
      } else if (activeCategory !== 'all') {
        var catTools = toolsOfCategory(activeCategory);
        renderItems(catTools.slice(0, maxResults), catTools.length);
      } else {
        var popular = [];
        (data.popular || []).forEach(function (slug) {
          var tool = toolBySlug[slug];
          if (tool) popular.push(tool);
        });
        renderItems(popular.slice(0, maxResults), data.tools.length);
      }
      if (clearBtn) clearBtn.hidden = q.length === 0;
    }

    function setCategory(id) {
      activeCategory = id;
      if (chips) {
        chips.querySelectorAll('[data-launcher-category]').forEach(function (btn) {
          var on = btn.getAttribute('data-launcher-category') === id;
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-pressed', String(on));
        });
      }
      run(input.value);
    }

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var q = (input.value || '').trim();
        var first = list.querySelector('a.apluno-launcher-result');
        if (q && first) {
          window.location.href = first.getAttribute('href');
          return;
        }
        window.location.href = '/toolisto';
      });
    }

    input.addEventListener('input', function () { run(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        input.value = '';
        run('');
        input.blur();
      } else if (event.key === 'ArrowDown') {
        var firstLink = list.querySelector('a.apluno-launcher-result');
        if (firstLink) {
          event.preventDefault();
          firstLink.focus();
        }
      }
    });

    list.addEventListener('keydown', function (event) {
      var links = Array.from(list.querySelectorAll('a.apluno-launcher-result'));
      var currIdx = links.indexOf(document.activeElement);
      if (currIdx === -1) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        var nextIdx = (currIdx + 1) % links.length;
        links[nextIdx].focus();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (currIdx === 0) {
          input.focus();
        } else {
          links[currIdx - 1].focus();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.focus();
      }
    });

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.focus();
        input.select();
      }
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        run('');
        input.focus();
      });
    }
    if (chips) {
      chips.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-launcher-category]');
        if (btn) setCategory(btn.getAttribute('data-launcher-category'));
      });
    }
    if (moreBtn && moreWrap) {
      moreBtn.addEventListener('click', function () {
        var open = moreBtn.getAttribute('aria-expanded') !== 'true';
        moreBtn.setAttribute('aria-expanded', String(open));
        moreBtn.setAttribute('aria-label', open ? 'Ver menos categorías' : 'Ver más categorías');
        moreBtn.textContent = open ? 'Menos' : 'Más';
        moreWrap.hidden = !open;
      });
    }

    run('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}());
