"""Переписывает const ROUTES в www/js/data.js из реальных координат OSM.

Источник координат пунктов назначения — OpenStreetMap (Overpass, см.
scripts/diag_named.py): озёра Көлсай №1/№2, Қайыңды, Үлкен Алматы көлі,
Долина Замков, Тургенская хижина, Көк Жайлау и др.

Соседние тропы (пунктир на карте) берутся реальные — из scripts/osm_real.json.
Геометрия основного трека — контрольные точки OSM, сглаженные trailPath().
"""
import json
import os
import sys

PATH = "www/js/data.js"
REAL = "scripts/osm_real.json"

# ── новые маршруты ────────────────────────────────────────────
ROUTES = [
    dict(
        id="bao", name="Большое Алматинское озеро",
        region="Алматы, Большое Алматинское ущелье",
        difficulty=2, days=1, km=13, alt=2511,
        season="май – октябрь", no_signal=True,
        note="Вдоль Большого Алматинского ущелья до озера на 2511 м. "
             "Связь рвётся в ущелье, тропа идёт вдоль реки.",
        track=[[43.1676, 77.0465], [43.155, 77.038], [43.140, 77.028],
               [43.120, 77.015], [43.100, 77.005], [43.078, 76.995],
               [43.0510, 76.9853]],
        poi=[("parking", 43.1676, 77.0465, "Смотровая «Слониха», старт"),
             ("toilet", 43.1676, 77.0465, "Туалет на старте"),
             ("water", 43.120, 77.015, "Ручей вдоль ущелья"),
             ("view", 43.078, 76.995, "Вид на озеро"),
             ("trash", 43.0510, 76.9853, "Контейнер у озера")],
    ),
    dict(
        id="turgень", name="Тургенское ущелье",
        region="Алматы, Тургенское ущелье",
        difficulty=2, days=2, km=21, alt=2683,
        season="июнь – сентябрь", no_signal=True,
        note="От Тау-Тургень вверх по ущелью до Тургенской хижины (2683 м). "
             "Ночёвка на маршруте, связи нет.",
        track=[[43.3539, 77.6113], [43.3368, 77.6148], [43.3214, 77.6864],
               [43.280, 77.700], [43.235, 77.695], [43.195, 77.680],
               [43.1729, 77.6708]],
        poi=[("parking", 43.3539, 77.6113, "Тау-Тургень, старт"),
             ("toilet", 43.3539, 77.6113, "Туалет на стоянке"),
             ("water", 43.3214, 77.6864, "Река Тургень"),
             ("shelter", 43.1729, 77.6708, "Тургенская хижина"),
             ("trash", 43.3368, 77.6148, "Экопост Түрген")],
    ),
    dict(
        id="charyn", name="Чарын — долина замков",
        region="Чиликское ущелье, Чарынский каньон",
        difficulty=2, days=1, km=6, alt=1700,
        season="апрель – ноябрь", no_signal=True,
        note="Вниз к реке и вдоль каньона до Долины Замков. "
             "Солнце без тени — минимум 2 л воды на человека.",
        track=[[43.3505, 79.0812], [43.3525, 79.0798], [43.3545, 79.0780],
               [43.3530, 79.0758], [43.3552, 79.0735], [43.3532, 79.0712],
               [43.3558, 79.0688], [43.3538, 79.0665], [43.3554, 79.0642]],
        poi=[("parking", 43.3505, 79.0812, "Eco-Park Charyn, старт"),
             ("toilet", 43.3505, 79.0812, "Туалет на парковке"),
             ("water", 43.3517, 79.0806, "Река Шарын"),
             ("view", 43.3541, 79.0712, "Вид сверху на каньон"),
             ("trash", 43.3505, 79.0812, "Контейнер на парковке")],
    ),
    dict(
        id="kolsai", name="Кольсае — Верхнее озеро",
        region="Кунгей Алатау, Кольсаинский нацпарк",
        difficulty=3, days=2, km=12, alt=2700,
        season="июнь – октябрь", no_signal=True,
        note="От Құрменті до Көлсай №1, дальше до Верхнего (№2). "
             "Нет связи на всём треке, ночёвка у Нижнего озера.",
        track=[[43.0223, 78.2925], [43.0100, 78.3050], [43.0000, 78.3150],
               [42.9839, 78.3237], [42.9700, 78.3255], [42.9550, 78.3265],
               [42.9356, 78.3271]],
        poi=[("parking", 43.0223, 78.2925, "Құрменті, старт"),
             ("toilet", 43.0223, 78.2925, "Туалет на старт"),
             ("shelter", 42.9839, 78.3237, "Стоянка у Көлсай №1"),
             ("water", 42.9700, 78.3255, "Река Көлсай"),
             ("view", 42.9356, 78.3271, "Көлсай №2 — Верхнее")],
    ),
    dict(
        id="kolsai-kaindy", name="Кольсае — Кайынды",
        region="Кунгей Алатау, многодневка",
        difficulty=4, days=2, km=16, alt=2700,
        season="июль – сентябрь", no_signal=True,
        note="От Көлсай №1 через перевал к озеру Қайыңды. "
             "Нет связи, ночёвки без инфраструктуры. Только с опытом.",
        track=[[42.9839, 78.3237], [42.9870, 78.3500], [42.9905, 78.3800],
               [42.9885, 78.4100], [42.9865, 78.4400], [42.9845, 78.4656]],
        poi=[("parking", 42.9839, 78.3237, "Көлсай №1, старт"),
             ("water", 42.9905, 78.3800, "Ручей на перевале"),
             ("view", 42.9845, 78.4656, "Озеро Қайыңды"),
             ("trash", 42.9839, 78.3237, "Контейнер на стоянке")],
    ),
    dict(
        id="kok-zhaylyau", name="Кок-Жайляу",
        region="Алматы, хребет Кок-Жайляу",
        difficulty=5, days=2, km=15, alt=3400,
        season="июль – август", no_signal=True,
        note="От Ак-Булак по одноимённому маршруту к хребту Кок-Жайляу. "
             "Высокогорье, резкая смена погоды. Только для профи.",
        track=[[43.180, 77.030], [43.165, 77.022], [43.155, 77.014],
               [43.148, 77.008], [43.1424, 77.0040]],
        poi=[("parking", 43.180, 77.030, "Ак-Булак, старт"),
             ("toilet", 43.180, 77.030, "Туалет на старте"),
             ("water", 43.155, 77.014, "Ручей на подъёме"),
             ("view", 43.1424, 77.0040, "Хребет Кок-Жайляу")],
    ),
]

