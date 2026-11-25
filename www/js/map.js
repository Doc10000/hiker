/* ═══════════════════════════════════════════════════════════
   map.js — карта трека.
   • Есть интернет → настоящая карта Leaflet: тёмные тайлы CARTO
     (под тёмную тему), зум, масштаб, маркеры POI, «вы» + точность.
   • Нет интернета / тайлы не грузятся → авто-fallback на
     canvas-схему (работает полностью офлайн).
   Compact-полоски в карточках — всегда canvas (быстро).
   ═══════════════════════════════════════════════════════════ */

const MapRender = (() => {
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_ATTR = '© OpenStreetMap';
  const live = new Set(); // canvas-элементы с живой Leaflet-картой

  /* ── подгрузка Leaflet с CDN (при офлайне — просто нет window.L) ── */
  let loading = null;
  function ensureLeaflet(cb) {
    if (window.L) { cb(true); return; }
    if (loading) { loading.push(cb); return; }
    loading = [cb];
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    const finish = ok => { const q = loading; loading = null; q.forEach(f => f(ok)); };
    s.onload = () => finish(true);
    s.onerror = () => finish(false);
    document.head.appendChild(s);
  }

  /* ═══════════ canvas-схема (офлайн) ═══════════ */
  function proj(pts, w, h, pad) {
    const kx = Math.cos(pts.reduce((s, p) => s + p[0], 0) / pts.length * Math.PI / 180);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lat, lng] of pts) {
      const x = lng * kx, y = lat;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const sw = (maxX - minX) || 1e-6, sh = (maxY - minY) || 1e-6;
    const scale = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
    const ox = (w - sw * scale) / 2, oy = (h - sh * scale) / 2;
    return pts.map(([lat, lng]) => {
      const x = lng * kx, y = lat;
      return [ox + (x - minX) * scale, h - oy - (y - minY) * scale];
    });
  }

  function bg(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#13202c'); g.addColorStop(1, '#0b1117');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // мягкие «горы» — силуэт хребтов
    ctx.fillStyle = '#ffffff06';
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const y = h * (0.45 + layer * 0.14) +
          Math.sin(x / 40 + layer * 2) * (14 - layer * 3) +
          Math.sin(x / 17 + layer) * (6 - layer);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    // изолинии
    ctx.strokeStyle = '#ffffff07'; ctx.lineWidth = 1;
    for (let y = 10; y < h; y += 15) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) ctx.lineTo(x, y + Math.sin(x / 24 + y) * 3);
      ctx.stroke();
    }
  }

  function drawCanvas(canvas, track, opts) {
    if (canvas._lmHost) { canvas._lmHost.style.display = 'none'; canvas.style.display = ''; }

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = opts.compact ? 64 : (canvas.clientHeight || 220);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    bg(ctx, w, h);

    const pad = opts.compact ? 8 : 26;
    const pts = proj(track, w, h, pad);

    ctx.lineJoin = ctx.lineCap = 'round';
    // тень трека
    ctx.strokeStyle = '#00000066'; ctx.lineWidth = opts.compact ? 8 : 12;
    path(ctx, pts); ctx.stroke();
    // подложка
    ctx.strokeStyle = '#58a6ff33'; ctx.lineWidth = opts.compact ? 6 : 9;
    path(ctx, pts); ctx.stroke();
    // основной трек
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = opts.compact ? 3 : 4;
    path(ctx, pts); ctx.stroke();

    if (opts.progress > 0 && !opts.compact) {
      const n = Math.max(2, Math.round(pts.length * opts.progress));
      ctx.strokeStyle = '#39d353'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      const seg = (pts.length - 1) * opts.progress;
      const i0 = Math.floor(seg), t = seg - i0;
      if (i0 + 1 < pts.length) {
        const x = pts[i0][0] + (pts[i0 + 1][0] - pts[i0][0]) * t;
        const y = pts[i0][1] + (pts[i0 + 1][1] - pts[i0][1]) * t;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    if (!opts.compact) {
      (opts.poi || []).forEach(p => {
        const meta = (typeof POI_META !== 'undefined' && POI_META[p.type]) || { icon: '📍' };
        const xy = proj([[p.lat, p.lng]], w, h, pad)[0];
        ctx.beginPath(); ctx.arc(xy[0], xy[1], 9, 0, 7);
        ctx.fillStyle = '#161b22ee'; ctx.fill();
        ctx.strokeStyle = '#303a48'; ctx.lineWidth = 1; ctx.stroke();
        ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(meta.icon, xy[0], xy[1] + 1);
        ctx.textBaseline = 'alphabetic';
      });
      dot(ctx, pts[0], '#39d353', 6);
      dot(ctx, pts[pts.length - 1], '#58a6ff', 6);
      ctx.fillStyle = '#8b949e'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('старт', pts[0][0], pts[0][1] - 12);
      ctx.fillText('финиш', pts[pts.length - 1][0], pts[pts.length - 1][1] - 12);
    }

    if (opts.you) {
      const y = proj([opts.you], w, h, pad)[0];
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(y[0], y[1], 7, 0, 7); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ff4444'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('вы', y[0], y[1] - 12);
    }
    return pts;
  }

  /* ═══════════ маркеры Leaflet ═══════════ */
  function icon(html, cls) {
    return L.divIcon({ className: 'pin-wrap ' + (cls || ''), html, iconSize: [26, 26], iconAnchor: [13, 13] });
  }

  /* ═══════════ реальная карта Leaflet ═══════════ */
  function drawReal(canvas, track, opts) {
    let host = canvas._lmHost;
    if (!host) {
      host = document.createElement('div');
      host.className = 'leaflet-host';
      canvas.parentNode.insertBefore(host, canvas);
      canvas.style.display = 'none';
      canvas._lmHost = host;
    }
    host.style.display = 'block';
    host.style.height = canvas.style.height || (opts.compact ? '64px' : '230px');
    host.style.width = '100%';

    let st = canvas._lm;
    if (!st) {
      const map = L.map(host, {
        zoomControl: false,
        attributionControl: true,
        // управление пальцем/мышью
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        scrollWheelZoom: false,   // колесо не ворует скролл страницы; зум — кнопками и pinch
        zoomSnap: 0.5,
        zoomDelta: 0.5
      });
      const tiles = L.tileLayer(TILE_URL, { maxZoom: 22, maxNativeZoom: 19, attribution: TILE_ATTR, className: 'osm-tiles' }).addTo(map);
      let errors = 0;
      tiles.on('tileerror', () => {
        errors++;
        if (errors >= 6) {                        // тайлы не приходят → уходим в офлайн-схему
          canvas._lmBroken = true;
          drawCanvas(canvas, track, opts);
        }
      });

      L.control.zoom({ position: 'topright' }).addTo(map);
      L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 90 }).addTo(map);

      st = canvas._lm = {
        map,
        line: L.polyline([], { color: '#58a6ff', weight: 4, opacity: .95 }).addTo(map),
        done: L.polyline([], { color: '#39d353', weight: 5 }).addTo(map),
        pins: [],
        you: null,
        acc: null
      };
      live.add(canvas);
    }

    const latlngs = track.map(p => [p[0], p[1]]);
    st.line.setLatLngs(latlngs);

    const p = opts.progress > 0 ? Math.min(track.length - 1, Math.round((track.length - 1) * opts.progress)) : -1;
    st.done.setLatLngs(p > 0 ? latlngs.slice(0, p + 1) : []);

    st.pins.forEach(m => st.map.removeLayer(m)); st.pins = [];
    st.pins.push(L.marker(latlngs[0], { icon: icon('<div class="pin start">▶</div>', 'start-marker'), interactive: false, zIndexOffset: 800 }).addTo(st.map));
    st.pins.push(L.marker(latlngs[latlngs.length - 1], { icon: icon('<div class="pin finish">■</div>', 'finish-marker'), interactive: false, zIndexOffset: 800 }).addTo(st.map));

    (opts.poi || []).forEach(pt => {
      const meta = (typeof POI_META !== 'undefined' && POI_META[pt.type]) || { icon: '📍', name: pt.type };
      st.pins.push(L.marker([pt.lat, pt.lng], {
        icon: icon(`<div class="pin">${meta.icon}</div>`, 'poi-marker')
      }).bindPopup(`<b>${meta.name}</b><br>${pt.label}`).bindTooltip(meta.name, { direction: 'top', offset: [0, -12] }).addTo(st.map));
    });

    if (opts.you) {
      if (st.you) st.you.setLatLng(opts.you);
      else st.you = L.marker(opts.you, { icon: icon('<div class="pin you"></div>', 'you-marker'), zIndexOffset: 1000 }).addTo(st.map);
      const acc = (opts.youAcc && isFinite(opts.youAcc)) ? opts.youAcc : 0;
      if (acc > 0) {
        if (st.acc) st.acc.setLatLng(opts.you).setRadius(acc);
        else st.acc = L.circle(opts.you, { radius: acc, color: '#ff4444', weight: 1, opacity: .5, fillOpacity: .08, interactive: false }).addTo(st.map);
      } else if (st.acc) { st.map.removeLayer(st.acc); st.acc = null; }
    } else {
      if (st.you) { st.map.removeLayer(st.you); st.you = null; }
      if (st.acc) { st.map.removeLayer(st.acc); st.acc = null; }
    }

    st.map.fitBounds(L.latLngBounds(latlngs), { padding: [22, 22] });
    st.map.invalidateSize();
  }

  /**
   * @param canvas  элемент
   * @param track   [[lat,lng],...]
   * @param opts    { you:[lat,lng]|null, youAcc:number, compact:bool, progress:0..1, poi:[...] }
   */
  function draw(canvas, track, opts = {}) {
    if (opts.compact || canvas._lmBroken || (window.L && navigator.onLine === false)) {
      if (!opts.compact && !window.L && navigator.onLine !== false) {
        ensureLeaflet(ok => { if (ok) draw(canvas, track, opts); });
      }
      return drawCanvas(canvas, track, opts);
    }
    if (!window.L) {
      ensureLeaflet(ok => { if (ok) draw(canvas, track, opts); });
      return drawCanvas(canvas, track, opts);
    }
    return drawReal(canvas, track, opts);
  }

  function path(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  function dot(ctx, p, color, r) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 2; ctx.stroke();
  }

  /** ближайший прогресс на треке (0..1) от текущей позиции */
  function progressOf(track, pos) {
    if (!pos) return 0;
    let best = Infinity, bestI = 0;
    track.forEach(([lat, lng], i) => {
      const d = (lat - pos[0]) ** 2 + (lng - pos[1]) ** 2;
      if (d < best) { best = d; bestI = i; }
    });
    return bestI / (track.length - 1);
  }

  window.addEventListener('resize', () =>
    live.forEach(c => { if (c._lm) c._lm.map.invalidateSize(); }));
  window.addEventListener('online', () =>
    live.forEach(c => { if (c._lm) c._lm.map.invalidateSize(); }));

  return { draw, progressOf };
})();
