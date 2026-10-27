/* Prehrávač: Shaka (DASH) + vlastné ovládanie, ukladanie pozície.
 * Režim „seek": ←/→ pretáča, OK pauza. Šípka dole = fokus na tlačidlá, hore = späť do seek.
 * Späť: zatvorí menu → tlačidlový režim → skryje ovládanie → (až potom) zavrie video. */
(function (w) {
  var $ = function (id) { return document.getElementById(id); };
  var video, player, osd, track, prog, knob, buf, spin, bPlay, qLabel, qmenu, ctls, cb = {};
  var current = null, hideT, pendT, pending = null, lastSeek = 0, step = 10, saveAt = 0, syncAt = 0;
  var mode = 'seek', ci = 0, menuOpen = false, mi = 0, menuItems = [];
  var QK = 'tka360.q';

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (x < 10 ? '0' : '') + x;
  }
  function dur() { var d = video.duration; return isFinite(d) && d > 0 ? d : 0; }
  function shown() { return !osd.classList.contains('hidden'); }
  function list() { return ctls.filter(function (c) { return !c.classList.contains('hidden'); }); }

  function render() {
    var d = dur(), cur = pending != null ? pending : video.currentTime, f = d ? Math.min(1, cur / d) : 0, b = 0;
    $('tCur').textContent = fmt(cur); $('tDur').textContent = fmt(d);
    prog.style.width = (f * 100) + '%'; knob.style.left = (f * 100) + '%';
    try { if (video.buffered.length) b = video.buffered.end(video.buffered.length - 1); } catch (e) {}
    buf.style.width = (d ? Math.min(1, b / d) * 100 : 0) + '%';
  }
  function updRestart() {
    var d = dur(), show = d > 0 && video.currentTime > Math.min(60, d * 0.1), btn = $('bRestart');
    if (show === btn.classList.contains('hidden')) { btn.classList.toggle('hidden', !show); if (!show) paintFocus(); }
  }
  function paintFocus() {
    var l = list();
    if (ci >= l.length) ci = Math.max(0, l.length - 1);
    ctls.forEach(function (c) { c.classList.remove('focus'); });
    if (mode === 'ctl' && !menuOpen && l[ci]) l[ci].classList.add('focus');
    osd.classList.toggle('seekfocus', mode === 'seek' && !menuOpen);
  }
  function hideOsd() {
    clearTimeout(hideT); osd.classList.add('hidden'); mode = 'seek';
    if (menuOpen) { menuOpen = false; qmenu.classList.add('hidden'); }
    paintFocus();
  }
  function showOsd() {
    osd.classList.remove('hidden'); render(); paintFocus();
    clearTimeout(hideT);
    if (!video.paused) hideT = setTimeout(hideOsd, 4500);
  }
  function icon() { bPlay.className = 'ctl' + (video.paused ? ' paused' : ''); paintFocus(); }
  function setMode(m) {
    mode = m;
    if (m === 'ctl') ci = Math.max(0, list().indexOf(bPlay));
    showOsd();
  }

  /* kvalita */
  function heights() {
    var hs = {};
    player.getVariantTracks().forEach(function (t) { if (t.height) hs[t.height] = 1; });
    return Object.keys(hs).map(Number).sort(function (a, b) { return b - a; });
  }
  function quality() { try { return localStorage.getItem(QK) || 'auto'; } catch (e) { return 'auto'; } }
  function updateLabel() {
    var q = quality(), act = player.getVariantTracks().filter(function (t) { return t.active; })[0];
    qLabel.textContent = q === 'auto' ? 'Auto' + (act && act.height ? ' · ' + act.height + 'p' : '') : q + 'p';
  }
  function applyQuality() {
    var q = quality(), hs = heights();
    if (q === 'auto' || !hs.length) {
      player.configure({ abr: { enabled: true } });
    } else {
      var h = Number(q), pick = hs.filter(function (x) { return x <= h; })[0] || hs[hs.length - 1];
      var cand = player.getVariantTracks().filter(function (t) { return t.height === pick; })
        .sort(function (a, b) { return b.bandwidth - a.bandwidth; })[0];
      player.configure({ abr: { enabled: false } });
      if (cand) player.selectVariantTrack(cand, true);
    }
    updateLabel();
  }

  /* menu */
  function renderMenu() {
    qmenu.innerHTML = '<div class="qh">KVALITA</div>';
    menuItems.forEach(function (it, i) {
      var d = document.createElement('div');
      d.className = 'qi' + (it.sel ? ' sel' : '') + (i === mi ? ' focus' : '');
      d.innerHTML = '<span></span><span>' + (it.sel ? '✓' : '') + '</span>';
      d.firstChild.textContent = it.label;
      d.addEventListener('click', function () { mi = i; pick(); });
      qmenu.appendChild(d);
    });
  }
  function openMenu() {
    var q = quality();
    menuItems = [{ v: 'auto', label: 'Automaticky', sel: q === 'auto' }];
    heights().forEach(function (h) { menuItems.push({ v: String(h), label: h + 'p', sel: q === String(h) }); });
    mi = 0; menuItems.forEach(function (it, i) { if (it.sel) mi = i; });
    menuOpen = true; renderMenu();
    var btn = $('bQual'), ctr = $('ctrls');
    qmenu.style.right = Math.max(20, $('osdBottom').clientWidth - (ctr.offsetLeft + btn.offsetLeft + btn.offsetWidth)) + 'px';
    qmenu.classList.remove('hidden'); showOsd();
  }
  function closeMenu() { menuOpen = false; qmenu.classList.add('hidden'); showOsd(); }
  function pick() {
    try { localStorage.setItem(QK, menuItems[mi].v); } catch (e) {}
    applyQuality(); closeMenu();
  }

  function persist(sync) {
    if (!current || !dur()) return;
    var c = video.currentTime;
    Store.set(current.id, c, dur());
    if (sync && cb.onPosition) cb.onPosition(current.id, c, dur());
  }
  function commit() { if (pending != null) { video.currentTime = pending; pending = null; render(); updRestart(); } }
  function seek(dir) {
    var now = Date.now(), d = dur();
    step = now - lastSeek < 700 ? Math.min(step + 10, 60) : 10; lastSeek = now;
    var base = pending != null ? pending : video.currentTime;
    pending = Math.max(0, Math.min(d ? d - 1 : base, base + dir * step));
    showOsd();
    clearTimeout(pendT); pendT = setTimeout(commit, 500);
  }
  function toggle() { if (video.paused) video.play(); else video.pause(); showOsd(); }
  function restart() { pending = null; video.currentTime = 0; if (video.paused) video.play(); updRestart(); showOsd(); }
  function act(el) {
    switch (el.id) {
      case 'bPlay': toggle(); break;
      case 'bRew': seek(-1); break;
      case 'bFwd': seek(1); break;
      case 'bPrev': if (cb.onPrev) cb.onPrev(); break;
      case 'bNext': if (cb.onNext) cb.onNext(); break;
      case 'bRestart': restart(); break;
      case 'bQual': openMenu(); break;
    }
  }

  w.Player = {
    init: function (callbacks) {
      cb = callbacks || {};
      shaka.polyfill.installAll();
      video = $('video'); osd = $('osd'); track = $('track'); prog = $('prog'); knob = $('knob');
      buf = $('buf'); spin = $('spin'); bPlay = $('bPlay'); qLabel = $('qLabel'); qmenu = $('qmenu');
      ctls = ['bPrev', 'bRew', 'bPlay', 'bFwd', 'bNext', 'bRestart', 'bQual'].map($);
      player = new shaka.Player(video);
      player.addEventListener('error', function (e) {
        console.error('shaka', e.detail);
        /* obnoviteľné chyby (severity 1) Shaka rieši sama; zatvor len pri kritickej (2) */
        if (e.detail && e.detail.severity === 2 && cb.onError) cb.onError('chyba prehrávača ' + e.detail.code);
      });
      player.addEventListener('variantchanged', updateLabel);
      player.addEventListener('adaptation', updateLabel);
      video.addEventListener('timeupdate', function () {
        if (pending == null && shown()) render();
        updRestart();
        var n = Date.now();
        if (n - saveAt > 10000) { saveAt = n; persist(false); }
        if (n - syncAt > 30000) { syncAt = n; persist(true); }
      });
      video.addEventListener('waiting', function () { spin.classList.remove('hidden'); });
      video.addEventListener('playing', function () { spin.classList.add('hidden'); icon(); });
      video.addEventListener('canplay', function () { spin.classList.add('hidden'); });
      video.addEventListener('pause', function () { icon(); showOsd(); });
      video.addEventListener('play', icon);
      video.addEventListener('ended', function () {
        if (current) { Store.clear(current.id); if (cb.onPosition && dur()) cb.onPosition(current.id, dur(), dur()); current = null; }
        if (cb.onEnded) cb.onEnded();
      });
      ctls.forEach(function (el) { el.addEventListener('click', function () { if (menuOpen) closeMenu(); else act(el); }); });
      $('bBack').addEventListener('click', function () { if (cb.onStop) cb.onStop(); });
      track.addEventListener('click', function (e) {
        var r = track.getBoundingClientRect(), d = dur();
        if (d) { video.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d; showOsd(); }
      });
      $('player').addEventListener('mousemove', function () { showOsd(); });
      video.addEventListener('click', function () { if (shown()) toggle(); else showOsd(); });
    },
    /* zobraz prehrávač so spinnerom ešte pred získaním URL */
    begin: function (title, hasPrev, hasNext) {
      $('osdTitle').textContent = title || '';
      $('bRestart').classList.add('hidden');
      $('bPrev').classList.toggle('hidden', !hasPrev);
      $('bNext').classList.toggle('hidden', !hasNext);
      mode = 'seek'; menuOpen = false; qmenu.classList.add('hidden');
      spin.classList.remove('hidden'); osd.classList.remove('hidden');
      pending = null; render(); icon();
    },
    play: function (url, title, id, start) {
      current = { id: id, title: title }; saveAt = syncAt = Date.now();
      return player.load(url, start > 0 ? start : null).then(function () {
        applyQuality();
        if (dur()) Store.setDur(id, dur());
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        icon(); showOsd();
      });
    },
    stop: function () {
      clearTimeout(hideT); clearTimeout(pendT); pending = null;
      persist(true); current = null; mode = 'seek'; menuOpen = false; qmenu.classList.add('hidden');
      video.pause();
      var p = player.unload();
      video.removeAttribute('src');
      try { video.load(); } catch (e) {}
      osd.classList.add('hidden'); spin.classList.add('hidden');
      return p && p.catch ? p.catch(function () {}) : p;
    },
    back: function () {
      if (menuOpen) { closeMenu(); return true; }
      if (shown()) { hideOsd(); return true; }
      return false;
    },
    key: function (k) {
      if (menuOpen) {
        if (k === 38) mi = Math.max(0, mi - 1);
        else if (k === 40) mi = Math.min(menuItems.length - 1, mi + 1);
        else if (k === 13) { pick(); return true; }
        else if (k === 37 || k === 39) { closeMenu(); return true; }
        else return false;
        renderMenu(); return true;
      }
      if (k === 415) { video.play(); showOsd(); return true; }
      if (k === 19) { video.pause(); showOsd(); return true; }
      if (k === 412) { seek(-1); return true; }
      if (k === 417) { seek(1); return true; }
      if (mode === 'ctl') {
        var l = list();
        if (k === 37) ci = Math.max(0, ci - 1);
        else if (k === 39) ci = Math.min(l.length - 1, ci + 1);
        else if (k === 13 || k === 32) { act(l[ci]); return true; }
        else if (k === 38) { setMode('seek'); return true; }
        else if (k !== 40) return false;
        showOsd(); return true;
      }
      switch (k) {
        case 13: case 32: toggle(); return true;
        case 37: seek(-1); return true;
        case 39: seek(1); return true;
        case 40: setMode('ctl'); return true;
        case 38: showOsd(); return true;
      }
      return false;
    }
  };
})(window);
