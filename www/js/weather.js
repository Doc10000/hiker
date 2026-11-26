/* ───────── погода ─────────
   Источник: Open-Meteo (без ключа, CORS, офлайн-кэш в localStorage).
   Для точки старта маршрута берём текущий прогноз и ближайшие 6 часов,
   из худших значений считаем:
     — вердикт «можно ли идти в горы» (ok / warn / bad);
     — вклад погоды в общую оценку риска маршрута. */
const Weather = (function () {
  const TTL = 20 * 60 * 1000;   // кэш прогноза, мс
  const HORIZON = 6;            // окно анализа, часов

  /* коды погоды WMO: значок и описание */
  const WMO = {
    0: { icon: '☀️', t: 'Ясно' },
    1: { icon: '🌤', t: 'Малооблачно' },
    2: { icon: '⛅', t: 'Переменная облачность' },
    3: { icon: '☁️', t: 'Пасмурно' },
    45: { icon: '🌫', t: 'Туман' },
    48: { icon: '🌫', t: 'Изморозь' },
    51: { icon: '🌦', t: 'Слабая морось' },
    53: { icon: '🌦', t: 'Морось' },
    55: { icon: '🌦', t: 'Сильная морось' },
    56: { icon: '🌧', t: 'Ледяная морось' },
    57: { icon: '🌧', t: 'Сильная ледяная морось' },
    61: { icon: '🌦', t: 'Слабый дождь' },
    63: { icon: '🌧', t: 'Дождь' },
    65: { icon: '🌧', t: 'Сильный дождь' },
    66: { icon: '🌧', t: 'Ледяной дождь' },
    67: { icon: '🌧', t: 'Сильный ледяной дождь' },
    71: { icon: '🌨', t: 'Слабый снег' },
    73: { icon: '🌨', t: 'Снег' },
    75: { icon: '❄️', t: 'Сильный снег' },
    77: { icon: '❄️', t: 'Снежные зёрна' },
    80: { icon: '🌦', t: 'Слабый ливень' },
    81: { icon: '🌧', t: 'Ливень' },
    82: { icon: '🌧', t: 'Сильный ливень' },
    85: { icon: '🌨', t: 'Слабый снегопад' },
    86: { icon: '❄️', t: 'Сильный снегопад' },
    95: { icon: '⛈', t: 'Гроза' },
    96: { icon: '⛈', t: 'Гроза с градом' },
    99: { icon: '⛈', t: 'Сильная гроза с градом' }
  };

  const SNOW = [71, 73, 75, 77, 85, 86];
  const RAIN = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82];
  const FOG = [45, 48];

  /* насколько код опасен (для выбора «худшего» часа) */
  function sev(c) {
    if (c == null) return 0;
    if (c >= 95) return 5;                       // гроза
    if (c === 66 || c === 67) return 5;          // ледяной дождь
    if (c === 65 || c === 82 || c === 75 || c === 86) return 4;
    if (RAIN.indexOf(c) >= 0) return 3;
    if (SNOW.indexOf(c) >= 0) return 3;
    if (FOG.indexOf(c) >= 0) return 3;
    if (c === 3) return 1;
    if (c === 2 || c === 1) return 1;
    return 0;
  }
  function isRain(c) { return RAIN.indexOf(c) >= 0; }
  function isSnow(c) { return SNOW.indexOf(c) >= 0; }

  /* ── координаты точки старта ── */
  function coordsOf(r) {
    const pts = r.path || r.track || [];
    if (pts.length && pts[0].length >= 2) return { lat: pts[0][0], lng: pts[0][1] };
    if (r.poi && r.poi.length) return { lat: r.poi[0].lat, lng: r.poi[0].lng };
    return null;
  }
  function cacheKey(r) { return 'weather:' + r.id; }
  function cached(r) {
    try { return JSON.parse(localStorage.getItem(cacheKey(r))); } catch (e) { return null; }
  }
  function save(r, w) {
    try { localStorage.setItem(cacheKey(r), JSON.stringify(w)); } catch (e) {}
  }

  /* ── нормализация ответа Open-Meteo ── */
  function normalize(j) {
    const c = j.current || {};
    const h = j.hourly || {};
    const times = h.time || [];
    let i0 = times.findIndex(t => t >= (c.time || ''));
    if (i0 < 0) i0 = 0;
    const hours = [];
    for (let i = i0; i < Math.min(times.length, i0 + 1 + HORIZON); i++) {
      hours.push({
        code: h.weather_code ? h.weather_code[i] : null,
        temp: h.temperature_2m ? h.temperature_2m[i] : null,
        wind: h.wind_speed_10m ? h.wind_speed_10m[i] : null,
        gust: h.wind_gusts_10m ? h.wind_gusts_10m[i] : null,
        precip: h.precipitation ? h.precipitation[i] : 0,
        pop: h.precipitation_probability ? h.precipitation_probability[i] : null,
        vis: h.visibility ? h.visibility[i] : null
      });
    }
    return {
      cur: {
        code: c.weather_code,
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        wind: c.wind_speed_10m,
        gust: c.wind_gusts_10m,
        precip: c.precipitation,
        vis: c.visibility
      },
      hours: hours
    };
  }

  /* ── загрузка: кэш → сеть → кэш при ошибке ── */
  function load(r, force) {
    if (!r) return Promise.resolve(null);
    const c = cached(r);
    if (c && !force && Date.now() - c.at < TTL) return Promise.resolve(c);
    const g = coordsOf(r);
    if (!g) return Promise.resolve(c);
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + g.lat + '&longitude=' + g.lng +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,visibility' +
      '&hourly=weather_code,temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,precipitation_probability,visibility' +
      '&forecast_days=2&timezone=auto';
    return fetch(url, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(j => {
        if (!j || !j.current) return c;
        const w = normalize(j);
        w.at = Date.now();
        save(r, w);
        return w;
      })
      .catch(() => c);          // нет сети — работаем на кэше
  }

  /* ── худшие значения в окне анализа ── */
  function worst(w) {
    const list = (w.hours || []).concat([w.cur || {}]);
    const z = { code: null, sev: -1, temp: Infinity, gust: 0, wind: 0, precip: 0, pop: 0, vis: Infinity };
    for (const x of list) {
      if (x == null) continue;
      const s = sev(x.code);
      if (s > z.sev) { z.sev = s; z.code = x.code; }
      if (typeof x.temp === 'number' && x.temp < z.temp) z.temp = x.temp;
      if (typeof x.gust === 'number' && x.gust > z.gust) z.gust = x.gust;
      if (typeof x.wind === 'number' && x.wind > z.wind) z.wind = x.wind;
      if (typeof x.precip === 'number' && x.precip > z.precip) z.precip = x.precip;
      if (typeof x.pop === 'number' && x.pop > z.pop) z.pop = x.pop;
      if (typeof x.vis === 'number' && x.vis < z.vis) z.vis = x.vis;
    }
    if (z.temp === Infinity) z.temp = null;
    if (z.vis === Infinity) z.vis = null;
    return z;
  }

  const n = v => (typeof v === 'number' ? Math.round(v) : null);

  /* ── оценка: вердикт + вклад в риск ── */
  function assess(w) {
    if (!w || !w.cur || w.cur.code == null) return null;
    const z = worst(w);
    const cur = w.cur;
    const meta = WMO[cur.code] || { icon: '⛅', t: 'Облачно' };
    const reasons = [];
    const advice = [];
    let score = 0;

    const thunder = z.sev >= 5 && z.code !== 66 && z.code !== 67;
    const ice = z.code === 66 || z.code === 67;
    const snow = isSnow(z.code);
    const rain = isRain(z.code);
    const fog = FOG.indexOf(z.code) >= 0;

    if (thunder) {
      score += 30; reasons.push({ t: 'Гроза в районе маршрута — молния на открытом хребте', s: 30 });
      advice.push('Гроза: не выходите на гребни, развернитесь или уйдите в лес/укрытие.');
    }
    if (ice) {
      score += 30; reasons.push({ t: 'Ледяной дождь — наледь на тропе и камнях', s: 30 });
      advice.push('Ледяной дождь: наледь на камнях, лучше перенести поход.');
    }
    if (z.gust >= 90) {
      score += 25; reasons.push({ t: 'Порывы ветра до ' + Math.round(z.gust) + ' км/ч — риск сдувания на траверсе', s: 25 });
      advice.push('Шторм: на гребнях и открытых участках ветер срывает с ног.');
    } else if (z.gust >= 60) {
      score += 15; reasons.push({ t: 'Порывы ветра до ' + Math.round(z.gust) + ' км/ч', s: 15 });
      advice.push('Сильный ветер: держитесь за опоры, не останавливайтесь на ветреных участках.');
    }
    if (z.precip >= 8) {
      score += 20; reasons.push({ t: 'Ливень ' + Math.round(z.precip) + ' мм/ч — подъёмы размывает', s: 20 });
      advice.push('Ливень: русла сухих рек выходят из берегов, тропа становится скользкой.');
    } else if (z.precip >= 4) {
      score += 12; reasons.push({ t: 'Дождь ' + Math.round(z.precip) + ' мм/ч', s: 12 });
      advice.push('Дождь: промокнете, спуски по траве и грунту скользкие.');
    } else if (z.precip >= 0.2) {
      score += 6; reasons.push({ t: 'Осадки ' + z.precip.toFixed(1) + ' мм/ч', s: 6 });
    } else if (z.pop >= 70) {
      score += 6; reasons.push({ t: 'Вероятность осадков ' + z.pop + '%', s: 6 });
    }
    if (snow) {
      score += 12; reasons.push({ t: 'Снег на маршруте — след тонет, камни скользкие', s: 12 });
      advice.push('Снег: след тонет, растёт риск подсоса и переохлаждения.');
    }
    if (fog) {
      score += 10; reasons.push({ t: 'Туман — видимость тропы меньше 100 м', s: 10 });
      advice.push('Туман: без навигатора легко сойти с тропы, идите по треку.');
    }
    if (z.vis != null && z.vis < 1000 && !fog) {
      score += 10; reasons.push({ t: 'Низкая видимость: ' + Math.round(z.vis) + ' м', s: 10 });
      advice.push('Плохая видимость: ориентируйтесь по треку, не отходите от тропы.');
    }
    if (z.temp <= -25) {
      score += 25; reasons.push({ t: 'Мороз ' + Math.round(z.temp) + ' °C — обморожение за минуты', s: 25 });
      advice.push('Крепкий мороз: закрывайте лицо, меняйте влажную одежду, идите короткими привалами.');
    } else if (z.temp <= -15) {
      score += 15; reasons.push({ t: 'Мороз ' + Math.round(z.temp) + ' °C', s: 15 });
      advice.push('Мороз: берите дополнительный слой одежды, следите за руками и лицом.');
    } else if (z.temp <= -5) {
      score += 6; reasons.push({ t: 'Минусовая температура ' + Math.round(z.temp) + ' °C', s: 6 });
    } else if (z.temp >= 32) {
      score += 12; reasons.push({ t: 'Жара ' + Math.round(z.temp) + ' °C — тепловой удар на подъёме', s: 12 });
      advice.push('Жара: больше воды, стартуйте рано, берите головной убор.');
    }

    /* вердикт: можно ли идти в горы */
    let verdict = 'ok';
    if (thunder || ice || z.gust >= 90 || z.precip >= 8 || z.temp <= -25 || (z.vis != null && z.vis < 300)) verdict = 'bad';
    else if (z.sev >= 3 || z.gust >= 60 || z.precip >= 1 || z.temp <= -15 || z.temp >= 32 ||
             (z.vis != null && z.vis < 1000) || z.pop >= 70) verdict = 'warn';

    const verdictT = verdict === 'bad' ? 'Сегодня в горы не стоит'
      : verdict === 'warn' ? 'Идти можно, но с осторожностью'
      : 'Можно идти';

    if (verdict === 'ok' && !advice.length) advice.push('Погода не мешает походу: осадков и шторма не ожидается.');
    if (verdict === 'bad' && !advice.length) advice.push('Условия опасны: лучше перенести выход.');

    return {
      verdict: verdict, verdictT: verdictT,
      icon: meta.icon, text: meta.t,
      temp: n(cur.temp), feels: n(cur.feels), wind: n(cur.wind), gust: n(cur.gust),
      precip: cur.precip, code: cur.code,
      score: Math.min(40, score),
      reasons: reasons.sort((a, b) => b.s - a.s),
      advice: advice
    };
  }

  return { load: load, cached: cached, assess: assess, coordsOf: coordsOf, WMO: WMO };
})();
