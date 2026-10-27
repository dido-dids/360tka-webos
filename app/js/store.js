/* Lokálne uložené pozície prehrávania (sekundy): id -> {p, d, t} */
(function (w) {
  var K = 'tka360.pos', MAX = 300, m = {};
  try { m = JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch (e) { m = {}; }

  function save() {
    var ids = Object.keys(m);
    if (ids.length > MAX) {
      ids.sort(function (a, b) { return m[a].t - m[b].t; }).slice(0, ids.length - MAX).forEach(function (id) { delete m[id]; });
    }
    try { localStorage.setItem(K, JSON.stringify(m)); } catch (e) {}
  }
  function resumeAt(id) { var e = m[id]; return e && e.p > 15 && e.d && e.p < e.d - 20 ? e.p : 0; }

  var DK = 'tka360.dur', dm = {};
  try { dm = JSON.parse(localStorage.getItem(DK) || '{}') || {}; } catch (e) { dm = {}; }

  w.Store = {
    getDur: function (id) { return dm[id] || 0; },
    setDur: function (id, sec) { if (dm[id] === Math.round(sec)) return; dm[id] = Math.round(sec); try { localStorage.setItem(DK, JSON.stringify(dm)); } catch (e) {} },
    get: function (id) { return m[id] || null; },
    set: function (id, p, d) { m[id] = { p: p, d: d, t: Date.now() }; save(); },
    clear: function (id) { delete m[id]; save(); },
    resumeAt: resumeAt,
    recent: function () {
      return Object.keys(m).filter(function (id) { return resumeAt(id) > 0; })
        .sort(function (a, b) { return m[b].t - m[a].t; });
    }
  };
})(window);
