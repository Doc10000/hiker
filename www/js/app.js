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

/* ───────── SMS и контакты (нативный плагин HikerNative) ─────────
   В APK отправка идёт напрямую (SmsManager), без открытия «Сообщений».
   В вебе плагина нет — открываем редактор SMS как запасной вариант. */
const Native = {
  ok() {
    try {
      return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.HikerNative);
    } catch (e) { return false; }
  },
  sendSms(to, message) {
    return window.Capacitor.Plugins.HikerNative.sendSms({ to, message });
  },
  listContacts() {
    return window.Capacitor.Plugins.HikerNative.listContacts();
  }
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function initialOf(name) {
  const s = String(name || '?').trim();
  return esc((s.charAt(0) || '?').toUpperCase());
}

function getContacts() { return DB.get('contacts', []); }
function setContacts(list) { DB.set('contacts', list); }
function notifyPhones() {
  return getContacts().filter(c => c.notify !== false && c.phone).map(c => c.phone);
}
function addContact(name, phone) {
  phone = String(phone || '').trim();
  if (!phone) return false;
  const list = getContacts();
  if (list.some(c => c.phone === phone)) return false;
  list.push({
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: String(name || '').trim() || phone,
    phone, notify: true
  });
  setContacts(list);
  return true;
}
function removeContact(id) { setContacts(getContacts().filter(c => c.id !== id)); }
function toggleNotify(id) {
  const list = getContacts();
  const c = list.find(x => x.id === id);
  if (c) { c.notify = !(c.notify !== false); setContacts(list); }
}

/** Отправить SMS всем отмеченным. Веб → открываем редактор сообщения. */
async function sendSmsToAll(text) {
  const phones = notifyPhones();
  const res = { sent: [], failed: [], web: false, count: phones.length };
  if (!phones.length) return res;
  if (!Native.ok()) {
    res.web = true;
    try { window.location.href = 'sms:' + phones[0] + '?body=' + encodeURIComponent(text); } catch (e) {}
    return res;
  }
  for (const ph of phones) {
    try { await Native.sendSms(ph, text); res.sent.push(ph); }
    catch (e) { res.failed.push(ph); console.log('sms error', ph, e); }
  }
  return res;
}
function smsResultText(res) {
  if (!res.count) return 'Контакты не выбраны';
  if (res.web) return 'Открыт редактор SMS (' + res.count + ')';
  if (res.sent.length && !res.failed.length) return 'Отправлено: ' + res.sent.length;
  if (res.sent.length) return 'Отправлено: ' + res.sent.length + ', ошибок: ' + res.failed.length;
  return 'Не отправлено — проверьте разрешение SMS';
}

/* ───────── сервер метки: живое обновление для близких ───────── */
function serverBase() {
  return String(DB.get('serverBase', '') || '').trim().replace(/\/+$/, '');
}

/** Отправить текущее состояние похода на локальный сервер метки */
function pushTrack(status) {
  const base = serverBase();
  const t = DB.get('trip', null);
  if (!base || !t) return Promise.resolve(null);
  const p = DB.get('profile', {});
  const r = rById(t.routeId);
  const body = {
    tripId: t.linkId || 'trip',
    lat: t.pos ? t.pos.lat : null,
    lng: t.pos ? t.pos.lng : null,
    acc: t.pos ? Math.round(t.pos.acc) : null,
    at: Date.now(),
    status: status || (t.active ? 'ok' : 'arrived'),
    name: p.name || '',
    route: r ? r.name : '',
    deadline: t.deadline || null,
    startedAt: t.startedAt || null
  };
  const json = JSON.stringify(body);
  // в APK — нативный POST (иначе WebView режет http:// как mixed content)
  try {
    const P = window.Capacitor && window.Capacitor.Plugins &&
              window.Capacitor.Plugins.HikerNative;
    if (P && P.trackPush) {
      return P.trackPush({ url: base + '/api/track', body: json })
        .then(r => (r && r.ok ? { ok: true } : null))
        .catch(() => null);
    }
  } catch (e) { /* веб — идём через fetch */ }
  return fetch(base + '/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json
  }).then(res => res.json()).catch(() => null);
}

document.getElementById('fam-server').value = DB.get('serverBase', '');
document.getElementById('fam-server-save').onclick = () => {
  const v = document.getElementById('fam-server').value.trim().replace(/\/+$/, '');
  DB.set('serverBase', v);
  if (!v) { toast('Сервер отключён — метка работает по ссылке'); return; }
  pushTrack().then(r2 => {
    toast(r2 && r2.ok ? '✓ Сервер сохранён, метка обновляется' : '✗ Сервер не отвечает');
  });
};

