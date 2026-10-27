/* Provider rozhranie (zvyšok appky o platforme nič nevie):
 *   restore() -> bool                 obnoví uloženú reláciu
 *   login(email, pass) -> Promise     logout()
 *   list(onPage) -> Promise<rows>     rows = [{title, key, items:[{id, title, thumb, hero, duration, created}]}];
 *                                     ďalšie riadky prichádzajú neskôr cez onPage(rows)
 *   manifest(id) -> Promise<{url, title}>
 *   reportPosition(id, sec, durSec)   (voliteľné) */
(function (w) {
  var demo = {
    name: 'demo',
    login: function () { return Promise.resolve(); },
    logout: function () {},
    list: function () {
      return Promise.resolve([{ title: 'Demo', key: 'demo', items: [
        { id: 'angel', title: 'Angel One (test DASH)', thumb: '' },
        { id: 'sintel', title: 'Sintel (test DASH)', thumb: '' }
      ] }]);
    },
    manifest: function (id) {
      var u = {
        angel: 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd',
        sintel: 'https://storage.googleapis.com/shaka-demo-assets/sintel/dash.mpd'
      };
      return Promise.resolve({ url: u[id], title: id });
    }
  };

  /* Tivio (360tka.sk). Endpointy zistené z vlastnej relácie používateľa; login robí používateľ svojím účtom,
   * prístup k obsahu rozhoduje server podľa predplatného. */
  var CFG = {
    apiKey: 'AIzaSyB02udgMkNLADkLJ_w5YNBMR2VR1WHfusI', // verejný webový kľúč Firebase
    orgId: 'ZnZxJIfpYaCGxaLpoe9Q',
    screenId: 'screen-XHAZh8Hfr3WofO-j2SulI',
    tenantId: 'XnZxJIfpYaCGxaLpoe9Q-kc7d5',
    fn: 'https://europe-west3-tivio-production.cloudfunctions.net/',
    idt: 'https://www.googleapis.com/identitytoolkit/v3/relyingparty/',
    sts: 'https://securetoken.googleapis.com/v1/token?key=',
    syncWatch: true,   // posielať pozíciu prehrávania do účtu (addWatchPosition), ako web
    timeout: 20000
  };
  var KEY = 'tka360.session', gen = 0;
  var sess = null; // {idToken, refreshToken, exp}

  function save() { try { sess ? localStorage.setItem(KEY, JSON.stringify(sess)) : localStorage.removeItem(KEY); } catch (e) {} }
  function load() { try { sess = JSON.parse(localStorage.getItem(KEY)); } catch (e) { sess = null; } }

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }

  /* POST s časovým limitom; chyby majú .code ('NETWORK' | 'TIMEOUT' | kód zo servera) */
  function post(url, body, headers, form) {
    var h = headers || {};
    h['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    var req = fetch(url, { method: 'POST', headers: h, body: form ? body : JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var m = (j.error && (j.error.message || j.error.status)) || ('HTTP ' + r.status);
          if (/^(INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS)/.test(m)) throw fail(m, 'Nesprávny e-mail alebo heslo');
          if (/^TOO_MANY_ATTEMPTS/.test(m)) throw fail(m, 'Príliš veľa pokusov, skús to neskôr');
          throw fail(m, m);
        }
        return j;
      });
    }, function () { throw fail('NETWORK', 'Bez pripojenia k serveru'); });
    var timer, limit = new Promise(function (res, rej) { timer = setTimeout(function () { rej(fail('TIMEOUT', 'Server neodpovedá')); }, CFG.timeout); });
    return Promise.race([req, limit]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  function setSession(j) {
    sess = { idToken: j.idToken || j.id_token, refreshToken: j.refreshToken || j.refresh_token,
             exp: Date.now() + (parseInt(j.expiresIn || j.expires_in, 10) - 60) * 1000 };
    save();
  }

  var refreshing = null;
  function token() {
    if (!sess) return Promise.reject(new Error('Nie si prihlásený'));
    if (Date.now() < sess.exp) return Promise.resolve(sess.idToken);
    if (!refreshing) {
      refreshing = post(CFG.sts + CFG.apiKey, 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refreshToken), {}, true)
        .then(function (j) { setSession(j); return sess.idToken; })
        .catch(function (e) {
          /* odhlás len keď server token odmietol; pri výpadku siete reláciu zachovaj */
          if (e.code === 'NETWORK' || e.code === 'TIMEOUT') throw e;
          sess = null; save(); throw new Error('Relácia vypršala, prihlás sa znova');
        })
        .then(function (t) { refreshing = null; return t; }, function (e) { refreshing = null; throw e; });
    }
    return refreshing;
  }

  function call(name, data) {
    return token().then(function (t) {
      return post(CFG.fn + name, { data: data }, { Authorization: 'Bearer ' + t });
    }).then(function (j) { return j.result; });
  }

  function thumb(id) { return 'https://assets.tivio.studio/videos/' + id + '/cover?width=640'; }

  function rowTitle(r) {
    var n = r.name || {}, bad = /^new row/i;
    var t = (n.sk && !bad.test(n.sk) && n.sk) || (n.cs && !bad.test(n.cs) && n.cs) || (n.en && !bad.test(n.en) && r.rowComponent !== 'BANNER' && n.en) || '';
    return t || (r.rowComponent === 'BANNER' ? 'Odporúčané' : 'Videá');
  }

  /* surové riadky obrazovky -> [{title, key, items:[{id,title,thumb,duration,created}]}], len s videami */
  function toRows(raw) {
    var out = [];
    (raw || []).forEach(function (r) {
      var items = [];
      ((r.tiles && r.tiles.items) || []).forEach(function (t) {
        if (t.itemType !== 'VIDEO') return;
        items.push({ id: t.id, title: (t.name && (t.name.sk || t.name.en)) || t.id, thumb: thumb(t.id), hero: 'https://assets.tivio.studio/videos/' + t.id + '/cover?width=1280',
                     duration: t.itemSpecificData && t.itemSpecificData.duration, created: t.created });
      });
      if (items.length) out.push({ title: rowTitle(r), key: r.rowId || r.path, items: items });
    });
    return out;
  }

  var PAGE = 10, TILES = 24;
  function rawRows(res) { return (res && (res.items || res.rows)) || (res instanceof Array ? res : []); }
  function page(offset, tiles) {
    return call('getRowsInScreenEsBuild', { organizationId: CFG.orgId, screenId: CFG.screenId,
      initialTilesCount: tiles, offset: offset, limit: PAGE });
  }

  var tivio = {
    name: 'tivio',
    restore: function () { load(); return !!(sess && sess.refreshToken); },
    login: function (email, pass) {
      return post(CFG.idt + 'verifyPassword?key=' + CFG.apiKey,
        { email: email, password: pass, returnSecureToken: true, tenantId: CFG.tenantId }).then(setSession);
    },
    logout: function () { gen++; sess = null; save(); },
    /* Prvá strana riadkov sa vráti hneď, ďalšie prichádzajú cez onPage(rows). */
    list: function (onPage) {
      var tiles = TILES, my = ++gen, seen = {};
      return page(0, tiles).catch(function (e) {
        /* opakuj s menším počtom dlaždíc len pri odmietnutí požiadavky, nie pri výpadku siete či odhlásení */
        if (!sess || e.code === 'NETWORK' || e.code === 'TIMEOUT') throw e;
        tiles = 6; return page(0, tiles);
      })
        .then(function (res) {
          var raw = rawRows(res), rows = toRows(raw);
          if (!rows.length) throw new Error('Server vrátil prázdny zoznam');
          rows.forEach(function (r) { seen[r.key] = 1; });
          (function next(off, n) {
            if (n >= 12 || !raw.length) return;
            page(off, tiles).then(function (r) {
              if (my !== gen) return;                      /* medzitým odhlásenie / nové načítanie */
              raw = rawRows(r);
              var more = toRows(raw).filter(function (x) { return !seen[x.key]; });
              more.forEach(function (x) { seen[x.key] = 1; });
              if (!more.length) return;                    /* prázdne alebo opakované riadky: koniec */
              if (onPage) onPage(more);
              next(off + PAGE, n + 1);
            }).catch(function () {});
          })(PAGE, 1);
          return rows;
        });
    },
    /* Rovnako ako web: uloží pozíciu do účtu (addWatchPosition), pozícia sa potom ukáže aj inde. */
    reportPosition: function (id, sec, durSec) {
      if (CFG.syncWatch === false) return;
      call('addWatchPosition', { position: Math.round(sec * 1000), videoPath: 'videos/' + id, videoDuration: Math.round(durSec * 1000) })
        .catch(function () {});
    },
    manifest: function (id) {
      return call('getSourceUrl', { id: id, documentType: 'video',
        capabilities: [{ codec: CFG.codec || 'h264', protocol: 'dash', encryption: 'none' }] })
        .then(function (r) { return { url: r.url, title: id }; });
    }
  };

  w.Providers = { demo: demo, tivio: tivio, active: /[?&]demo/.test(location.search) ? demo : tivio };
})(window);
