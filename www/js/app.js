/* ═══════════════════════════════════════════════════════════
   app.js — вся логика: онбординг, маршруты, поход, SOS,
   метка для близких, IncidentService (задел под МЧС).
   Всё локально: localStorage + GPS. Внешних запросов нет.
   ═══════════════════════════════════════════════════════════ */

/* ───────── хранилище ───────── */
const DB = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

/* ───────── IncidentService — единый интерфейс событий ─────────
   Канал «родственник» — работает (SMS/ссылка).
   Канал «МЧС» — задел: тот же объект уходит в очередь,
   подключение = один POST на шлюз (см. screen-mchs).        */
const IncidentService = {
  report(type, data) {
    const ev = {
      incident_id: 'inc_' + Date.now().toString(36),
      type,                                   // SOS | OVERDUE | SAFE_RETURN
      severity: type === 'SOS' ? 'high' : type === 'OVERDUE' ? 'medium' : 'info',
      tourist: { name: DB.get('profile', {}).name || '—', phone: DB.get('profile', {}).contactPhone || '' },
      location: data.loc || null,             // {lat, lon, accuracy_m}
      route: data.route || null,
      last_signal_at: new Date().toISOString(),
      planned_return: data.deadline || null,
      status: 'open',
      channels: { relative: 'queued', mchs: 'queued' }
    };
    const q = DB.get('incidents', []);
    q.unshift(ev); DB.set('incidents', q);
    // TODO(production): fetch('https://shlug-mchs.kz/v1/incidents', {method:'POST', body:JSON.stringify(ev)})
    return ev;
  },
  list() { return DB.get('incidents', []); },
  resolve(id) {
    const q = DB.get('incidents', []);
    const e = q.find(x => x.incident_id === id);
    if (e) { e.status = 'closed'; e.channels.mchs = 'closed'; DB.set('incidents', q); }
  }
};

/* ───────── навигация ───────── */
const screens = [...document.querySelectorAll('.screen')];
const tabbar = document.getElementById('tabbar');
const TABS = ['home', 'trip', 'family', 'more'];

function nav(id) {
  screens.forEach(s => s.hidden = s.id !== 'screen-' + id);
  const isMain = TABS.includes(id) && DB.get('profile', null);
  tabbar.hidden = !isMain;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.nav === id));
  if (id === 'home') renderHome();
  if (id === 'family') renderFamily();
  if (id === 'history') renderHistory();
  if (id === 'mchs') renderMchs();
  if (id === 'trip') renderTrip();
  if (id === 'sos') initSos();
  if (id === 'route' && currentRoute) requestAnimationFrame(() => showRoute(currentRoute));
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-nav]');
  if (el) nav(el.dataset.nav);
});

/* ───────── онбординг ───────── */
let obStep = 0;
const obDraft = { hikes: null, level: null, gear: [] };

function obRender() {
  document.querySelectorAll('.ob-step').forEach(s => s.hidden = +s.dataset.step !== obStep);
  for (let i = 0; i < 5; i++)
    document.getElementById('ob-dot-' + i).classList.toggle('active', i <= obStep);
  document.getElementById('ob-back').hidden = obStep === 0;
  document.getElementById('ob-next').textContent = obStep === 4 ? 'Начать' : 'Далее';
}
document.getElementById('ob-next').onclick = () => {
  if (obStep === 0) {
    const n = document.getElementById('ob-name').value.trim();
    if (!n) { toast('Введите имя'); return; }
    obDraft.name = n;
  }
  if (obStep === 2 && !obDraft.level) { toast('Выберите уровень'); return; }
  if (obStep === 3 && obDraft.gear.length === 0) { toast('Отметьте хотя бы один пункт'); return; }

  if (obStep < 4) { obStep++; obRender(); return; }

  // финальный шаг — сохраняем профиль
  DB.set('profile', {
    name: obDraft.name,
    hikes: obDraft.hikes ?? 0,
    level: obDraft.level,
    gear: obDraft.gear,
    contactName: document.getElementById('ob-contact-name').value.trim(),
    contactPhone: document.getElementById('ob-contact-phone').value.trim()
  });
  nav('home');
};
document.getElementById('ob-back').onclick = () => { if (obStep > 0) { obStep--; obRender(); } };

