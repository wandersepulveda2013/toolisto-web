/* Toolisto/APLUNO — DataGrid: enhanced data grid for CSV/Excel/JSON results.
 * Usage: window.ToolistoDataGrid.create(container, { headers: [], rows: [[]], searchable, sortable, maxRows })
 * Returns: { destroy(), getData(), setSearch(query), getSelectedRows() }
 */
(function () {
  'use strict';

  function create(container, opts) {
    if (!container) return null;
    var headers = opts.headers || [];
    var rows = opts.rows || [];
    var searchable = opts.searchable !== false;
    var sortable = opts.sortable !== false;
    var maxRows = opts.maxRows || 500;
    var onCellClick = opts.onCellClick || null;

    var state = {
      filteredRows: rows.slice(),
      sortCol: -1,
      sortDir: 1,
      searchQuery: '',
      page: 0,
      pageSize: Math.min(maxRows, 100),
    };

    container.innerHTML = '';
    container.className = 'dg-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Vista de datos');

    // Search
    var searchWrap = null;
    if (searchable) {
      searchWrap = document.createElement('div');
      searchWrap.className = 'dg-search';
      searchWrap.innerHTML =
        '<input type="search" class="dg-search-input" placeholder="Buscar en datos…" aria-label="Buscar" />' +
        '<span class="dg-search-count" role="status" aria-live="polite"></span>';
      container.appendChild(searchWrap);
      var searchInput = searchWrap.querySelector('.dg-search-input');
      searchInput.addEventListener('input', function () {
        state.searchQuery = searchInput.value.toLowerCase();
        applyFilter();
      });
    }

    // Table wrapper
    var wrap = document.createElement('div');
    wrap.className = 'dg-scroll';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'grid');
    wrap.setAttribute('aria-label', 'Tabla de datos');
    container.appendChild(wrap);

    // Pagination
    var pagination = document.createElement('div');
    pagination.className = 'dg-pagination';
    pagination.setAttribute('role', 'navigation');
    pagination.setAttribute('aria-label', 'Paginación');
    container.appendChild(pagination);

    var prevBtn = document.createElement('button');
    prevBtn.className = 'quiet-button';
    prevBtn.type = 'button';
    prevBtn.textContent = '← Anterior';
    prevBtn.addEventListener('click', function () { if (state.page > 0) { state.page--; render(); } });
    pagination.appendChild(prevBtn);

    var pageLabel = document.createElement('span');
    pageLabel.className = 'dg-page-label';
    pagination.appendChild(pageLabel);

    var nextBtn = document.createElement('button');
    nextBtn.className = 'quiet-button';
    nextBtn.type = 'button';
    nextBtn.textContent = 'Siguiente →';
    nextBtn.addEventListener('click', function () { var totalPages = Math.ceil(state.filteredRows.length / state.pageSize); if (state.page < totalPages - 1) { state.page++; render(); } });
    pagination.appendChild(nextBtn);

    function applyFilter() {
      if (!state.searchQuery) {
        state.filteredRows = rows.slice();
      } else {
        state.filteredRows = rows.filter(function (row) {
          return row.some(function (cell) {
            return String(cell || '').toLowerCase().indexOf(state.searchQuery) !== -1;
          });
        });
      }
      if (state.sortCol >= 0) applySort();
      state.page = 0;
      render();
      updateSearchCount();
    }

    function applySort() {
      var col = state.sortCol;
      var dir = state.sortDir;
      state.filteredRows.sort(function (a, b) {
        var va = a[col], vb = b[col];
        var na = parseFloat(String(va).replace(/[,%\s]/g, ''));
        var nb = parseFloat(String(vb).replace(/[,%\s]/g, ''));
        if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
        return String(va || '').localeCompare(String(vb || ''), 'es') * dir;
      });
    }

    function updateSearchCount() {
      var countEl = container.querySelector('.dg-search-count');
      if (countEl) {
        countEl.textContent = state.searchQuery
          ? state.filteredRows.length + ' de ' + rows.length + ' filas'
          : rows.length + ' filas';
      }
    }

    function render() {
      wrap.innerHTML = '';
      var totalPages = Math.ceil(state.filteredRows.length / state.pageSize);
      var start = state.page * state.pageSize;
      var pageRows = state.filteredRows.slice(start, start + state.pageSize);

      var table = document.createElement('table');
      table.className = 'dg-table';

      // Header
      if (headers.length) {
        var thead = document.createElement('thead');
        var htr = document.createElement('tr');
        headers.forEach(function (h, i) {
          var th = document.createElement('th');
          th.className = 'dg-th';
          th.textContent = h;
          th.setAttribute('scope', 'col');
          if (sortable) {
            th.tabIndex = 0;
            th.setAttribute('role', 'columnheader');
            th.setAttribute('aria-sort', state.sortCol === i ? (state.sortDir === 1 ? 'ascending' : 'descending') : 'none');
            th.addEventListener('click', function () {
              if (state.sortCol === i) state.sortDir *= -1;
              else { state.sortCol = i; state.sortDir = 1; }
              applySort();
              render();
            });
            th.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); }
            });
            // Sort indicator
            var arrow = document.createElement('span');
            arrow.className = 'dg-sort-arrow';
            arrow.textContent = state.sortCol === i ? (state.sortDir === 1 ? ' ▲' : ' ▼') : '';
            th.appendChild(arrow);
          }
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);
      }

      // Body
      var tbody = document.createElement('tbody');
      pageRows.forEach(function (row, ri) {
        var tr = document.createElement('tr');
        tr.className = 'dg-row';
        var absIdx = start + ri;
        row.forEach(function (cell, ci) {
          var td = document.createElement('td');
          td.className = 'dg-td';
          var val = String(cell == null ? '' : cell);
          // Detect numbers for right alignment
          var num = parseFloat(val.replace(/[,%\s]/g, ''));
          if (!isNaN(num) && val.trim() !== '') {
            td.classList.add('dg-num');
            td.textContent = val;
          } else {
            td.textContent = val;
          }
          td.title = val;
          if (onCellClick) {
            td.style.cursor = 'pointer';
            td.addEventListener('click', function () { onCellClick(absIdx, ci, cell); });
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);

      // Pagination
      pagination.hidden = totalPages <= 1;
      pageLabel.textContent = 'Página ' + (state.page + 1) + ' de ' + totalPages;
      prevBtn.disabled = state.page === 0;
      nextBtn.disabled = state.page >= totalPages - 1;

      updateSearchCount();
    }

    function getData() { return { headers: headers, rows: state.filteredRows }; }

    function setSearch(query) {
      state.searchQuery = (query || '').toLowerCase();
      var input = container.querySelector('.dg-search-input');
      if (input) input.value = query || '';
      applyFilter();
    }

    function getSelectedRows() { return []; }

    function destroy() { container.innerHTML = ''; }

    applyFilter();

    return { destroy: destroy, getData: getData, setSearch: setSearch, getSelectedRows: getSelectedRows };
  }

  window.ToolistoDataGrid = { create: create };
})();
