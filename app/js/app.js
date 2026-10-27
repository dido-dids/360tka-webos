(function () {
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['loading', 'login', 'browse', 'player'];
  var current = 'login', toastT, openSeq = 0;
  var loginEls = [$('email'), $('password'), $('loginBtn')], li = 0;
  var P = function () { return window.Providers.active; };

  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.add('hidden'); }, ms || 4500);
  }
  function show(name) {
    current = name;
    screens.forEach(function (s) { $(s).classList.toggle('hidden', s !== name); });
    $('ver').classList.toggle('hidden', name === 'player');
    if (name === 'login') loginFocus(li);
  }
  function loginFocus(i) { li = Math.max(0, Math.min(2, i)); loginEls[li].focus(); }
  loginEls.forEach(function (el, i) { el.addEventListener('focus', function () { li = i; }); });

  var loadSeq = 0, loggingIn = false;
  function loadList() {
    var seq = ++loadSeq;
    show('loading');
    P().list(function (more) { if (seq === loadSeq) Browse.append(more); })
      .then(function (rows) {
        if (seq !== loadSeq) return;
        Browse.setData(rows);
        show('browse'); Browse.activate();
      })
      .catch(function (e) { if (seq !== loadSeq) return; $('loginMsg').textContent = e.message; show('login'); });
  }

  function doLogin() {
    if (loggingIn) return;
    loggingIn = true; $('loginMsg').textContent = '';
    P().login($('email').value, $('password').value)
      .then(function () { $('password').value = ''; loggingIn = false; loadList(); })
      .catch(function (e) { loggingIn = false; $('loginMsg').textContent = e.message; });
  }

  function closePlayer() {
    openSeq++;
    Player.stop();
    show('browse'); Browse.refresh(); Browse.activate();
  }
  var playlist = { ids: [], i: 0 };
  function openVideo(id, title, ctx) {
    var seq = ++openSeq;
    playlist = ctx && ctx.ids.length ? ctx : { ids: [id], i: 0 };
    Browse.remember(id);
    show('player');
    Player.begin(title, playlist.i > 0, playlist.i < playlist.ids.length - 1);
    P().manifest(id).then(function (m) {
      if (seq !== openSeq) return;
      return Player.play(m.url, title, id, Store.resumeAt(id));
    }).catch(function (e) {
      if (seq !== openSeq) return;
      closePlayer(); toast('Prehrávanie zlyhalo: ' + (e && e.code ? 'chyba prehrávača ' + e.code : (e && e.message) || e));
    });
  }
  function go(d) {
    var i = playlist.i + d;
    if (i < 0 || i >= playlist.ids.length) return;
    var id = playlist.ids[i], it = Browse.item(id);
    Player.stop();
    openVideo(id, it ? it.title : '', { ids: playlist.ids, i: i });
  }

  Browse.init({
    onOpen: openVideo,
    onLogout: function () { loadSeq++; P().logout(); $('password').value = ''; show('login'); }
  });
  Player.init({
    onStop: closePlayer, onEnded: closePlayer,
    onPrev: function () { go(-1); }, onNext: function () { go(1); },
    onPosition: function (id, p, d) { if (P().reportPosition) P().reportPosition(id, p, d); },
    onError: function (msg) { closePlayer(); toast('Prehrávanie zlyhalo: ' + msg); }
  });
  $('loginBtn').addEventListener('click', doLogin);

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, back = k === 461 || k === 27;
    if (current === 'player') {
      if (back || k === 8) { if (!Player.back()) closePlayer(); e.preventDefault(); return; }
      if (k === 413) { closePlayer(); e.preventDefault(); return; }
      if (Player.key(k)) e.preventDefault();
    } else if (current === 'login') {
      if (k === 38) { loginFocus(li - 1); e.preventDefault(); }
      else if (k === 40) { loginFocus(li + 1); e.preventDefault(); }
      else if (k === 13) { if (li === 0) loginFocus(1); else doLogin(); e.preventDefault(); }
      else if (back) { window.close && window.close(); }
    } else if (current === 'loading') {
      if (back) { window.close && window.close(); e.preventDefault(); }   /* nech sa dá appka ukončiť aj pri načítaní */
    } else if (current === 'browse') {
      if (document.activeElement === $('search')) return;
      if (back || k === 8) {
        if (!Browse.back() && back) window.close && window.close();
        e.preventDefault(); return;
      }
      if (Browse.key(k)) e.preventDefault();
    }
  });

  (function () {
    var x = new XMLHttpRequest();
    x.open('GET', 'appinfo.json');
    x.onload = function () { try { $('ver').textContent = 'v' + JSON.parse(x.responseText).version; } catch (e) { $('ver').textContent = 'v?'; } };
    x.onerror = function () { $('ver').textContent = 'v?'; };
    x.send();
  })();

  if (P().restore && P().restore()) loadList(); else show('login');
})();