document.querySelectorAll('.choices').forEach(g => {
  g.addEventListener('click', e => {
    const b = e.target.closest('.choice'); if (!b) return;
    const key = g.dataset.key;
    if (g.classList.contains('multi')) {
      if (b.dataset.val === 'none') { obDraft.gear = ['none']; }
      else {
        obDraft.gear = obDraft.gear.filter(v => v !== 'none');
        obDraft.gear = obDraft.gear.includes(b.dataset.val)
          ? obDraft.gear.filter(v => v !== b.dataset.val)
          : [...obDraft.gear, b.dataset.val];
      }
      g.querySelectorAll('.choice').forEach(c =>
        c.classList.toggle('sel', obDraft.gear.includes(c.dataset.val)));
    } else {
      obDraft[key] = +b.dataset.val;
      g.querySelectorAll('.choice').forEach(c => c.classList.toggle('sel', c === b));
    }
  });
});

/* ───────── главная ───────── */
function renderHome() {
  const p = DB.get('profile', {});
  document.getElementById('home-greet').textContent = 'Привет, ' + (p.name || 'хайкер');
  document.getElementById('home-level').textContent = levelLabel(p.level) +
    (p.hikes ? ` · ${['0', '1–3', '4–10', '10+'][p.hikes]} походов/год` : '');

  const rec = ROUTES.filter(r => r.difficulty <= (p.level || 1));
  const rest = ROUTES.filter(r => r.difficulty > (p.level || 1));
  fill('routes-recommended', rec);
  fill('routes-all', rest);

  const banner = document.getElementById('home-banner');
  const t = DB.get('trip', null);
  if (t && t.active) {
    banner.hidden = false;
    banner.innerHTML = `<b>Идёт поход:</b> ${rById(t.routeId).name} — <a href="#" data-nav="trip" style="color:var(--acc2)">открыть</a>`;
  } else banner.hidden = true;
}
function fill(elId, list) {
  const el = document.getElementById(elId);
  if (!list.length) { el.innerHTML = `<div class="hint">Нет — уровней выше вашего профиля</div>`; return; }
  el.innerHTML = list.map(r => `
    <div class="card" data-route="${r.id}">
      <div class="card-top">
        <div><div class="card-name">${r.name}</div><div class="card-region">${r.region}</div></div>
        <div class="diff">${[1,2,3,4,5].map(i =>
          `<i class="${i <= r.difficulty ? 'on ' + (r.difficulty >= 4 ? 'd45' : r.difficulty >= 3 ? 'd3' : '') : ''}"></i>`).join('')}</div>
      </div>
      <div class="card-meta">
        <span>⏱ ${r.days} д</span><span>📏 ${r.km} км</span><span>⛰ ${r.alt} м</span>
        ${r.noSignal ? '<span class="tag nosig">нет связи</span>' : ''}
        ${r.difficulty <= (DB.get('profile', {}).level || 1) ? '<span class="tag rec">рекомендовано</span>' : ''}
      </div>
      <div class="card-strip"><canvas data-strip="${r.id}"></canvas></div>
    </div>`).join('');
  list.forEach(r => {
    const c = el.querySelector(`[data-strip="${r.id}"]`);
    requestAnimationFrame(() => MapRender.draw(c, r.track, { compact: true }));
  });
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-route]');
  if (c) { currentRoute = rById(c.dataset.route); nav('route'); }
});

/* ───────── маршрут ───────── */
let currentRoute = null;
function rById(id) { return ROUTES.find(r => r.id === id); }