POI_LABELS = {"parking": "parking", "toilet": "toilet", "water": "water",
              "shelter": "shelter", "trash": "trash", "view": "view"}


def load_real():
    if not os.path.exists(REAL):
        return None
    with open(REAL, encoding="utf-8") as f:
        return json.load(f)


def decimate(poly, n=14):
    if len(poly) <= n:
        return poly
    step = (len(poly) - 1) / (n - 1)
    out = [poly[round(i * step)] for i in range(n)]
    if out[-1] != poly[-1]:
        out[-1] = poly[-1]
    return out


def hav(a, b):
    """Расстояние в метрам (грубо, по градусам)."""
    import math
    dy = (a[0] - b[0]) * 111320.0
    dx = (a[1] - b[1]) * 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def poly_len(poly):
    return sum(hav(poly[i], poly[i + 1]) for i in range(len(poly) - 1))


def fmt_num(x):
    s = ("%.6f" % x).rstrip("0").rstrip(".")
    return s if s else "0"


def js_route(r, trails):
    L = []
    L.append("  {")
    L.append("    id: '%s'," % r["id"])
    L.append("    name: '%s'," % r["name"])
    L.append("    region: '%s'," % r["region"])
    L.append("    difficulty: %d, days: %d, km: %d, alt: %d,"
             % (r["difficulty"], r["days"], r["km"], r["alt"]))
    L.append("    season: '%s'," % r["season"])
    L.append("    noSignal: %s," % ("true" if r["no_signal"] else "false"))
    L.append("    note: '%s'," % r["note"])
    L.append("    poi: [")
    for i, (typ, lat, lng, label) in enumerate(r["poi"]):
        comma = "," if i < len(r["poi"]) - 1 else ""
        L.append("      { type: '%s', lat: %s, lng: %s, label: '%s' }%s"
                 % (typ, fmt_num(lat), fmt_num(lng), label, comma))
    L.append("    ],")
    L.append("    track: [")
    for i in range(0, len(r["track"]), 3):
        chunk = r["track"][i:i + 3]
        line = ", ".join("[%s, %s]" % (fmt_num(a), fmt_num(b)) for a, b in chunk)
        comma = "," if i + 3 < len(r["track"]) else ""
        L.append("      %s%s" % (line, comma))
    L.append("    ]")
    if trails:
        L[-1] += ","
        L.append("    trails: [")
        for ti, t in enumerate(trails):
            rows = []
            for i in range(0, len(t), 3):
                chunk = t[i:i + 3]
                rows.append(", ".join("[%s, %s]" % (fmt_num(a), fmt_num(b))
                                      for a, b in chunk))
            comma = "," if ti < len(trails) - 1 else ""
            L.append("      [")
            for ri, row in enumerate(rows):
                rc = "," if ri < len(rows) - 1 else ""
                L.append("        %s%s" % (row, rc))
            L.append("      ]%s" % comma)
        L.append("    ]")
    L.append("  }")
    return "\n".join(L)


def main():
    real = load_real()
    relation_poly, ways_by_route = (None, {})
    if real:
        if real.get("relation"):
            relation_poly = real["relation"]["poly"]
        ways_by_route = real.get("ways", {})

    blocks = []
    for r in ROUTES:
        routes_trails = []
        if r["id"] == "kok-zhaylyau" and relation_poly:
            # реальный маршрут OSM «Ак-Булак – Кок Жайлау» — им и заменяем трек
            poly = decimate(relation_poly, 16)
            # разворачиваем так, чтобы финиш был у Кок-Жайляу (43.1424, 77.0040)
            target = (43.1424, 77.0040)
            if hav(poly[0], target) < hav(poly[-1], target):
                poly = poly[::-1]
            r = dict(r, track=poly)
        cand = []
        for w in ways_by_route.get(r["id"], []):
            poly = w.get("poly") or []
            if len(poly) < 4:
                continue
            L = poly_len(poly)
            if L >= 200:                      # только осмысленные тропы
                cand.append((L, poly))
        cand.sort(key=lambda x: -x[0])
        for _L, poly in cand[:2]:
            routes_trails.append(decimate(poly, 10))
        blocks.append(js_route(r, routes_trails))

    new_block = "const ROUTES = [\n" + ",\n".join(blocks) + "\n];"

    with open(PATH, encoding="utf-8") as f:
        src = f.read()
    start = src.index("const ROUTES = [")
    end = src.index("];", start) + 2
    src = src[:start] + new_block + src[end:]
    with open(PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(src)

    n_tr = sum(1 for b in blocks if "trails:" in b)
    print("маршрутов:", len(ROUTES), "| со статичными тропами:", n_tr,
          "| релейшен Кок-Жайляу:", "да" if (relation_poly and True) else "нет")
    print("записано", PATH)


if __name__ == "__main__":
    main()
