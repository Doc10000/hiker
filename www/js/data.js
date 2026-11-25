/* ═══════════════════════════════════════════════════════════
   data.js — маршруты Казахстана + генерация чек-листов
   Все данные локальны: приложение работает полностью офлайн.
   ═══════════════════════════════════════════════════════════ */

/* Точки инфраструктуры маршрутов (демо-данные; подтверждаются с парками/гидами).
   Типы: parking 🅿 · toilet 🚻 · water 💧 · shelter 🛖 · trash 🗑 · view 🏞 */
const POI_META = {
  parking: { icon: '🅿', name: 'Парковка / старт' },
  toilet:  { icon: '🚻', name: 'Туалет' },
  water:   { icon: '💧', name: 'Вода / родник' },
  shelter: { icon: '🛖', name: 'Укрытие / ночёвка' },
  trash:   { icon: '🗑', name: 'Мусорный контейнер' },
  view:    { icon: '🏞', name: 'Смотровая точка' }
};

const ROUTES = [
  {
    id: 'bao',
    name: 'Большое Алматинское озеро',
    region: 'Алматы, Иле-Алатауский хребет',
    difficulty: 1, days: 1, km: 8, alt: 2530,
    season: 'май – октябрь',
    noSignal: false,
    note: 'Короткий подъём к озеру. Лучше идти утром — днём бывает ветер.',
    poi: [
      { type: 'parking', lat: 43.216, lng: 77.075, label: 'Парковка (старт)' },
      { type: 'toilet',  lat: 43.216, lng: 77.075, label: 'Туалет на старте' },
      { type: 'water',   lat: 43.193, lng: 77.056, label: 'Ручей — вода' },
      { type: 'view',    lat: 43.170, lng: 77.044, label: 'Вид на озеро' },
      { type: 'trash',   lat: 43.159, lng: 77.041, label: 'Контейнер у озера' }
    ],
    track: [
      [43.216, 77.075], [43.204, 77.066], [43.193, 77.056],
      [43.181, 77.049], [43.170, 77.044], [43.159, 77.041]
    ]
  },
  {
    id: 'turgень',
    name: 'Тургень — Кайынды',
    region: 'Тургенское ущелье',
    difficulty: 2, days: 2, km: 18, alt: 2600,
    season: 'июнь – сентябрь',
    noSignal: false,
    note: 'Есть ночёвка у озера. Начинайте до 9 утра — после дождя броды поднимаются.',
    poi: [
      { type: 'parking', lat: 43.265, lng: 77.268, label: 'Парковка (старт)' },
      { type: 'toilet',  lat: 43.265, lng: 77.268, label: 'Туалет на старте' },
      { type: 'water',   lat: 43.236, lng: 77.313, label: 'Брод — вода' },
      { type: 'shelter', lat: 43.203, lng: 77.353, label: 'Ночёвка у Кайынды' },
      { type: 'trash',   lat: 43.187, lng: 77.371, label: 'Контейнер у озера' }
    ],
    track: [
      [43.265, 77.268], [43.251, 77.290], [43.236, 77.313],
      [43.220, 77.334], [43.203, 77.353], [43.187, 77.371]
    ]
  },
  {
    id: 'charyn',
    name: 'Чарын — долина замков',
    region: 'Чиликское ущелье',
    difficulty: 2, days: 1, km: 12, alt: 1700,
    season: 'апрель – ноябрь',
    noSignal: false,
    note: 'Солнце без тени: минимум 2 л воды на человека. В жару — только утром.',
    poi: [
      { type: 'parking', lat: 43.358, lng: 79.072, label: 'Парковка (старт)' },
      { type: 'toilet',  lat: 43.358, lng: 79.072, label: 'Туалет на старте' },
      { type: 'water',   lat: 43.345, lng: 79.050, label: 'Пункт воды' },
      { type: 'view',    lat: 43.328, lng: 79.038, label: 'Смотровая «Кастель»' },
      { type: 'trash',   lat: 43.319, lng: 79.034, label: 'Контейнер у выезда' }
    ],
    track: [
      [43.358, 79.072], [43.352, 79.060], [43.345, 79.050],
      [43.337, 79.043], [43.328, 79.038], [43.319, 79.034]
    ]
  },
  {
    id: 'kolsai',
    name: 'Кольсае — Верхнее озеро',
    region: 'Кунгей Алатау, Кегенский р-н',
    difficulty: 3, days: 2, km: 22, alt: 2700,
    season: 'июнь – октябрь',
    noSignal: true,
    note: '⚠ Нет мобильной связи на всём треке. Обязательно оставьте план похода близким.',
    poi: [
      { type: 'parking', lat: 43.218, lng: 78.290, label: 'Парковка (старт)' },
      { type: 'toilet',  lat: 43.218, lng: 78.290, label: 'Туалет на старте' },
      { type: 'water',   lat: 43.176, lng: 78.254, label: 'Родник — вода' },
      { type: 'view',    lat: 43.161, lng: 78.243, label: 'Вид на озеро' },
      { type: 'shelter', lat: 43.147, lng: 78.232, label: 'Ночёвка у Верхнего' },
      { type: 'trash',   lat: 43.147, lng: 78.232, label: 'Контейнер у стоянки' }
    ],
    track: [
      [43.218, 78.290], [43.205, 78.278], [43.191, 78.266],
      [43.176, 78.254], [43.161, 78.243], [43.147, 78.232],
      [43.134, 78.221]
    ]
  },
  {
    id: 'kolsai-kaindy',
    name: 'Кольсае — Кайынды (трек)',
    region: 'Кунгей Алатау, многодневка',
    difficulty: 4, days: 3, km: 38, alt: 3000,
    season: 'июль – сентябрь',
    noSignal: true,
    note: '⚠ Перевал 3000 м. Нет связи, ночёвки без инфраструктуры. Только с опытом 4+.',
    poi: [
      { type: 'parking', lat: 43.147, lng: 78.232, label: 'Парковка (старт)' },
      { type: 'shelter', lat: 43.108, lng: 78.277, label: 'Ночёвка на треке' },
      { type: 'water',   lat: 43.086, lng: 78.294, label: 'Ручей — вода' },
      { type: 'view',    lat: 43.040, lng: 78.312, label: 'Перевал 3000 м' }
    ],
    track: [
      [43.147, 78.232], [43.128, 78.256], [43.108, 78.277],
      [43.086, 78.294], [43.063, 78.306], [43.040, 78.312],
      [43.018, 78.311], [42.998, 78.303]
    ]
  },
  {
    id: 'kok-zhaylyau',
    name: 'Кок-Жайляу',
    region: 'Тургенское ущелье, вершина',
    difficulty: 5, days: 2, km: 26, alt: 3400,
    season: 'июль – август',
    noSignal: true,
    note: '⚠ Высокогорье, резкая смена погоды. Только для профи. Старт до 6 утра.',
    poi: [
      { type: 'parking', lat: 43.251, lng: 77.290, label: 'Парковка (старт)' },
      { type: 'toilet',  lat: 43.251, lng: 77.290, label: 'Туалет на старте' },
      { type: 'water',   lat: 43.237, lng: 77.330, label: 'Ручей — вода' },
      { type: 'view',    lat: 43.219, lng: 77.381, label: 'Вершина Кок-Жайляу' }
    ],
    track: [
      [43.251, 77.290], [43.244, 77.310], [43.237, 77.330],
      [43.230, 77.349], [43.224, 77.366], [43.219, 77.381]
    ]
  }
];

