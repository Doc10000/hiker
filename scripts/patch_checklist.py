# -*- coding: utf-8 -*-
"""Заменяет buildChecklist в www/js/data.js на короткую версию (2 категории)."""
import io

PATH = "www/js/data.js"

NEW = r'''function buildChecklist(profile, route) {
  const lvl = profile.level || 1;            // 1 новичок, 2 опытный, 3 профи
  const days = route.days;
  const gear = new Set(profile.gear || []);
  const has = g => gear.has(g);
  const none = gear.has('none');
  const multi = days >= 2;
  const hard = route.difficulty >= 4;
  const high = route.alt > 2600;
  const noSig = route.noSignal;
  const water = route.difficulty >= 3 ? 2 : 1.5;

  // ── КРИТИЧНО: без этого поход реально опасен ──
  const crit = [
    { t: 'Телефон заряжен + пауэрбанк' + (noSig ? ' — связи нет, телефон главный' : ''),
      pri: has('bank') && !none ? 'have' : 'must' },
    { t: 'Сообщить близким план и срок возврата', pri: 'must' },
    { t: `Вода ${water} л на человека + запас ${multi ? '50%' : '20%'}`, pri: 'must' },
    { t: `Еда на ${multi ? days + ' дня + запас на день' : 'день + перекус'}`, pri: 'must' },
    { t: 'Куртка от ветра и дождя', pri: 'must' },
    { t: 'Аптечка: бинт, пластырь, обезболивающее, антисептик', pri: 'must' }
  ];
  if (multi) {
    crit.push({ t: 'Палатка', pri: has('tent') && !none ? 'have' : 'must' });
    crit.push({ t: 'Спальник (комфорт 0 °C и ниже)', pri: has('bag') && !none ? 'have' : 'must' });
  }
  if (hard) crit.push({ t: 'Жгут и эластичный бинт', pri: 'must' });

  // ── РЕКОМЕНДУЕТСЯ: хорошо бы, но старт не блокируем ──
  const rec = [
    { t: 'Карта маршрута скачана офлайн (это приложение)', pri: 'have' },
    { t: 'Термобельё / флис' + (high ? ' — выше 2600 м холодно' : ''), pri: 'should' },
    { t: 'Голенищи, перчатки, кепка от солнца', pri: 'should' },
    { t: 'Навигатор или часы с треком', pri: has('nav') && !none ? 'have' : 'should' }
  ];
  if (noSig) rec.push({ t: 'Свисток и фонарь-мигалка', pri: 'should' });
  if (multi) rec.push({ t: 'Коврик, горелка, туалетная бумага и мешок для мусора', pri: 'should' });
  if (lvl === 1) rec.push({ t: 'Прогноз погоды утром в день похода', pri: 'should' });
  rec.push({ t: 'Батончики в карман, термос с чаем, средство от аллергии', pri: 'should' });

  return [
    { name: 'Критично — без этого не выходим', items: crit },
    { name: 'Рекомендуется — не блокирует старт', items: rec }
  ];
}'''

with io.open(PATH, encoding="utf-8") as f:
    src = f.read()

start = src.index("function buildChecklist(profile, route) {")
endmark = "return cats;"
end = src.index(endmark, start)
# ищем закрывающую фигурную скобку функции после return cats;
close = src.index("\n}", end) + 2

src = src[:start] + NEW + src[close:]
with io.open(PATH, "w", encoding="utf-8", newline="\n") as f:
    f.write(src)

print("buildChecklist заменён, длина", len(NEW))