/* ───────── уровень, риск, планы ───────── */
function plural(n, forms) {
  const f = forms || ['поход', 'похода', 'походов'];
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return f[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return f[1];
  return f[2];
}

function tripStats() {
  const hist = DB.get('history', []);
  const km = hist.reduce((s, h) => s + ((rById(h.routeId) || {}).km || 0), 0);
  const maxDiff = hist.reduce((m, h) => Math.max(m, (rById(h.routeId) || {}).difficulty || 0), 0);
  return { done: hist.length, km: Math.round(km), maxDiff };
}

/** Уровень = заявленный опыт + фактически пройденные походы */
function effectiveLevel() {
  const p = DB.get('profile', {});
  const st = tripStats();
  const reported = [0, 1, 4, 10][p.hikes == null ? 0 : p.hikes] || 0;
  const score = reported + st.done * 1.5;
  let lvl = score >= 12 ? 3 : score >= 4 ? 2 : 1;
  if (st.maxDiff >= 4) lvl = 3;
  else if (st.maxDiff >= 3 && lvl < 2) lvl = 2;
  // походов пока нет — не занижаем уровень, который человек заявил сам
  if (!st.done && (p.level || 1) > lvl) lvl = p.level || 1;
  return lvl;
}
function levelInfo() {
  const st = tripStats();
  return { level: effectiveLevel(), done: st.done, km: st.km, maxDiff: st.maxDiff };
}

function riskCat(score) {
  if (score < 25) return { i: 0, t: 'Низкий', cls: 'ok' };
  if (score < 50) return { i: 1, t: 'Средний', cls: 'mid' };
  if (score < 75) return { i: 2, t: 'Высокий', cls: 'high' };
  return { i: 3, t: 'Очень высокий', cls: 'crit' };
}

/** Оценка риска маршрута под конкретный профиль */
function assessRisk(r) {
  const p = DB.get('profile', {});
  const gear = p.gear || [];
  const lvl = effectiveLevel();
  const reasons = [];
  let score = 0;

  if (r.difficulty > lvl) { score += 35; reasons.push({ t: `Маршрут сложнее вашего уровня (${r.difficulty} из 5 при уровне ${lvl})`, s: 35 }); }
  else if (r.difficulty === lvl) { score += 15; reasons.push({ t: 'Маршрут на пределе вашего уровня', s: 15 }); }

  if (r.alt > 3000) { score += 20; reasons.push({ t: `Высота ${r.alt} м — риск горной болезни`, s: 20 }); }
  else if (r.alt > 2600) { score += 10; reasons.push({ t: `Высота ${r.alt} м`, s: 10 }); }

  if (r.noSignal) { score += 15; reasons.push({ t: 'Нет мобильной связи на всём треке', s: 15 }); }
  if (r.days >= 3) { score += 12; reasons.push({ t: `Многодневка: ${r.days} дня без инфраструктуры`, s: 12 }); }
  else if (r.days >= 2) { score += 6; reasons.push({ t: `Ночёвка на маршруте (${r.days} дня)`, s: 6 }); }

  if (r.days >= 2 && !gear.includes('tent')) { score += 12; reasons.push({ t: 'Не отмечена палатка', s: 12 }); }
  if (r.days >= 2 && !gear.includes('bag')) { score += 10; reasons.push({ t: 'Не отмечен спальник', s: 10 }); }
  if (!gear.includes('aid')) { score += 8; reasons.push({ t: 'Не отмечена аптечка', s: 8 }); }
  if (r.noSignal && !gear.includes('bank')) { score += 8; reasons.push({ t: 'Нет пауэрбанка при отсутствии связи', s: 8 }); }
  if (r.difficulty >= 3 && !gear.includes('nav')) { score += 6; reasons.push({ t: 'Нет навигатора/часов с треком', s: 6 }); }
  if (gear.includes('none')) { score += 10; reasons.push({ t: 'В онбординге отмечено «почти ничего»', s: 10 }); }
  if (!notifyPhones().length) { score += 10; reasons.push({ t: 'Не указан контакт для уведомления', s: 10 }); }

  score = Math.min(100, score);
  return { score, reasons: reasons.sort((a, b) => b.s - a.s), cat: riskCat(score), level: lvl };
}

/** Маршруты полегче — если риск выше среднего */
function altRoutes(r) {
  const lvl = effectiveLevel();
  return ROUTES
    .filter(x => x.id !== r.id && x.difficulty <= lvl)
    .map(x => ({ r: x, risk: assessRisk(x).score }))
    .sort((a, b) => a.risk - b.risk || b.r.difficulty - a.r.difficulty)
    .slice(0, 2);
}

/* запланированные походы */
function getPlanned() { return DB.get('planned', []); }
function setPlanned(l) { DB.set('planned', l); }
function addPlanned(routeId, at) {
  const l = getPlanned();
  l.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), routeId, at, createdAt: Date.now() });
  l.sort((a, b) => a.at - b.at);
  setPlanned(l);
}
function removePlanned(id) { setPlanned(getPlanned().filter(x => x.id !== id)); }

/* ───────── навигация ───────── */
const screens = [...document.querySelectorAll('.screen')];
const tabbar = document.getElementById('tabbar');
const TABS = ['home', 'trip', 'family', 'more'];
let navStack = [];

function currentScreenId() {
  const el = screens.find(s => !s.hidden);
  return el ? el.id.replace('screen-', '') : null;
}

function nav(id, opts) {
  opts = opts || {};
  const cur = currentScreenId();
  if (!opts.replace && cur && cur !== id) {
    if (TABS.includes(id)) {
      // корневые экраны: стек обнуляется (из вкладки назад — на главную)
      navStack = (id === 'home') ? [] : ['home'];
    } else {
      navStack.push(cur);
      if (navStack.length > 30) navStack.shift();
    }
  }

  screens.forEach(s => s.hidden = s.id !== 'screen-' + id);
  const isMain = TABS.includes(id) && DB.get('profile', null);
  tabbar.hidden = !isMain;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.nav === id));
  if (id === 'home') renderHome();
  if (id === 'family') renderFamily();
  if (id === 'history') renderHistory();
  if (id === 'mchs') renderMchs();
  if (id === 'trip') { ensureLocation(); renderTrip(); }
  if (id === 'sos') initSos();
  if (id === 'route' && currentRoute) requestAnimationFrame(() => showRoute(currentRoute));
  window.scrollTo(0, 0);
  applyI18n();
}

/** Назад по стеку (кнопки «←» и системная кнопка Android). */
function back() {
  const cur = currentScreenId();
  const prev = navStack.pop();
  if (prev && prev !== cur) { nav(prev, { replace: true }); return true; }
  if (cur && cur !== 'home') { nav('home', { replace: true }); return true; }
  return false;
}

