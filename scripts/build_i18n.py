# -*- coding: utf-8 -*-
"""build_i18n.py — тотальная локализация: собирает все русские строки из www/,
переводит их на en / kk / zh / hi и пишет www/js/i18n_data.js.

Перевод — Google Translate (без ключа, пакетами по 20 строк).
Кэш: scripts/i18n_cache.json — повторные запуски не ходят в сеть.

Запуск:  python scripts/build_i18n.py
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = "www"
CACHE = "scripts/i18n_cache.json"
OUT = os.path.join(ROOT, "js", "i18n_data.js")
LANGS = ["en", "kk", "zh", "hi"]          # zh → zh-CN в запросе
BATCH = 20
CYR = re.compile(r"[А-Яа-яЁё]")

# ручные поправки к машинному переводу (Google путает контекст)
CORRECTIONS = {
    "en": {"Близкие": "Contacts", "Мои близкие": "My contacts",
           "нет связи": "no signal", "рекомендовано": "recommended"},
    "kk": {"Близкие": "Жақындар", "Мои близкие": "Менің жақындарым",
           "нет связи": "байланысыз", "рекомендовано": "ұсынылды"},
    "zh": {"Близкие": "联系人", "Мои близкие": "我的联系人",
           "нет связи": "无信号", "рекомендовано": "推荐"},
    "hi": {"Близкие": "संपर्क", "Мои близкие": "मेरे संपर्क",
           "нет связи": "कोई सिग्नल नहीं", "рекомендовано": "सुझाया गया"},
}

# мусор из выгрузки: куски кода/HTML, которые не являются текстом интерфейса
# ';' НЕ в фильтре — в русских предложениях он нормален
BAD = re.compile(r"[<>=]|^//|^\s*$|^\.$")


def strip_tags(s):
    """Убирает HTML-теги из куска шаблона, оставляя текст."""
    s = re.sub(r"<[^>]*>", "\n", s)
    return s


def is_good(s):
    s = s.strip()
    if not s or not CYR.search(s):
        return False
    if len(CYR.findall(s)) < 2:
        return False
    if BAD.search(s):
        return False
    if s.startswith("[") or s.startswith("]"):
        return False
    return True


def collect():
    static, dyn = {}, {}

    def add(store, s):
        s = s.strip()
        if is_good(s):
            store.setdefault(s, None)

    # HTML: текстовые узлы, плейсхолдеры, title
    for path in (os.path.join(ROOT, "index.html"), os.path.join(ROOT, "share.html")):
        if not os.path.exists(path):
            continue
        with io.open(path, encoding="utf-8") as f:
            html = f.read()
        html = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
        html = re.sub(r"<style.*?</style>", " ", html, flags=re.S)
        for m in re.finditer(r">([^<>]+)<", html):
            add(static, m.group(1))
        for m in re.finditer(r'placeholder="([^"]+)"', html):
            add(static, m.group(1))
        for m in re.finditer(r'title="([^"]+)"', html):
            add(static, m.group(1))

    # JS: литералы и шаблонные строки
    for name in ("js/app.js", "js/data.js", "js/map.js", "share.html"):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        with io.open(p, encoding="utf-8") as f:
            src = f.read()
        for m in re.finditer(r"(['\"])((?:[^\\'\"\n]|\\.)*)\1", src):
            lit = m.group(2)
            if "${" in lit:
                if CYR.search(lit):
                    dyn[lit] = None          # сырьё, разрежем ниже
            elif "<" in lit:
                if CYR.search(lit):
                    dyn[lit] = None          # HTML-строка в коде: снимем теги
            else:
                add(static, lit)
        for m in re.finditer(r"`([^`]*)`", src):
            s = m.group(1)
            if CYR.search(s):
                dyn[s] = None                # шаблон — разрежем ниже

    # шаблонные строки: режем на ${...}, снимаем теги, переводим куски
    chunks = set()

    def feed(text):
        for part in re.split(r"\$\{[^}]*\}", text):
            part = strip_tags(part)
            part = part.replace("<", " ").replace(">", " ")
            for line in re.split(r"\\n|\n", part):
                line = line.strip(" \t\"'`,;")
                if is_good(line):
                    chunks.add(line)

    for s in list(dyn):
        feed(s)
    for s in list(static):
        feed(s)

    for c in chunks:
        static.setdefault(c, None)

    return sorted(static), sorted(dyn)


def translate_batch(strings, tl):
    """Переводит пакет строк одним запросом. Возвращает список или None."""
    if not strings:
        return []
    q = "\n".join(strings)
    url = ("https://translate.googleapis.com/translate_a/single"
           "?client=gtx&sl=ru&tl=" + tl + "&dt=t&q=" +
           urllib.parse.quote(q, safe=""))
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            out = "".join(seg[0] for seg in data[0] if seg and seg[0])
            lines = out.split("\n")
            if len(lines) == len(strings):
                return lines
            # переносы не совпали — не рискуем
            return None
        except Exception as e:  # noqa: BLE001
            print("   retry", attempt + 1, type(e).__name__, str(e)[:80], flush=True)
            time.sleep(2 + attempt * 3)
    return None


def load_cache():
    if os.path.exists(CACHE):
        with io.open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(c):
    with io.open(CACHE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(c, f, ensure_ascii=False, indent=1)


def main():
    static, dyn = collect()
    print("строк к переводу:", len(static), "| динамических:", len(dyn), flush=True)
    cache = load_cache()

    for tl in LANGS:
        missing = [s for s in static if cache.get(tl, {}).get(s) is None]
        print("[%s] в кэше: %d, надо: %d" % (tl, len(static) - len(missing), len(missing)),
              flush=True)
        done = 0
        for i in range(0, len(missing), BATCH):
            batch = missing[i:i + BATCH]
            res = translate_batch(batch, tl)
            if res is None:
                # поштучно
                for s in batch:
                    r1 = translate_batch([s], tl)
                    cache.setdefault(tl, {})[s] = r1[0] if r1 else s
                    done += 1
                    time.sleep(0.4)
            else:
                for s, t in zip(batch, res):
                    cache.setdefault(tl, {})[s] = t
                done += len(batch)
            if done % 100 < BATCH:
                save_cache(cache)
                print("   %s: %d/%d" % (tl, done, len(missing)), flush=True)
            time.sleep(0.5)
        save_cache(cache)

    # ── пишем JS ──
    def js_str(s):
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"

    lines = ["/* ГЕНЕРИРОВАНО scripts/build_i18n.py — не править руками.",
             "   Полные словари перевода для en / kk / zh / hi. */"]
    for tl in LANGS:
        d = dict(cache.get(tl, {}))
        d.update(CORRECTIONS.get(tl, {}))
        items = [(k, v) for k, v in d.items() if v and k != v]
        lines.append("Object.assign(I18N.%s, {" % tl)
        for k, v in items:
            lines.append("  %s: %s," % (js_str(k), js_str(v)))
        lines.append("});")
        lines.append("")
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    total = sum(len([1 for k, v in cache.get(t, {}).items() if v and k != v]) for t in LANGS)
    print("->", OUT, "| переводов:", total, flush=True)


# дополнительные поправки: категории риска, уровни, единицы, ключевые слова
CORRECTIONS_M = {
    "en": {
        "Низкий": "Low", "Средний": "Medium", "Высокий": "High",
        "Очень высокий": "Very high", "очень высокий": "very high",
        "Новичок": "Beginner", "Опытный": "Experienced", "Профи": "Pro",
        "Риск:": "Risk:", "риск": "risk", "маршрут": "route",
        " км": " km", " м": " m", " д": " d",
        "критично": "critical", "рекомендуется": "recommended", "есть": "have",
        "высота, м": "height, m", "сложность": "difficulty",
        "дней": "days", "дн": "d", "в пути": "on the way",
        "точность GPS": "GPS accuracy", "точек трека": "track points",
        "в очереди": "queued", "закрыт": "closed", "отправлено": "sent",
    },
    "kk": {
        "Низкий": "Төмен", "Средний": "Орташа", "Высокий": "Жоғары",
        "Очень высокий": "Өте жоғары", "очень высокий": "өте жоғары",
        "Новичок": "Жаңадан бастаушы", "Опытный": "Тәжірибелі", "Профи": "Профи",
        "Риск:": "Қауіп:", "риск": "қауіп",
        " км": " км", " м": " м", " д": " күн",
        "критично": "міндетті", "рекомендуется": "ұсынылады", "есть": "бар",
        "высота, м": "биіктік, м", "сложность": "қиындығы",
        "дней": "күн", "дн": "күн", "в пути": "жолда",
        "точность GPS": "GPS дәлдігі", "точек трека": "трек нүктелері",
        "в очереди": "кезекте", "закрыт": "жабылды", "отправлено": "жіберілді",
    },
    "zh": {
        "Низкий": "低", "Средний": "中", "Высокий": "高",
        "Очень высокий": "极高", "очень высокий": "极高",
        "Новичок": "新手", "Опытный": "有经验", "Профи": "专业",
        "Риск:": "风险:", "риск": "风险", "маршрут": "路线",
        " км": " 公里", " м": " 米", " д": " 天",
        "критично": "必备", "рекомендуется": "推荐", "есть": "已有",
        "высота, м": "海拔, 米", "сложность": "难度",
        "дней": "天", "дн": "天", "в пути": "在途中",
        "точность GPS": "GPS 精度", "точек трека": "轨迹点",
        "в очереди": "排队中", "закрыт": "已关闭", "отправлено": "已发送",
    },
    "hi": {
        "Низкий": "कम", "Средний": "मध्यम", "Высокий": "उच्च",
        "Очень высокий": "बहुत उच्च", "очень высокий": "बहुत उच्च",
        "Новичок": "नौसिखिया", "Опытный": "अनुभवी", "Профи": "प्रो",
        "Риск:": "जोखिम:", "риск": "जोखिम", "маршрут": "रास्ता",
        " कम": " कि॰म॰", " कि॰म॰": " कि॰म॰", " मी": " मी",
        " д": " दिन",
        "критично": "ज़रूरी", "рекомендуется": "सुझाव", "есть": "है",
        "высотा, म": "ऊँचाई, मी", "сложность": "कठिनाई",
        "дней": "दिन", "дн": "दिन", "в пути": "रास्ते में",
        "точность GPS": "GPS सटीकता", "точек трекा": "ट्रैक बिंदु",
        "в очереди": "कतार में", "закрыт": "बंद", "отправлено": "भेजा गया",
    },
}
for _lang, _fix in CORRECTIONS_M.items():
    CORRECTIONS.setdefault(_lang, {}).update(_fix)

if __name__ == "__main__":
    main()