function showRoute(r) {
  document.getElementById('route-name').textContent = r.name;
  const canvas = document.getElementById('route-map');
  canvas.style.height = '230px';
  const t = DB.get('trip', null);
  const you = (t && t.active && t.routeId === r.id) ? lastPos(t) : null;
  const youAcc = (you && t.pos) ? t.pos.acc : 0;
  MapRender.draw(canvas, r.track, { you, youAcc, poi: r.poi });
  renderPoi(r);

  document.getElementById('route-stats').innerHTML = `
    <div class="stat"><b>${r.days}</b><span>дней</span></div>
    <div class="stat"><b>${r.km}</b><span>км</span></div>
    <div class="stat"><b>${r.alt}</b><span>высота, м</span></div>
    <div class="stat"><b>${['—','лёгкий','средний','средний','сложный','оч. сложный'][r.difficulty]}</b><span>сложность</span></div>`;
  document.getElementById('route-note').innerHTML =
    `<b>${r.season}.</b> ${r.note}`;
  const active = t && t.active;
  document.getElementById('route-start').textContent =
    active ? (t.routeId === r.id ? 'Продолжить поход' : 'Идёт другой поход') : 'Начать поход';
  document.getElementById('route-start').disabled = active && t.routeId !== r.id;
}
function renderPoi(r) {
  const el = document.getElementById('route-poi');
  if (!r.poi || !r.poi.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="cl-cat">Инфраструктура маршрута</div>` + r.poi.map(p => {
    const m = (typeof POI_META !== 'undefined' && POI_META[p.type]) || { icon: '📍', name: p.type };
    return `<div class="cl-item"><div class="cl-box" style="border:none;background:none;font-size:16px">${m.icon}</div>
      <div class="cl-text">${p.label}</div><span class="cl-pri pri-have">${m.name}</span></div>`;
  }).join('') + `<div class="hint" style="margin-top:6px">Данные инфраструктуры — демо; подтверждаются с парками и гидами.</div>`;
}
document.getElementById('route-start').onclick = () => startTrip(currentRoute);
document.getElementById('route-checklist').onclick = () => { renderChecklist(currentRoute); nav('checklist'); };

/* ───────── чек-лист ───────── */
let clState = {}; // {itemKey:true}
function renderChecklist(r) {
  const p = DB.get('profile', {});
  const cats = buildChecklist(p, r);
  clState = DB.get('cl_' + r.id, {});
  document.getElementById('cl-gen-note').innerHTML =
    `Составлено под ваш профиль: <b>${levelLabel(p.level)}</b>, маршрут «${r.name}» (${r.days} дн., ${r.alt} м), сезон: ${r.season}. Работает офлайн.`;

  document.getElementById('cl-list').innerHTML = cats.map(c => `
    <div class="cl-cat">${c.name}</div>
    ${c.items.map((it, i) => {
      const key = c.name + '|' + it.t;
      const done = clState[key];
      const priCls = it.pri === 'must' ? 'pri-must' : it.pri === 'have' ? 'pri-have' : 'pri-should';
      const priTxt = it.pri === 'must' ? 'взять' : it.pri === 'have' ? 'есть' : 'желательно';
      return `<div class="cl-item ${done ? 'done' : ''}" data-key="${key}">
        <div class="cl-box">${done ? '✓' : ''}</div>
        <div class="cl-text">${it.t}</div>
        <span class="cl-pri ${priCls}">${priTxt}</span></div>`;
    }).join('')}`).join('');
}
document.getElementById('cl-list').addEventListener('click', e => {
  const it = e.target.closest('.cl-item'); if (!it) return;
  clState[it.dataset.key] = !clState[it.dataset.key];
  DB.set('cl_' + currentRoute.id, clState);
  renderChecklist(currentRoute);
});
document.getElementById('cl-share').onclick = () => {
  const p = DB.get('profile', {});
  const lines = [...document.querySelectorAll('.cl-item')].map(el =>
    (clState[el.dataset.key] ? '[✓] ' : '[ ] ') + el.querySelector('.cl-text').textContent);
  shareText(`Снаряжение на «${currentRoute.name}» (${p.name}):\n` + lines.join('\n'));
};

/* ───────── поход ───────── */
let watchId = null;

function startTrip(r) {
  const t = DB.get('trip', null);
  if (t && t.active && t.routeId === r.id) { nav('trip'); return; }
  const p = DB.get('profile', {});
  const hours = r.days >= 3 ? 72 : r.days === 2 ? 36 : 12;
  const deadline = Date.now() + hours * 3600e3;
  const trip = {
    routeId: r.id, active: true, startedAt: Date.now(), deadline,
    points: [], pos: null, notified: false, linkId: Math.random().toString(36).slice(2, 8)
  };
  DB.set('trip', trip);
  startWatch();
  nav('trip');
}

function startWatch() {
  stopWatch();
  if (!navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(
    pos => {
      const t = DB.get('trip', null); if (!t || !t.active) return;
      t.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() };
      const last = t.points[t.points.length - 1];
      if (!last || Math.abs(last.lat - t.pos.lat) + Math.abs(last.lng - t.pos.lng) > 0.0003)
        t.points.push({ lat: t.pos.lat, lng: t.pos.lng, at: Date.now() });
      DB.set('trip', t);
      if (!document.getElementById('screen-trip').hidden) renderTrip();
    },
    err => { console.log('geo err', err); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}
function stopWatch() { if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
function lastPos(t) { return t.pos ? [t.pos.lat, t.pos.lng] : null; }

function renderTrip() {
  const t = DB.get('trip', null);
  if (!t || !t.active) {
    document.getElementById('trip-name').textContent = 'Поход не начат';
    document.getElementById('trip-deadline').textContent = '—';
    document.getElementById('trip-status').textContent = 'Выберите маршрут на главной';
    document.getElementById('trip-stats').innerHTML = '';
    document.getElementById('trip-live').hidden = true;
    document.getElementById('trip-overdue').hidden = true;
    return;
  }
  const r = rById(t.routeId);
  document.getElementById('trip-name').textContent = r.name;
  document.getElementById('trip-live').hidden = false;

  const dl = new Date(t.deadline);
  document.getElementById('trip-deadline').textContent =
    dl.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) +
    (dl.toDateString() !== new Date().toDateString() ? ', ' + dl.toLocaleDateString('ru', { day: 'numeric', month: 'short' }) : '');

  const overdue = Date.now() > t.deadline;
  const box = document.querySelector('.trip-timer');
  box.classList.toggle('overdue', overdue);
  document.getElementById('trip-status').textContent = overdue
    ? '⚠ Срок прошёл — отчитайтесь или отправьте метку'
    : 'Таймер отчёта активен · через ' + fmtLeft(t.deadline - Date.now());

  // карта
  const canvas = document.getElementById('trip-map');
  canvas.style.height = '190px';
  MapRender.draw(canvas, r.track, {
    you: lastPos(t),
    youAcc: t.pos ? t.pos.acc : 0,
    progress: MapRender.progressOf(r.track, lastPos(t)),
    poi: r.poi
  });

  // статистика
  const mins = Math.round((Date.now() - t.startedAt) / 60000);
  document.getElementById('trip-stats').innerHTML = `
    <div class="stat"><b>${fmtLeft(Date.now() - t.startedAt)}</b><span>в пути</span></div>
    <div class="stat"><b>${t.points.length}</b><span>точек трека</span></div>
    <div class="stat"><b>${t.pos ? '±' + Math.round(t.pos.acc) + ' м' : 'нет'}</b><span>точность GPS</span></div>
    <div class="stat"><b>${r.km}</b><span>км по плану</span></div>`;

  // overdue-бокс
  const ob = document.getElementById('trip-overdue');
  ob.hidden = !overdue;
  if (overdue && !t.notified) {
    t.notified = true; DB.set('trip', t);
    IncidentService.report('OVERDUE', {
      loc: t.pos ? { lat: t.pos.lat, lon: t.pos.lng, accuracy_m: Math.round(t.pos.acc) } : null,
      route: r.id, deadline: new Date(t.deadline).toISOString()
    });
    const p = DB.get('profile', {});
    document.getElementById('trip-overdue-text').textContent =
      `По плану вы должны были вернуться в ${new Date(t.deadline).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}. ` +
      (p.contactName ? `Мы подготовили сообщение для ${p.contactName}.` : 'Добавьте контакт близкого.');
  }
  document.getElementById('trip-track').hidden = !t.pos;
}
function fmtLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

document.getElementById('trip-report').onclick = () => {
  const t = DB.get('trip', null); if (!t) return;
  t.active = false;
  IncidentService.report('SAFE_RETURN', { route: t.routeId, loc: t.pos ? { lat: t.pos.lat, lon: t.pos.lng } : null });
  const hist = DB.get('history', []);
  hist.unshift({ routeId: t.routeId, at: t.startedAt, minutes: Math.round((Date.now() - t.startedAt) / 60000), points: t.points.length });
  DB.set('history', hist);
  DB.set('trip', null);
  stopWatch();
  toast('✓ Поход завершён, близкие уведомлены');
  nav('home');
};
document.getElementById('trip-overdue-ok').onclick = () => {
  const t = DB.get('trip', null); if (!t) return;
  t.deadline = Date.now() + 3600e3; t.notified = false; DB.set('trip', t);
  renderTrip(); toast('Срок продлён на 1 час');
};
document.getElementById('trip-overdue-sms').onclick = () => { openSms(smsBody()); };
document.getElementById('trip-sos').onclick = () => nav('sos');
document.getElementById('trip-track').onclick = () => { shareText(linkText()); };

/* ───────── ссылка-метка ─────────
   Данные похода кодируются в саму ссылку → работает без сервера. */
function tripLink() {
  const t = DB.get('trip', null); if (!t) return '';
  const p = DB.get('profile', {});
  const r = rById(t.routeId);
  const payload = {
    n: p.name, c: p.contactName, ph: p.contactPhone, r: r.name,
    p: t.points.slice(-40).map(pt => [+pt.lat.toFixed(5), +pt.lng.toFixed(5), Math.round(pt.at / 60000)]),
    d: Math.round(t.deadline / 60000), s: Math.round(t.startedAt / 60000)
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const raw = (DB.get('linkBase', 'share.html#') || 'share.html#').replace(/#$/, '');
  return raw.endsWith('/') ? raw + b64 : raw + '#' + b64;
}
function linkText() {
  const t = DB.get('trip', null); if (!t) return '';
  const r = rById(t.routeId);
  let s = `Я в походе: «${r.name}». План: вернуться до ${new Date(t.deadline).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}. Метка: ${tripLink()}`;
  if (t.pos) s += `\nМои координаты: ${t.pos.lat.toFixed(5)}, ${t.pos.lng.toFixed(5)}`;
  return s;
}
function smsBody() { return linkText(); }
function openSms(body) {
  const p = DB.get('profile', {});
  const phone = p.contactPhone || '';
  window.location.href = `sms:${phone}?body=${encodeURIComponent(body)}`;
}
function shareText(text) {
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else { copy(text); toast('Скопировано — отправьте близкому'); }
}
function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

/* ───────── SOS ───────── */
function initSos() {
  document.getElementById('sos-result').hidden = true;
  document.getElementById('sos-coords').textContent = 'Определяем координаты…';
  document.getElementById('sos-accuracy').textContent = '';
  document.querySelectorAll('#sos-channels .ch-status').forEach(s => {
    s.className = 'ch-status'; s.textContent = s.dataset.s || 'готов';
  });
  const st = document.querySelectorAll('#sos-channels .ch-status');
  st[0].textContent = 'готов'; st[1].textContent = 'готов'; st[2].textContent = 'готов';
  st[3].textContent = 'в очереди'; st[3].className = 'ch-status wait';

  const show = pos => {
    document.getElementById('sos-coords').textContent =
      pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5);
    document.getElementById('sos-accuracy').textContent =
      'точность ±' + Math.round(pos.coords.accuracy) + ' м · GPS работает без интернета';
  };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(show, e => {
      const t = DB.get('trip', null);
      if (t && t.pos) show({ coords: { latitude: t.pos.lat, longitude: t.pos.lng, accuracy: t.pos.acc } });
      else document.getElementById('sos-coords').textContent = 'Нет GPS-сигнала — выйдите на открытое место';
    }, { enableHighAccuracy: true, timeout: 10000 });
  }
}

document.getElementById('sos-send').onclick = () => {
  const t = DB.get('trip', null);
  const p = DB.get('profile', {});
  const loc = t && t.pos ? { lat: t.pos.lat, lon: t.pos.lng, accuracy_m: Math.round(t.pos.acc) } : null;
  const ev = IncidentService.report('SOS', { loc, route: t ? t.routeId : null, deadline: t ? new Date(t.deadline).toISOString() : null });

  const st = document.querySelectorAll('#sos-channels .ch-status');
  const coords = loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : 'координаты уточняются';
  const msg = `SOS! ${p.name || 'Турист'} в опасности. Координаты: ${coords}. ` +
    (t ? `Маршрут: ${rById(t.routeId).name}. ` : '') + `Метка: ${tripLink() || '—'}`;

  st[0].textContent = 'отправлено'; st[0].className = 'ch-status sent';
  st[1].textContent = 'нажмите «Позвонить»'; st[1].className = 'ch-status ok';
  st[2].textContent = 'отправлено'; st[2].className = 'ch-status sent';
  st[3].textContent = 'в очереди (нужен шлюз)'; st[3].className = 'ch-status wait';

  const box = document.getElementById('sos-result');
  box.hidden = false;
  box.innerHTML = `<b>Инцидент ${ev.incident_id} создан.</b><br>
    ${msg}<br><br>
    <span style="color:var(--dim)">Канал «родственник»: отправлено.
    Канал «МЧС»: событие в очереди — подключается шлюзом (см. раздел «Службы спасения»).</span>
    <div class="row"><button class="btn ghost" id="sos-copy">Копировать сообщение</button></div>`;
  document.getElementById('sos-copy').onclick = () => { copy(msg); toast('Скопировано'); };
  copy(msg);
};
document.getElementById('sos-call').onclick = () => {
  const p = DB.get('profile', {});
  if (p.contactPhone) window.location.href = 'tel:' + p.contactPhone.replace(/\s/g, '');
  else toast('Добавьте контакт близкого в онбординге');
};
document.getElementById('sos-back').onclick = () => nav('trip');

/* ───────── близкие ───────── */
function renderFamily() {
  const p = DB.get('profile', {});
  document.getElementById('fam-name').value = p.contactName || '';
  document.getElementById('fam-phone').value = p.contactPhone || '';
  document.getElementById('fam-base').value = DB.get('linkBase', 'share.html#');
  const t = DB.get('trip', null);
  document.getElementById('fam-link').textContent =
    (t && t.active) ? tripLink() : 'Поход не начат — метка появится при старте';
}
document.getElementById('fam-base-save').onclick = () => {
  const v = document.getElementById('fam-base').value.trim();
  if (!v) { toast('Введите адрес'); return; }
  DB.set('linkBase', v); toast('✓ Адрес сохранён'); renderFamily();
};
document.getElementById('fam-save').onclick = () => {
  const p = DB.get('profile', {});
  p.contactName = document.getElementById('fam-name').value.trim();
  p.contactPhone = document.getElementById('fam-phone').value.trim();
  DB.set('profile', p); toast('✓ Контакт сохранён');
};
document.getElementById('fam-copy').onclick = () => {
  const t = DB.get('trip', null);
  if (!t || !t.active) { toast('Поход не начат'); return; }
  copy(tripLink()); toast('Ссылка скопирована');
};
document.getElementById('fam-sms').onclick = () => {
  const t = DB.get('trip', null);
  if (!t || !t.active) { toast('Поход не начат'); return; }
  openSms(smsBody());
};

/* ───────── история ───────── */
function renderHistory() {
  const hist = DB.get('history', []);
  const el = document.getElementById('hist-list');
  if (!hist.length) { el.innerHTML = '<div class="hint">Пока пусто — завершите первый поход.</div>'; return; }
  el.innerHTML = hist.map(h => {
    const r = rById(h.routeId);
    return `<div class="card"><div class="card-top"><div>
      <div class="card-name">${r ? r.name : h.routeId}</div>
      <div class="card-region">${new Date(h.at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div></div>
      <div class="card-meta"><span>⏱ ${h.minutes} мин</span><span>📍 ${h.points} точек</span></div></div>`;
  }).join('');
}

/* ───────── МЧС ───────── */
function renderMchs() {
  document.getElementById('mchs-sample').textContent = JSON.stringify({
    incident_id: 'inc_k7x2q9',
    type: 'SOS',
    severity: 'high',
    tourist: { name: 'Айгуль', phone: '+77001234567' },
    location: { lat: 43.147, lon: 78.232, accuracy_m: 12 },
    route: 'kolsai',
    last_signal_at: '2026-11-25T15:03:00+06:00',
    planned_return: '2026-11-25T18:00:00+06:00',
    status: 'open'
  }, null, 2);

  const q = IncidentService.list();
  const el = document.getElementById('mchs-queue');
  el.innerHTML = q.length ? q.map(e => `
    <div class="card"><div class="card-top">
      <div><div class="card-name">${e.type} · ${e.incident_id}</div>
      <div class="card-region">${e.location ? e.location.lat.toFixed(3) + ', ' + e.location.lon.toFixed(3) : 'без координат'} · ${new Date(e.last_signal_at).toLocaleTimeString('ru')}</div></div>
      <span class="tag ${e.status === 'open' ? 'nosig' : 'rec'}">${e.status === 'open' ? 'в очереди' : 'закрыт'}</span>
    </div>
    <div class="card-meta">
      <span>родственник: ${e.channels.relative}</span><span>МЧС: ${e.channels.mchs}</span>
      ${e.status === 'open' ? `<button class="btn ghost" style="padding:4px 10px;font-size:12px" data-resolve="${e.incident_id}">закрыть</button>` : ''}
    </div></div>`).join('')
    : '<div class="hint">Очередь пуста. Инциденты создаются при SOS и просрочке возврата.</div>';
}
document.getElementById('mchs-queue').addEventListener('click', e => {
  const b = e.target.closest('[data-resolve]'); if (!b) return;
  IncidentService.resolve(b.dataset.resolve); renderMchs();
});
document.getElementById('mchs-demo').onclick = () => {
  IncidentService.report('SOS', { loc: { lat: 43.147, lon: 78.232, accuracy_m: 12 }, route: 'kolsai' });
  renderMchs(); toast('Демо-инцидент создан');
};

/* ───────── misc ───────── */
document.getElementById('more-reset').onclick = () => {
  if (confirm('Пройти онбординг заново? Данные походов сохранятся.')) {
    localStorage.removeItem('profile'); location.reload();
  }
};
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:100px;transform:translateX(-50%);background:#1f2630;border:1px solid #2b3441;color:#e6edf3;padding:10px 18px;border-radius:10px;z-index:99;font-size:14px;max-width:90%;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 2200);
}

/* ───────── старт ───────── */
(function init() {
  // тикер таймера — всегда, даже сразу после онбординга
  setInterval(() => {
    if (!document.getElementById('screen-trip').hidden) renderTrip();
  }, 30000);

  const p = DB.get('profile', null);
  if (p) { resumeWatch(); nav('home'); } else { nav('onboarding'); obRender(); }
})();
function resumeWatch() {
  const t = DB.get('trip', null);
  if (t && t.active) startWatch();
}
