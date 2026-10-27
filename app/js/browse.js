/* Prehliadač videí: hero banner, riadky (kategórie) s horizontálnymi dlaždicami, vyhľadávanie.
 * Výkon: pozície riadkov sa počítajú aritmeticky (žiadne čítanie layoutu pri pohybe fokusu),
 * obrázky sa načítavajú len pre viditeľné riadky a dlaždice. */
(function (w) {
  var $ = function (id) { return document.getElementById(id); };
  var CARD_W = 380, STEP = 404, VIEW_W = 1780, ROW_H = 410, NT_H = 362, HERO_H = 580, HDR = 124, WRAP_H = 1036;
  var inner, searchEl, scrollEl, thumbEl, emptyEl, hdr, scrollH = 0, scrollOn = null;
  var catRows = [], rows = [], all = [], allMap = {}, results = [];
  var pos = { r: 0, c: 0 }, query = '', catPos = null, contIds = '', totalH = 0;
  var curEl = null, last = { id: null, key: null }, handlers = {}, searchT, wheelT = 0, moveT = 0;

  function div(cls, txt) { var d = document.createElement('div'); d.className = cls; if (txt != null) d.textContent = txt; return d; }
  function span(cls, txt) { var d = document.createElement('span'); d.className = cls; if (txt != null) d.textContent = txt; return d; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function tr(el, x, y) { var t = 'translate3d(' + x + 'px,' + y + 'px,0)'; el.style.webkitTransform = t; el.style.transform = t; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDur(ms) {
    var s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(x) : m + ':' + pad(x);
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms), n = new Date();
    var days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (days <= 0) return 'dnes';
    if (days === 1) return 'včera';
    if (days < 8) return 'pred ' + days + ' dňami';
    return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
  }
  function norm(s) {
    s = (s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return s;
  }

  function setProgress(card, id) {
    var e = Store.get(id), pb = card.firstChild.lastChild, f = e && e.d ? Math.min(1, e.p / e.d) : 0;
    pb.style.display = f > 0.02 ? 'block' : 'none';
    pb.firstChild.style.width = (f * 100) + '%';
  }

  function makeCard(it) {
    var c = div('card'); c.setAttribute('data-id', it.id);
    var th = div('thumb'), img = document.createElement('img');
    img.setAttribute('data-src', it.thumb || '');
    img.onload = function () { img.className = 'loaded'; };
    img.onerror = function () { img.style.display = 'none'; };
    th.appendChild(img);
    var du = it.duration || Store.getDur(it.id) * 1000;
    if (du) th.appendChild(span('dur', fmtDur(du)));
    var pb = div('pbar'); pb.appendChild(document.createElement('i')); th.appendChild(pb);
    c.appendChild(th);
    c.appendChild(div('ctitle', it.title));
    c.appendChild(div('cmeta', fmtDate(it.created)));
    setProgress(c, it.id);
    return c;
  }

  function addRow(r) {
    var row = { title: r.title, key: r.key || r.title, items: r.items, cards: [], shift: 0, col: 0, top: totalH, h: r.title ? ROW_H : NT_H };
    row.el = div('row' + (r.title ? '' : ' nt'));
    row.el.appendChild(div('rtitle' + (r.title ? '' : ' empty'), r.title));
    var view = div('rview'); row.track = div('track');
    r.items.forEach(function (it) { var c = makeCard(it); row.cards.push(c); row.track.appendChild(c); });
    view.appendChild(row.track); row.el.appendChild(view);
    inner.appendChild(row.el); rows.push(row); totalH += row.h;
  }

  function heroLabel(btn, id) { btn.lastChild.textContent = Store.resumeAt(id) ? 'Pokračovať' : 'Prehrať'; }
  function addHero(it) {
    var row = { hero: true, title: '', key: 'hero', items: [it], cards: [], shift: 0, col: 0, top: totalH, h: HERO_H };
    row.el = div('row hero');
    var img = document.createElement('img'); img.className = 'heroImg';
    img.onload = function () { img.className = 'heroImg loaded'; };
    img.src = it.hero || it.thumb;
    row.el.appendChild(img); row.el.appendChild(div('heroShade'));
    var body = div('heroBody');
    body.appendChild(div('heroTag', 'ODPORÚČANÉ'));
    body.appendChild(div('heroTitle', it.title));
    body.appendChild(div('heroMeta', [fmtDate(it.created), it.duration ? fmtDur(it.duration) : ''].filter(Boolean).join('  ·  ')));
    var btn = document.createElement('button'); btn.className = 'heroBtn'; btn.setAttribute('data-id', it.id);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="40" height="40"><path fill="#0a0f24" d="M8 5v14l11-7z"/></svg><span></span>';
    heroLabel(btn, it.id);
    body.appendChild(btn); row.el.appendChild(body);
    row.cards.push(btn);
    inner.appendChild(row.el); rows.push(row); totalH += HERO_H;
  }

  function continueRow(skipId) {
    var items = Store.recent().filter(function (id) { return id !== skipId; })
      .map(function (id) { return allMap[id]; }).filter(Boolean).slice(0, 12);
    return items.length ? { title: 'Pokračovať v pozeraní', key: 'continue', items: items } : null;
  }

  function reset() { inner.innerHTML = ''; rows = []; totalH = 0; curEl = null; tr(inner, 0, 0); }
  function finish() { emptyEl.classList.toggle('hidden', rows.length > 0); updateStatus(); }

  function buildCategories() {
    reset();
    var f = catRows.length && catRows[0].items[0], cats = catRows.slice();
    if (f) {
      /* hero zobrazuje prvé video; z prvého riadka (Odporúčané) ho vyhoď, prázdny riadok zahoď */
      var first = { title: cats[0].title, key: cats[0].key, items: cats[0].items.filter(function (it) { return it.id !== f.id; }) };
      if (first.items.length) cats[0] = first; else cats.shift();
    }
    var c = continueRow(f && f.id);
    contIds = c ? c.items.map(function (i) { return i.id; }).join(',') : '';
    if (f) addHero(f);
    if (c) addRow(c);
    cats.forEach(addRow);
    finish();
  }
  function buildRows(list) { reset(); list.forEach(addRow); finish(); }

  function register(list) {
    list.forEach(function (r) {
      r.items.forEach(function (it) {
        if (allMap[it.id]) return;
        it._n = norm(it.title); allMap[it.id] = it; all.push(it);
      });
    });
  }

  function updateStatus() {
    var n = rows.length, on = n > 2;
    if (on !== scrollOn) { scrollOn = on; scrollEl.style.display = on ? 'block' : 'none'; }
    if (!on) return;
    if (!scrollH) scrollH = scrollEl.offsetHeight;
    if (!scrollH) return;
    var h = Math.max(50, scrollH * Math.min(1, 2.4 / n)), r = Math.max(0, pos.r);
    thumbEl.style.height = h + 'px';
    tr(thumbEl, 0, n > 1 ? r / (n - 1) * (scrollH - h) : 0);
  }

  function loadImages() {
    var r0 = Math.max(0, pos.r - 1), r1 = Math.min(rows.length - 1, Math.max(pos.r, 0) + 2);
    for (var i = r0; i <= r1; i++) {
      var row = rows[i]; if (row.hero) continue;
      var from = Math.max(0, Math.floor(row.shift / STEP) - 1), to = Math.min(row.cards.length - 1, from + 8);
      for (var j = from; j <= to; j++) {
        var img = row.cards[j].firstChild.firstChild;
        if (!img._l) { img._l = 1; var s = img.getAttribute('data-src'); if (s) img.src = s; }
      }
    }
  }

  function focus(r, c) {
    if (curEl) { curEl.classList.remove('focus'); curEl = null; }
    if (r < 0 || !rows.length) {
      pos = { r: -1, c: clamp(c, 0, hdr.length - 1) };
      curEl = hdr[pos.c]; curEl.classList.add('focus');
      tr(inner, 0, 0);
    } else {
      r = clamp(r, 0, rows.length - 1);
      var row = rows[r]; c = clamp(c, 0, row.cards.length - 1);
      pos = { r: r, c: c }; row.col = c;
      curEl = row.cards[c]; curEl.classList.add('focus');
      if (row.hero) {
        tr(inner, 0, 0);
      } else {
        var left = c * STEP, right = left + CARD_W, s = row.shift, max = Math.max(0, row.cards.length * STEP - 24 - VIEW_W);
        if (left - s < 0) s = Math.max(0, left - 100);
        else if (right - s > VIEW_W - 40) s = Math.min(max, right - VIEW_W + 100);
        if (s !== row.shift) { row.shift = s; tr(row.track, -s, 0); }
        tr(inner, 0, -Math.max(0, Math.min(row.top - HDR, totalH - WRAP_H)));
      }
    }
    updateStatus(); loadImages();
  }

  function move(dr, dc) {
    var n = Date.now(); if (n - moveT < 60) return; moveT = n;   /* ochrana pred zahltením pri držaní šípky */
    if (pos.r < 0) {
      if (dc) return focus(-1, pos.c + dc);
      if (dr > 0 && rows.length) return focus(0, rows[0].col);
      return;
    }
    if (dc) return focus(pos.r, pos.c + dc);
    var t = pos.r + dr;
    if (t < 0) return focus(-1, 0);
    t = clamp(t, 0, rows.length - 1);
    focus(t, rows[t].col);
  }

  /* kontext prehrávania: zoznam videí, v ktorom sa dá ísť na ďalšie/predchádzajúce */
  function context(row, c) {
    var id = row.items[c].id, ids;
    if (query) ids = results.map(function (it) { return it.id; });
    else if (row.hero) {
      ids = [id];
      var nx = rows.filter(function (r) { return !r.hero && r.key !== 'continue'; })[0];
      if (nx) nx.items.forEach(function (it) { if (it.id !== id) ids.push(it.id); });
    } else ids = row.items.map(function (it) { return it.id; });
    return { ids: ids, i: Math.max(0, ids.indexOf(id)) };
  }

  function activate() {
    if (pos.r < 0) {
      if (pos.c === 0) searchEl.focus();
      else if (handlers.onLogout) handlers.onLogout();
      return;
    }
    var row = rows[pos.r], id = row.items[pos.c].id;
    last = { id: id, key: row.key };
    if (handlers.onOpen) handlers.onOpen(id, allMap[id] ? allMap[id].title : '', context(row, pos.c));
  }

  function applySearch(q) {
    q = (q || '').replace(/^\s+|\s+$/g, '');
    if (q === query) return;
    if (!query && q) catPos = { r: pos.r, c: pos.c };
    query = q;
    if (!q) { results = []; catPos = null; buildCategories(); focus(-1, 0); return; }
    var toks = norm(q).split(/\s+/);
    results = all.filter(function (it) { return toks.every(function (t) { return it._n.indexOf(t) >= 0; }); });
    var list = [];
    for (var i = 0; i < results.length; i += 4) {
      list.push({ title: i === 0 ? 'Výsledky pre „' + q + '“ · ' + results.length : '', key: 's' + i, items: results.slice(i, i + 4) });
    }
    buildRows(list);
    emptyEl.textContent = 'Pre „' + q + '“ sa nič nenašlo';
    focus(-1, 0);
  }

  function updateProgress() {
    rows.forEach(function (r) {
      if (r.hero) heroLabel(r.cards[0], r.items[0].id);
      else r.cards.forEach(function (c) {
        var id = c.getAttribute('data-id'); setProgress(c, id);
        var th = c.firstChild;
        if (!th.querySelector('.dur') && Store.getDur(id)) th.insertBefore(span('dur', fmtDur(Store.getDur(id) * 1000)), th.lastChild);
      });
    });
  }

  w.Browse = {
    init: function (h) {
      handlers = h;
      inner = $('rowsInner'); searchEl = $('search');
      scrollEl = $('scroll'); thumbEl = $('scrollThumb'); emptyEl = $('empty');
      hdr = [$('searchBox'), $('logoutBtn')];
      searchEl.addEventListener('keydown', function (e) {
        var k = e.keyCode;
        if (k === 13 || k === 461 || k === 27) {
          e.preventDefault(); e.stopPropagation();
          searchEl.blur(); applySearch(searchEl.value);
          focus(-1, 0);
        }
      });
      searchEl.addEventListener('input', function () {
        clearTimeout(searchT);
        searchT = setTimeout(function () { applySearch(searchEl.value); }, 350);
      });
      $('searchBox').addEventListener('click', function () { searchEl.focus(); });
      $('logoutBtn').addEventListener('click', function () { if (handlers.onLogout) handlers.onLogout(); });
      $('rowsWrap').addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== this && !(el.getAttribute && el.getAttribute('data-id'))) el = el.parentNode;
        if (!el || el === this) return;
        for (var r = 0; r < rows.length; r++) {
          var c = rows[r].cards.indexOf(el);
          if (c >= 0) { focus(r, c); activate(); return; }
        }
      });
      $('rowsWrap').addEventListener('wheel', function (e) {
        var n = Date.now(); if (n - wheelT < 120) return; wheelT = n;
        move(e.deltaY > 0 ? 1 : -1, 0); e.preventDefault();
      });
    },
    setData: function (list) {
      catRows = list; all = []; allMap = {}; register(list);
      query = ''; searchEl.value = ''; catPos = null; results = [];
      buildCategories(); pos = { r: 0, c: 0 };
    },
    append: function (list) {
      catRows = catRows.concat(list); register(list);
      if (!query) { list.forEach(addRow); finish(); }
    },
    item: function (id) { return allMap[id] || null; },
    /* prepnutie na iné video (ďalšie/predchádzajúce): po návrate bude fokus na ňom */
    remember: function (id) { last.id = id; },
    /* po návrate z prehrávača: len aktualizuj priebeh; riadky prestavaj, iba ak sa zmenil „Pokračovať" */
    refresh: function () {
      var rebuilt = false;
      if (!query) {
        var f = catRows.length && catRows[0].items[0], c = continueRow(f && f.id);
        var ids = c ? c.items.map(function (i) { return i.id; }).join(',') : '';
        if (ids !== contIds) { buildCategories(); rebuilt = true; }
      }
      if (!rebuilt) updateProgress();
      /* fokus na poslednom prehrávanom videu (preferuj riadok, z ktorého sa spustilo) */
      var fnd = null, i, j;
      for (i = 0; i < rows.length && !fnd; i++) {
        if (rows[i].key !== last.key) continue;
        for (j = 0; j < rows[i].items.length; j++) if (rows[i].items[j].id === last.id) { fnd = { r: i, c: j }; break; }
      }
      for (i = 0; i < rows.length && !fnd; i++) {
        for (j = 0; j < rows[i].items.length; j++) if (rows[i].items[j].id === last.id) { fnd = { r: i, c: j }; break; }
      }
      if (fnd) { pos = fnd; rows[fnd.r].col = fnd.c; }
    },
    /* volať až keď je obrazovka viditeľná */
    activate: function () { scrollH = 0; focus(pos.r, pos.c); },
    key: function (k) {
      switch (k) {
        case 37: move(0, -1); return true;
        case 39: move(0, 1); return true;
        case 38: move(-1, 0); return true;
        case 40: move(1, 0); return true;
        case 13: activate(); return true;
        case 33: move(-2, 0); return true;
        case 34: move(2, 0); return true;
      }
      return false;
    },
    back: function () {
      if (!query) return false;
      searchEl.value = ''; applySearch(''); return true;
    }
  };
})(window);