/* системная кнопка «назад» Android → вызывает нативный код */
window.__nativeBack = function () {
  if (navStack.length) { back(); return true; }
  const cur = currentScreenId();
  if (cur && cur !== 'home') { nav('home', { replace: true }); return true; }
  return false; // на главной — выходим из приложения
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-nav]');
  if (el) nav(el.dataset.nav);
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-back]');
  if (el) { e.preventDefault(); back(); }
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-lang]');
  if (!el) return;
  setLang(el.dataset.lang);
  if (currentScreenId() === 'lang') {
    // первый экран: язык выбран — уходим в онбординг
    nav('onboarding');
    obRender();
  } else {
    toast('✓ ' + langName(el.dataset.lang));
  }
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
  const info = levelInfo();
  document.getElementById('home-greet').textContent = 'Привет, ' + (p.name || 'хайкер');
  document.getElementById('home-level').textContent =
    `Уровень ${levelLabel(info.level)} · ${info.done} ${plural(info.done)} · ${info.km} км`;

  const rec = ROUTES.filter(r => r.difficulty <= info.level);
  const rest = ROUTES.filter(r => r.difficulty > info.level);
  fill('routes-recommended', rec);
  fill('routes-all', rest);
  renderPlanned();

  const banner = document.getElementById('home-banner');
  const t = DB.get('trip', null);
  if (t && t.active) {
    banner.hidden = false;
    banner.innerHTML = `<b>Идёт поход:</b> ${esc(rById(t.routeId).name)} — <a href="#" data-nav="trip" style="color:var(--acc2)">открыть</a>`;
  } else banner.hidden = true;
}