/* ─────────────────────────────────────────────
   Чек-лист: подбирается под профиль (онбординг).
   Правила генерации — локальные, офлайн.
   pri: must | should | have
   ───────────────────────────────────────────── */
function buildChecklist(profile, route) {
  const lvl = profile.level || 1;            // 1 новичок, 2 опытный, 3 профи
  const days = route.days;
  const gear = new Set(profile.gear || []);
  const has = g => gear.has(g);
  const none = gear.has('none');

  const cats = [];

  // ── Навигация и связь ──
  const nav = [];
  nav.push({ t: 'Заряженный телефон + пауэрбанк', pri: has('bank') && !none ? 'have' : 'must' });
  nav.push({ t: 'Скачать карту маршрута офлайн (этот экран)', pri: 'must' });
  nav.push({ t: 'Сообщить близким план и срок возврата', pri: 'must' });
  if (route.noSignal) {
    nav.push({ t: 'Сигнал-свисток / фонарь-мигалка', pri: lvl === 1 ? 'must' : 'should' });
    nav.push({ t: 'Power-bank минимум 10 000 мАч — связи нет, телефон главный', pri: 'must' });
  }
  nav.push({ t: 'Навигатор или часы с треком', pri: has('nav') && !none ? 'have' : lvl >= 2 ? 'should' : 'must' });
  cats.push({ name: 'Навигация и связь', items: nav });

  // ── Одежда ──
  const cloth = [];
  cloth.push({ t: 'Мембранная куртка от ветра и дождя', pri: 'must' });
  cloth.push({ t: 'Термобельё / флис', pri: route.alt > 2600 ? 'must' : 'should' });
  cloth.push({ t: 'Сменная футболка и носки', pri: 'should' });
  cloth.push({ t: 'Перчатки', pri: route.alt > 3000 ? 'must' : 'should' });
  if (lvl === 1) cloth.push({ t: 'Кепка / панама от солнца', pri: 'must' });
  cloth.push({ t: 'Голенищи / бандажи на колени (набор высоты)', pri: route.difficulty >= 4 ? 'must' : 'should' });
  cats.push({ name: 'Одежда', items: cloth });

  // ── Сон и стоянка (если ночёвка) ──
  if (days >= 2) {
    const sleep = [];
    sleep.push({ t: 'Палатка', pri: has('tent') && !none ? 'have' : 'must' });
    sleep.push({ t: 'Спальник (комфорт 0 °C и ниже)', pri: has('bag') && !none ? 'have' : 'must' });
    sleep.push({ t: 'Ковриок и каремат', pri: 'should' });
    sleep.push({ t: 'Горелка + газ + посуда', pri: 'should' });
    sleep.push({ t: 'Туалетная бумага и совок, мешок для мусора', pri: 'must' });
    cats.push({ name: 'Стоянка на ночь', items: sleep });
  }

  // ── Аптечка ──
  const aid = [];
  aid.push({ t: 'Эластичный бинт и пластырь', pri: 'must' });
  aid.push({ t: 'Обезболивающее и средство от расстройства', pri: 'must' });
  aid.push({ t: 'Средство от аллергии', pri: 'should' });
  if (lvl === 1) {
    aid.push({ t: 'Аптечка новичка: парацетамол, ибупрофен, антисептик, бинт, лейкопластырь', pri: 'must' });
    aid.push({ t: 'Таблетки для очистки воды', pri: 'should' });
  }
  if (route.difficulty >= 4) aid.push({ t: 'Эластичный бинт + жгут, аспирин (сердце)', pri: 'must' });
  cats.push({ name: 'Аптечка', items: aid });

  // ── Еда и вода ──
  const food = [];
  const waterNeed = route.difficulty >= 3 ? 2 : 1.5;
  food.push({ t: `Вода: ${waterNeed} л на человека + запас ${days >= 2 ? '50%' : '20%'}`, pri: 'must' });
  food.push({ t: 'Еда на ' + (days >= 2 ? `${days} дня + запас на 1 день` : 'день + перекус'), pri: 'must' });
  food.push({ t: 'Энергетические батончики в карман', pri: 'should' });
  food.push({ t: 'Термос с чаем (выше 2500 м)', pri: route.alt > 2500 ? 'must' : 'should' });
  cats.push({ name: 'Еда и вода', items: food });

  // ── Для новичков — сводка ──
  if (lvl === 1) {
    cats.push({
      name: 'Советы новичку', items: [
        { t: 'Идите группой, не отставайте и не обгоняйте', pri: 'must' },
        { t: 'Разворот при усталости или темноте — это нормально', pri: 'must' },
        { t: 'Проверьте прогноз погоды утром в день похода', pri: 'must' },
        { t: 'Оставьте маршрут родственнику (экран «Близкие»)', pri: 'must' }
      ]
    });
  }

  return cats;
}

/* Итоговая статистика профиля для онбординга */
function levelLabel(l) {
  return l >= 3 ? 'Профи' : l === 2 ? 'Опытный' : 'Новичок';
}