/* ───────── запланированные походы на главной ───────── */
function renderPlanned() {
  const list = getPlanned();
  const title = document.getElementById('planned-title');
  const el = document.getElementById('planned-list');
  title.hidden = !list.length;
  if (!list.length) { el.innerHTML = ''; return; }

  const now = Date.now();
  el.innerHTML = list.map(pl => {
    const r = rById(pl.routeId);
    const d = new Date(pl.at);
    const left = pl.at - now;
    const when = d.toLocaleDateString('ru', { day: 'numeric', month: 'long' }) + ', ' +
      d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const leftTxt = left > 0
      ? (left >= 864e5 ? 'через ' + Math.round(left / 864e5) + ' дн.' : 'через ' + Math.max(1, Math.round(left / 36e5)) + ' ч')
      : 'время пришло';
    const risk = r ? assessRisk(r) : null;
    const tagCls = !risk ? '' : risk.cat.i >= 2 ? 'nosig' : risk.cat.i === 1 ? '' : 'rec';
    return `<div class="card">
      <div class="card-top">
        <div>
          <div class="card-name">${esc(r ? r.name : pl.routeId)}</div>
          <div class="card-region">${when} · ${leftTxt}</div>
        </div>
        ${risk ? `<span class="tag ${tagCls}">риск: ${risk.cat.t.toLowerCase()}</span>` : ''}
      </div>
      <div class="card-meta">
        ${r ? `<span>⏱ ${r.days} д</span><span>📏 ${r.km} км</span><span>⛰ ${r.alt} м</span>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn ghost mini" data-plan-open="${pl.id}">Открыть</button>
        <button class="btn link mini" data-plan-del="${pl.id}">Удалить</button>
      </div>
    </div>`;
  }).join('');
}
document.getElementById('planned-list').addEventListener('click', e => {
  const open = e.target.closest('[data-plan-open]');
  if (open) {
    const pl = getPlanned().find(x => x.id === open.dataset.planOpen);
    if (pl) { currentRoute = rById(pl.routeId); nav('route'); }
    return;
  }
  const del = e.target.closest('[data-plan-del]');
  if (del) { removePlanned(del.dataset.planDel); renderPlanned(); toast('Удалено из планов'); }
});
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
        ${r.difficulty <= effectiveLevel() ? '<span class="tag rec">рекомендовано</span>' : ''}
      </div>
      <div class="card-strip"><canvas data-strip="${r.id}"></canvas></div>
    </div>`).join('');
  list.forEach(r => {
    const c = el.querySelector(`[data-strip="${r.id}"]`);
    requestAnimationFrame(() => MapRender.draw(c, r.path || r.track, { compact: true }));
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
  MapRender.draw(canvas, r.path || r.track, {
    you, youAcc, poi: r.poi, trails: r.trailPaths, routeKey: 'route:' + r.id
  });
  renderPoi(r);

  // уровень и риск — сразу на карточке маршрута
  const info = levelInfo();
  const risk = assessRisk(r);
  document.getElementById('route-badges').innerHTML =
    `<span class="chip">Ваш уровень: ${levelLabel(info.level)}</span>
     <span class="chip ${risk.cat.i >= 2 ? 'warn' : risk.cat.i === 1 ? '' : 'ok'}">Риск: ${risk.cat.t}</span>
     <span class="chip">Пройдено ${info.done} ${plural(info.done)}</span>`;

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
  const planBtn = document.getElementById('route-plan');
  planBtn.hidden = !!active;
  planBtn.disabled = !!active;

  applyI18n();   // showRoute вызывается через rAF — переводим после него
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
document.getElementById('route-plan').onclick = () => planTrip(currentRoute);
document.getElementById('route-checklist').onclick = () => { renderChecklist(currentRoute, 'view'); nav('checklist'); };

/* ───────── полноэкранная карта ─────────
   Кнопка ⛶ на карте похода/маршрута: карта разворачивается
   на весь экран, по ней можно водить пальцем. */
function toggleMapFs(wrapId, redraw) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const full = wrap.classList.toggle('fs');
  document.body.style.overflow = full ? 'hidden' : '';
  const btn = wrap.querySelector('.map-fs');
  if (btn) btn.textContent = full ? '✕' : '⛶';
  // перерисовка после смены размера (Leaflet invalidateSize внутри draw)
  requestAnimationFrame(() => requestAnimationFrame(() => redraw && redraw()));
}
document.getElementById('trip-map-fs').onclick = e => {
  e.stopPropagation();
  toggleMapFs('trip-map-wrap', () => {
    if (!document.getElementById('screen-trip').hidden) renderTrip();
  });
};
document.getElementById('route-map-fs').onclick = e => {
  e.stopPropagation();
  toggleMapFs('route-map-wrap', () => {
    if (currentRoute && !document.getElementById('screen-route').hidden) showRoute(currentRoute);
  });
};

// ⌖ — вернуть вид на весь маршрут (после зума кнопка не сбрасывается сама)
document.getElementById('route-map-fit').onclick = e => {
  e.stopPropagation();
  MapRender.fit(document.getElementById('route-map'));
};
document.getElementById('trip-map-fit').onclick = e => {
  e.stopPropagation();
  MapRender.fit(document.getElementById('trip-map'));
};

/* ───────── права на геолокацию ─────────
   Запрашиваем системное разрешение (в APK — через нативный плагин),
   чтобы метка «вы» и трек появлялись на карте похода. */
function ensureLocation() {
  try {
    const P = window.Capacitor && window.Capacitor.Plugins &&
              window.Capacitor.Plugins.HikerNative;
    if (P && P.requestLocation) {
      P.requestLocation()
        .then(r => { if (r && r.granted) startWatch(); })
        .catch(() => {});
    }
  } catch (e) { /* веб — разрешение запросит сам браузер */ }
}

/* ───────── чек-лист (обязательный перед стартом) ───────── */
let clState = {}; // {itemKey:true}
let clCats = [];
let clRoute = null;
let clMode = 'view';

function mustKeys() {
  const out = [];
  clCats.forEach(c => c.items.forEach(it => {
    if (it.pri === 'must') out.push(c.name + '|' + it.t);
  }));
  return out;
}

function updateClProgress() {
  const bar = document.getElementById('cl-progress');
  const btn = document.getElementById('cl-next');
  const gate = clMode === 'gate';
  bar.hidden = !gate;
  btn.hidden = !gate;
  if (!gate) return;

  const must = mustKeys();
  const done = must.filter(k => clState[k]).length;
  const all = must.length;
  const ack = !!DB.get('recsAck', false);
  const pct = all ? Math.round(done / all * 100) : 100;

  let hint;
  if (!ack) hint = 'Сначала отметьте «Ознакомился с рекомендациями».';
  else if (done < all) hint = `Отметьте, что собрали — осталось ${all - done}.`;
  else hint = '✓ Рекомендации приняты, критичное собрано';

  bar.innerHTML = `<div class="prog-row"><span>Обязательное снаряжение</span><b>${done} / ${all}</b></div>
    <div class="prog-track"><i style="width:${pct}%"></i></div>
    <div class="hint" style="margin-top:7px${(!ack || done === all) ? ';color:var(--acc)' : ''}">${hint}</div>`;

  btn.disabled = done < all || !ack;
  btn.textContent = (done < all || !ack)
    ? 'Ещё не всё готово'
    : (pendingAction === 'plan' ? 'Дальше — дата похода' : 'Дальше — уведомить близких');
  applyI18n();
}

/* ───────── единое окно рекомендаций (внутри списка снаряжения) ───────── */
function renderRecs(r) {
  const info = levelInfo();
  const p = DB.get('profile', {});
  const risk = assessRisk(r);
  const contacts = getContacts();
  const notif = contacts.filter(c => c.notify !== false);
  const fit = ROUTES.filter(x => x.difficulty <= info.level).slice(0, 3);

  const items = [
    ['🎯', `Ваш уровень: <b>${levelLabel(info.level)}</b> — ${info.done} ${plural(info.done)}, ${info.km} км пройдено`],
    ['🗺', fit.length
      ? `Подходят по уровню: <b>${fit.map(x => esc(x.name)).join('</b>, <b>')}</b>`
      : 'Пока нет маршрутов вашего уровня — пройдите больше походов'],
    ['⛰', `Идёте: <b>${esc(r.name)}</b> — ${r.days} дн., ${r.alt} м, сложность ${r.difficulty}/5, сезон ${r.season}`],
    ['⚠', `Оценка риска: <b>${risk.cat.t.toLowerCase()}</b> (${risk.score}/100)` +
      (risk.score >= 50 ? ' — перед стартом предложим маршрут полегче' : '')],
    ['⛑', 'Правила: идите группой, разворот — нормально, прогноз погоды проверьте утром'],
    ['📡', r.noSignal
      ? 'На маршруте <b>нет связи</b> — карта, метка и SOS работают офлайн'
      : 'Связь есть, но метку близким оставьте всё равно'],
    ['👥', notif.length
      ? `Тревогу получат: <b>${notif.map(c => esc(c.name)).join('</b>, <b>')}</b>`
      : '<b>Контакт не задан</b> — добавьте в разделе «Близкие»'],
    ['⏰', 'Не отметился до срока возврата — приложение <b>само</b> отправит SMS близким']
  ];

  document.getElementById('recs-body').innerHTML = items.map(([ic, t]) =>
    `<div class="recs-item"><span class="ri">${ic}</span><div>${t}</div></div>`).join('');
  document.getElementById('recs-ack').checked = !!DB.get('recsAck', false);
}

document.getElementById('recs-ack').addEventListener('change', e => {
  DB.set('recsAck', !!e.target.checked);
  updateClProgress();
});

function renderChecklist(r, mode) {
  clMode = mode || 'view';
  clRoute = r;
  const p = DB.get('profile', {});
  clCats = buildChecklist(Object.assign({}, p, { level: effectiveLevel() }), r);
  clState = DB.get('cl_' + r.id, {});

  // то, что уже есть в рюкзаке, считаем собранным
  let changed = false;
  clCats.forEach(c => c.items.forEach(it => {
    const key = c.name + '|' + it.t;
    if (it.pri === 'have' && clState[key] === undefined) { clState[key] = true; changed = true; }
  }));
  if (changed) DB.set('cl_' + r.id, clState);

  const info = levelInfo();
  document.getElementById('cl-gen-note').innerHTML =
    (clMode === 'gate' ? '<b>Обязательный шаг:</b> отметьте, что положили в рюкзак — без этого не выходим в поход.<br>' : '') +
    `Составлено под уровень <b>${levelLabel(info.level)}</b>, маршрут «${esc(r.name)}» (${r.days} дн., ${r.alt} м), сезон: ${r.season}. Работает офлайн.`;

  document.getElementById('cl-list').innerHTML = clCats.map(c => `
    <div class="cl-cat">${c.name}</div>
    ${c.items.map(it => {
      const key = c.name + '|' + it.t;
      const done = clState[key];
      const priCls = it.pri === 'must' ? 'pri-must' : it.pri === 'have' ? 'pri-have' : 'pri-should';
      const priTxt = it.pri === 'must' ? 'критично' : it.pri === 'have' ? 'есть' : 'рекомендуется';
      return `<div class="cl-item ${done ? 'done' : ''}" data-key="${key}">
        <div class="cl-box">${done ? '✓' : ''}</div>
        <div class="cl-text">${esc(it.t)}</div>
        <span class="cl-pri ${priCls}">${priTxt}</span></div>`;
    }).join('')}`).join('');

  renderRecs(r);
  updateClProgress();
}
document.getElementById('cl-list').addEventListener('click', e => {
  const it = e.target.closest('.cl-item'); if (!it || !clRoute) return;
  const key = it.dataset.key;
  clState[key] = !clState[key];
  DB.set('cl_' + clRoute.id, clState);
  // обновляем только этот пункт — не перерисовываем список, скролл не сбрасывается
  const done = clState[key];
  it.classList.toggle('done', done);
  it.querySelector('.cl-box').textContent = done ? '✓' : '';
  updateClProgress();
});
document.getElementById('cl-next').onclick = () => {
  if (!pendingRoute) { back(); return; }
  if (pendingAction === 'plan') { renderPlan(pendingRoute); nav('plan'); }
  else { renderNotify(pendingRoute); nav('notify'); }
};
document.getElementById('cl-share').onclick = () => {
  const p = DB.get('profile', {});
  const r = clRoute || currentRoute;
  const lines = [...document.querySelectorAll('#cl-list .cl-item')].map(el =>
    (clState[el.dataset.key] ? '[✓] ' : '[ ] ') + el.querySelector('.cl-text').textContent);
  shareText(`Снаряжение на «${r.name}» (${p.name}):\n` + lines.join('\n'));
};

/* ───────── поход ───────── */
let watchId = null;
let pendingRoute = null;
let pendingAction = 'start';

function tripHours(r) { return r.days >= 3 ? 72 : r.days === 2 ? 36 : 12; }

function makeTrip(r) {
  return {
    routeId: r.id, active: true, startedAt: Date.now(),
    deadline: Date.now() + tripHours(r) * 3600e3,
    points: [], pos: null, notified: false, linkId: Math.random().toString(36).slice(2, 8)
  };
}

/** «Начать поход» → сначала оценка риска */
function startTrip(r) {
  const t = DB.get('trip', null);
  if (t && t.active) {
    if (t.routeId === r.id) { nav('trip'); return; }
    toast('Уже идёт другой поход'); return;
  }
  pendingAction = 'start';
  openRisk(r);
}

/** «Запланировать» → та же оценка риска */
function planTrip(r) {
  const t = DB.get('trip', null);
  if (t && t.active) { toast('Сначала завершите текущий поход'); return; }
  pendingAction = 'plan';
  openRisk(r);
}

function openRisk(r) {
  pendingRoute = r;
  renderRisk(r);
  nav('risk');
}

/* ───────── экран: уровень и риски ───────── */
function renderRisk(r) {
  const info = levelInfo();
  const risk = assessRisk(r);

  document.getElementById('risk-note').innerHTML =
    `Маршрут: <b>${esc(r.name)}</b> · ваш уровень: <b>${levelLabel(info.level)}</b> — ${info.done} ${plural(info.done)}, ${info.km} км пройдено.`;

  const g = document.getElementById('risk-gauge');
  g.className = 'risk-gauge ' + risk.cat.cls;
  g.innerHTML = `<div class="risk-score">${risk.score}<span>/100</span></div>
    <div class="risk-cat">${risk.cat.t} риск</div>
    <div class="prog-track"><i style="width:${risk.score}%"></i></div>`;

  document.getElementById('risk-reasons').innerHTML = risk.reasons.length
    ? risk.reasons.map(x => `<div class="risk-item ${x.s >= 15 ? 'bad' : ''}">
        <span class="ri">${x.s >= 15 ? '⚠' : '•'}</span>
        <div><b>+${x.s}</b> — ${esc(x.t)}</div></div>`).join('')
    : `<div class="hint">Серьёзных рисков не найдено: профиль, снаряжение и маршрут подходят друг другу.</div>`;

  // если риск выше среднего — предлагаем маршруты полегче
  const altBox = document.getElementById('risk-alt');
  const alts = risk.score >= 50 ? altRoutes(r) : [];
  altBox.hidden = !alts.length;
  if (alts.length) {
    document.getElementById('risk-alt-title').textContent =
      'Риск выше среднего. Маршруты, которые вам по силам:';
    document.getElementById('risk-alt-list').innerHTML = alts.map(a => `
      <div class="card" data-alt="${a.r.id}">
        <div class="card-top">
          <div>
            <div class="card-name">${esc(a.r.name)}</div>
            <div class="card-region">${esc(a.r.region)}</div>
          </div>
          <span class="tag ${a.risk < 25 ? 'rec' : a.risk < 50 ? '' : 'nosig'}">риск ${a.risk}</span>
        </div>
        <div class="card-meta">
          <span>⏱ ${a.r.days} д</span><span>📏 ${a.r.km} км</span><span>⛰ ${a.r.alt} м</span>
          <span>сложность ${a.r.difficulty}/5</span>
        </div>
      </div>`).join('');
  }

  document.getElementById('risk-next').textContent =
    pendingAction === 'plan' ? 'Ок, планируем' : 'Понял, продолжить';
}

document.getElementById('risk-next').onclick = () => {
  if (!pendingRoute) { back(); return; }
  renderChecklist(pendingRoute, 'gate');   // дальше — только через обязательный чек-лист
  nav('checklist');
};
document.getElementById('risk-alt-list').addEventListener('click', e => {
  const c = e.target.closest('[data-alt]'); if (!c) return;
  openRisk(rById(c.dataset.alt));
});

/* ───────── экран: план похода ───────── */
function renderPlan(r) {
  document.getElementById('plan-note').innerHTML =
    `Маршрут: <b>${esc(r.name)}</b> · ${r.days} дн. · риск: <b>${assessRisk(r).cat.t.toLowerCase()}</b>.`;
  const inp = document.getElementById('plan-when');
  const d = new Date(Date.now() + 3 * 864e5);
  d.setHours(7, 0, 0, 0);
  const p2 = n => String(n).padStart(2, '0');
  inp.value = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

document.getElementById('plan-save').onclick = () => {
  const v = document.getElementById('plan-when').value;
  if (!v) { toast('Укажите дату и время'); return; }
  const at = new Date(v).getTime();
  if (isNaN(at)) { toast('Неверная дата'); return; }
  if (!pendingRoute) return;
  addPlanned(pendingRoute.id, at);
  toast('✓ Поход запланирован');
  nav('home');
};
document.getElementById('plan-now').onclick = () => {
  if (!pendingRoute) return;
  pendingAction = 'start';
  renderNotify(pendingRoute);
  nav('notify');
};

/* ───────── выбор получателей SMS перед стартом ───────── */
function renderNotify(r) {
  document.getElementById('notify-note').innerHTML =
    `Маршрут: <b>${esc(r.name)}</b> (${r.days} дн.). Выберите, кому отправить SMS — отправим автоматически при старте.`;

  const list = getContacts();
  const el = document.getElementById('notify-list');
  el.innerHTML = list.length ? list.map(c => `
    <div class="contact-item ${c.notify !== false ? 'on' : ''}">
      <div class="contact-av">${initialOf(c.name)}</div>
      <div class="contact-main">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-phone">${esc(c.phone)}</div>
      </div>
      <button class="contact-toggle" data-ntoggle="${c.id}">${c.notify !== false ? '✓ уведомить' : 'выкл'}</button>
    </div>`).join('')
    : '<div class="hint">Контактов пока нет — добавьте кнопкой «Из контактов» или начните без SMS.</div>';

  document.getElementById('notify-preview').textContent = notifyText(r);
}

function notifyText(r) {
  const tmp = makeTrip(r);
  return `Я в походе: «${r.name}». План: вернуться до ${new Date(tmp.deadline).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}. Метка: ${buildLink(tmp, r)}`;
}

function beginTrip(r, withSms) {
  const trip = makeTrip(r);
  DB.set('trip', trip);
  startWatch();
  pushTrack('ok');
  nav('trip');
  if (withSms) {
    sendSmsToAll(linkText()).then(res => toast(smsResultText(res)));
  } else {
    toast('Поход начат — без SMS');
  }
}

document.getElementById('notify-send').onclick = () => { if (pendingRoute) beginTrip(pendingRoute, true); };
document.getElementById('notify-skip').onclick = () => { if (pendingRoute) beginTrip(pendingRoute, false); };
document.getElementById('notify-all').onclick = () => {
  setContacts(getContacts().map(c => Object.assign({}, c, { notify: true })));
  if (pendingRoute) renderNotify(pendingRoute);
};
document.getElementById('notify-import').onclick = () => openContacts('notify');
document.getElementById('notify-list').addEventListener('click', e => {
  const b = e.target.closest('[data-ntoggle]'); if (!b) return;
  toggleNotify(b.dataset.ntoggle);
  if (pendingRoute) renderNotify(pendingRoute);
});

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
      // живая метка: шлём позицию на сервер раз в минуту
      if (Date.now() - (t.lastPush || 0) >= 60000) {
        t.lastPush = Date.now();
        pushTrack(t.active ? 'ok' : 'arrived');
      }
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
    applyI18n();
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
  const trail = r.path || r.track;
  MapRender.draw(canvas, trail, {
    you: lastPos(t),
    youAcc: t.pos ? t.pos.acc : 0,
    progress: MapRender.progressOf(trail, lastPos(t)),
    poi: r.poi,
    trails: r.trailPaths,
    routeKey: 'trip:' + t.routeId
  });

  // статистика
  const mins = Math.round((Date.now() - t.startedAt) / 60000);
  document.getElementById('trip-stats').innerHTML = `
    <div class="stat"><b>${fmtLeft(Date.now() - t.startedAt)}</b><span>в пути</span></div>
    <div class="stat"><b>${t.points.length}</b><span>точек трека</span></div>
    <div class="stat"><b>${t.pos ? '±' + Math.round(t.pos.acc) + ' м' : 'нет'}</b><span>точность GPS</span></div>
    <div class="stat"><b>${r.km}</b><span>км по плану</span></div>`;

  // overdue-бокс (саму тревогу шлёт checkTripClock — таймер, а не экран)
  const ob = document.getElementById('trip-overdue');
  ob.hidden = !overdue;
  if (overdue) {
    const p = DB.get('profile', {});
    document.getElementById('trip-overdue-text').textContent =
      `По плану вы должны были вернуться в ${new Date(t.deadline).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}. ` +
      (t.notified ? `Тревога уже ушла${t.sosLevel > 1 ? ' (повтор ' + t.sosLevel + '/3)' : ''}. ` : '') +
      (p.contactName ? `Сообщение для ${p.contactName} подготовлено.` : 'Добавьте контакт близкого.');
  }
  document.getElementById('trip-track').hidden = !t.pos;
  applyI18n();
  checkTripClock();
}
function fmtLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

/* ───────── автотревога: не отметился в срок ─────────
   Тикает каждую минуту (независимо от экрана):
   - за 30 мин до срока — напоминание «отметь, что дошёл»;
   - срок прошёл — авто-SMS всем отмеченным контактам;
   - повтор каждые 30 мин, всего3 попытки. */
const OVERDUE_REPEAT_MS = 30 * 60000;
const OVERDUE_MAX = 3;

function overdueMessage(t) {
  const p = DB.get('profile', {});
  const r = rById(t.routeId);
  const who = new Date(t.deadline).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return `ПРОСРОЧКА! ${p.name || 'Турист'} не отметился, что дошёл. ` +
    `Маршрут: ${r ? r.name : '-'}. План был вернуться до ${who}. ` +
    `Метка: ${tripLink() || '—'}`;
}

function checkTripClock() {
  const t = DB.get('trip', null);
  if (!t || !t.active) return;
  const now = Date.now();
  const left = t.deadline - now;

  // напоминание за 30 минут до срока
  if (left > 0 && left <= 30 * 60000 && !t.reminded) {
    t.reminded = true;
    DB.set('trip', t);
    toast('⏰ Через 30 мин срок возврата — отметь, что дошёл');
    pushTrack('ok');
  }

  if (left > 0) return;

  // срок прошёл — либо первый раз, либо прошло ≥30 мин с прошлой тревоги
  const since = t.lastOverdueSms || 0;
  const attempts = t.overdueAttempts || 0;
  if (t.notified && (now - since < OVERDUE_REPEAT_MS || attempts >= OVERDUE_MAX)) return;

  const r = rById(t.routeId);
  t.notified = true;
  t.lastOverdueSms = now;
  t.overdueAttempts = attempts + 1;
  t.sosLevel = t.overdueAttempts;
  DB.set('trip', t);

  IncidentService.report('OVERDUE', {
    loc: t.pos ? { lat: t.pos.lat, lon: t.pos.lng, accuracy_m: Math.round(t.pos.acc) } : null,
    route: t.routeId,
    deadline: new Date(t.deadline).toISOString(),
    attempt: t.overdueAttempts
  });
  pushTrack('overdue');

  const msg = overdueMessage(t);
  sendSmsToAll(msg).then(res => {
    toast(`⏱ Тревога ${t.overdueAttempts}/${OVERDUE_MAX}: ` + smsResultText(res));
    if (!document.getElementById('screen-trip').hidden) renderTrip();
  });
}

document.getElementById('trip-report').onclick = () => {
  const t = DB.get('trip', null); if (!t) return;
  t.active = false;
  IncidentService.report('SAFE_RETURN', { route: t.routeId, loc: t.pos ? { lat: t.pos.lat, lon: t.pos.lng } : null });
  pushTrack('arrived');
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
   Данные похода кодируются в саму ссылку → работает без сервера.
   База обязана быть абсолютной: относительная ссылка на телефоне
   родного не откроется (у приложения свой file:// origin). */
const SHARE_BASE = 'https://doc10000.github.io/hiker/www/share.html';
function linkBaseRaw() {
  let v = String(DB.get('linkBase', '') || '').trim().replace(/#$/, '');
  if (!/^https?:\/\//i.test(v)) v = SHARE_BASE;   // пусто или «share.html#» → Pages
  return v.replace(/#$/, '');
}
function buildLink(trip, r) {
  const p = DB.get('profile', {});
  const payload = {
    n: p.name, c: p.contactName, ph: p.contactPhone, r: r ? r.name : '',
    p: (trip.points || []).slice(-40).map(pt => [+pt.lat.toFixed(5), +pt.lng.toFixed(5), Math.round(pt.at / 60000)]),
    d: Math.round(trip.deadline / 60000), s: Math.round(trip.startedAt / 60000),
    srv: serverBase(), tid: trip.linkId || '', lng: LANG
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const raw = linkBaseRaw();
  return raw.endsWith('/') ? raw + b64 : raw + '#' + b64;
}
function tripLink() {
  const t = DB.get('trip', null); if (!t) return '';
  return buildLink(t, rById(t.routeId));
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
  pushTrack('sos');

  const st = document.querySelectorAll('#sos-channels .ch-status');
  const coords = loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : 'координаты уточняются';
  const msg = `SOS! ${p.name || 'Турист'} в опасности. Координаты: ${coords}. ` +
    (t ? `Маршрут: ${rById(t.routeId).name}. ` : '') + `Метка: ${tripLink() || '—'}`;

  st[0].textContent = notifyPhones().length ? 'отправка…' : 'нет контактов';
  st[0].className = 'ch-status' + (notifyPhones().length ? ' wait' : '');
  st[1].textContent = 'нажмите «Позвонить»'; st[1].className = 'ch-status ok';
  st[2].textContent = 'отправлено'; st[2].className = 'ch-status sent';
  st[3].textContent = 'в очереди (нужен шлюз)'; st[3].className = 'ch-status wait';

  const box = document.getElementById('sos-result');
  box.hidden = false;
  box.innerHTML = `<b>Инцидент ${ev.incident_id} создан.</b><br>
    ${msg}<br><br>
    <span style="color:var(--dim)">Канал «родственник»: <b id="sos-sms">отправка…</b>.
    Канал «МЧС»: событие в очереди — подключается шлюзом (см. раздел «Службы спасения»).</span>
    <div class="row"><button class="btn ghost" id="sos-copy">Копировать сообщение</button></div>`;
  document.getElementById('sos-copy').onclick = () => { copy(msg); toast('SOS скопировано'); };
  copy(msg);

  // SMS выбранным контактам уходит автоматически
  sendSmsToAll(msg).then(res => {
    const txt = smsResultText(res);
    st[0].textContent = txt;
    st[0].className = 'ch-status ' + (res.sent.length ? 'sent' : res.web ? 'ok' : 'wait');
    const s = document.getElementById('sos-sms');
    if (s) s.textContent = txt;
  });
};
document.getElementById('sos-call').onclick = () => {
  const p = DB.get('profile', {});
  if (p.contactPhone) window.location.href = 'tel:' + p.contactPhone.replace(/\s/g, '');
  else toast('Добавьте контакт близкого в онбординге');
};
document.getElementById('sos-back').onclick = () => back();

/* ───────── близкие ───────── */
function renderFamily() {
  const p = DB.get('profile', {});
  document.getElementById('fam-name').value = '';
  document.getElementById('fam-phone').value = '';
  document.getElementById('fam-base').value = linkBaseRaw();
  const t = DB.get('trip', null);
  document.getElementById('fam-link').textContent =
    (t && t.active) ? tripLink() : 'Поход не начат — метка появится при старте';
  renderFamilyContacts();
}

function renderFamilyContacts() {
  const el = document.getElementById('fam-contacts');
  const list = getContacts();
  if (!list.length) {
    el.innerHTML = '<div class="hint">Пока пусто. Добавьте вручную или из контактов устройства.</div>';
    return;
  }
  el.innerHTML = list.map(c => `
    <div class="contact-item ${c.notify !== false ? 'on' : ''}">
      <div class="contact-av">${initialOf(c.name)}</div>
      <div class="contact-main">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-phone">${esc(c.phone)}</div>
      </div>
      <button class="contact-toggle" data-toggle="${c.id}">${c.notify !== false ? 'уведомлять ✓' : 'выкл'}</button>
      <button class="contact-del" data-del="${c.id}">✕</button>
    </div>`).join('');
}
document.getElementById('fam-contacts').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) { removeContact(del.dataset.del); renderFamilyContacts(); return; }
  const tg = e.target.closest('[data-toggle]');
  if (tg) { toggleNotify(tg.dataset.toggle); renderFamilyContacts(); }
});

/* ───────── контакты устройства ───────── */
let deviceContacts = [];
let contactsReturn = 'family';

async function openContacts(returnTo) {
  contactsReturn = returnTo || 'family';
  nav('contacts');
  document.getElementById('ct-search').value = '';
  const hint = document.getElementById('ct-hint');
  const listEl = document.getElementById('ct-list');
  if (!Native.ok()) {
    hint.textContent = '';
    listEl.innerHTML = '<div class="hint">В веб-версии список недоступен — установи APK, тогда контакты устройства подтянутся автоматически.</div>';
    return;
  }
  hint.textContent = 'Загружаем контакты…';
  listEl.innerHTML = '';
  try {
    const res = await Native.listContacts();
    deviceContacts = (res && res.contacts) || [];
    hint.textContent = 'Найдено: ' + deviceContacts.length + '. Нажмите, чтобы добавить.';
    renderDeviceContacts('');
  } catch (e) {
    hint.textContent = '';
    listEl.innerHTML = '<div class="hint">Не удалось прочитать контакты: ' + esc(e && e.message || e) + '</div>';
  }
}

function renderDeviceContacts(q) {
  const el = document.getElementById('ct-list');
  q = String(q || '').toLowerCase().replace(/\s/g, '');
  const have = new Set(getContacts().map(c => c.phone));
  const list = deviceContacts.filter(c => {
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.replace(/\s/g, '').includes(q);
  }).slice(0, 200);
  el.innerHTML = list.length ? list.map(c => {
    const added = have.has(c.phone);
    return `<div class="contact-item ${added ? 'on' : ''}">
      <div class="contact-av">${initialOf(c.name)}</div>
      <div class="contact-main">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-phone">${esc(c.phone)}</div>
      </div>
      <button class="contact-toggle" ${added ? 'disabled' : ''} data-add-name="${esc(c.name)}" data-add-phone="${esc(c.phone)}">${added ? 'добавлено ✓' : '+ добавить'}</button>
    </div>`;
  }).join('') : '<div class="hint">Ничего не найдено.</div>';
}
document.getElementById('ct-search').addEventListener('input', e => renderDeviceContacts(e.target.value));
document.getElementById('ct-back').onclick = () => back();
document.getElementById('ct-list').addEventListener('click', e => {
  const b = e.target.closest('[data-add-phone]'); if (!b || b.disabled) return;
  if (addContact(b.dataset.addName, b.dataset.addPhone)) {
    toast('✓ Добавлен: ' + b.dataset.addName);
    renderDeviceContacts(document.getElementById('ct-search').value);
    if (contactsReturn === 'notify' && pendingRoute) renderNotify(pendingRoute);
    if (contactsReturn === 'family') renderFamilyContacts();
  }
});
document.getElementById('fam-base-save').onclick = () => {
  const v = document.getElementById('fam-base').value.trim();
  if (!v) { toast('Введите адрес'); return; }
  DB.set('linkBase', v); toast('✓ Адрес сохранён'); renderFamily();
};
document.getElementById('fam-save').onclick = () => {
  const name = document.getElementById('fam-name').value.trim();
  const phone = document.getElementById('fam-phone').value.trim();
  if (!phone) { toast('Введите телефон'); return; }
  if (addContact(name, phone)) {
    toast('✓ Контакт добавлен');
    document.getElementById('fam-name').value = '';
    document.getElementById('fam-phone').value = '';
    renderFamilyContacts();
  } else toast('Такой номер уже есть');
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
    document.body.appendChild(el);
  }
  el.textContent = msg;
  // источник для переводчика = текущий текст тоста
  if (el.firstChild) el.firstChild._src = msg;
  applyI18n();
  el.classList.remove('show');
  void el.offsetWidth; // перезапуск анимации
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ───────── старт ───────── */
(function init() {
  initLang();

  // миграция: старый единственный контакт → список
  const prof0 = DB.get('profile', null);
  if (prof0 && prof0.contactPhone && !getContacts().length) {
    addContact(prof0.contactName || 'Близкий', prof0.contactPhone);
  }

  // тикер таймера — всегда, даже сразу после онбординга
  setInterval(() => {
    if (!document.getElementById('screen-trip').hidden) renderTrip();
  }, 30000);

  // автотревога: тикает даже когда экран похода закрыт
  setInterval(checkTripClock, 60000);
  checkTripClock();

  const p = DB.get('profile', null);
  if (p) { resumeWatch(); nav('home'); }
  else { nav('lang'); }          // первый запуск — спрашиваем язык
})();
function resumeWatch() {
  const t = DB.get('trip', null);
  if (t && t.active) startWatch();
}
