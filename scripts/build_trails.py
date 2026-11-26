# -*- coding: utf-8 -*-
"""build_trails.py — строит трек маршрута по РЕАЛЬНЫМ тропам OSM.

Берёт опорные точки маршрута (старт/финиш) и ways из scripts/osm_real.json
(highway=path|footway|track|bridleway|steps) и жадно собирает цепочку ways
от старта к финишу: выбираем ближайший неиспользованный way, который реально
приближает к цели, и цепляем его геометрию.

Результат — scripts/route_trails.json: {route_id: [[lat,lng], ...]}
Дальше gen_routes.py подставляет это в data.js как track (wobble не применяется).

Запуск: python scripts/build_trails.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_routes import ROUTES  # noqa: E402  (main() не выполняется при импорте)

OSM = "scripts/osm_real.json"
OUT = "scripts/route_trails.json"

MAX_GAP = 400        # м: на каком расстоянии считаем, что way «рядом»
FINISH_TOL = 350     # м: достигли финиша
MAX_STEPS = 30
# ключ osm_real.json может отличаться от id маршрута
ALIAS = {"kolsai-kaindy": "kaindy"}
# предпочтение типам троп: path/footway лучше, чем грунтовка
TYPE_BONUS = {"path": 0, "footway": 0, "bridleway": 10, "steps": 0, "track": 60}


def hav(a, b):
    dy = (a[0] - b[0]) * 111320.0
    dx = (a[1] - b[1]) * 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def dist_pt_poly(p, poly):
    best = float("inf")
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        dx, dy = b[1] - a[1], b[0] - a[0]
        if dx == 0 and dy == 0:
            d = hav(p, a)
        else:
            t = ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / (dx * dx + dy * dy)
            t = max(0.0, min(1.0, t))
            d = hav(p, (a[0] + t * dy, a[1] + t * dx))
        if d < best:
            best = d
    return best


def poly_len(poly):
    return sum(hav(poly[i], poly[i + 1]) for i in range(len(poly) - 1))


def build_chain(anchors, ways):
    start, finish = anchors[0], anchors[-1]
    used, path, cur = set(), [], start
    visited_nodes = set()

    # проход1 — строго к цели; проход2 — послабление (можно идти в сторону)
    for pass_no, (gap_lim, need_progress) in enumerate(((MAX_GAP, True),
                                                        (MAX_GAP * 2.5, False))):
        if hav(cur, finish) <= FINISH_TOL:
            break
        for _ in range(MAX_STEPS):
            if hav(cur, finish) <= FINISH_TOL:
                break
            best = None
            for i, w in enumerate(ways):
                if i in used or len(w["poly"]) < 2:
                    continue
                poly = w["poly"]
                gap = dist_pt_poly(cur, poly)
                if gap > gap_lim:
                    continue
                if hav(cur, poly[0]) <= hav(cur, poly[-1]):
                    oriented = poly
                else:
                    oriented = poly[::-1]
                key = (round(oriented[0][0], 5), round(oriented[0][1], 5))
                if key in visited_nodes and pass_no == 0:
                    continue
                d_before = hav(cur, finish)
                d_after = hav(oriented[-1], finish)
                if need_progress and d_after > d_before - 30:
                    continue
                hw = (w.get("tags") or {}).get("highway", "track")
                bonus = TYPE_BONUS.get(hw, 100)
                # штрафуем уход от нашей линии и возвраты
                corridor = dist_pt_poly(oriented[-1], anchors)
                score = gap + bonus + corridor * 0.8 - (d_before - d_after) * 0.6
                if not need_progress:
                    score += hav(oriented[-1], finish) * 0.5
                if best is None or score < best[0]:
                    best = (score, i, oriented)
            if best is None:
                break
            _, i, oriented = best
            used.add(i)
            visited_nodes.add((round(oriented[0][0], 5), round(oriented[0][1], 5)))
            for pt in oriented:
                if not path or hav(path[-1], pt) > 1.5:
                    path.append(tuple(pt))
            cur = path[-1]

    end_gap = hav(cur, finish) if path else 9e9
    return path, end_gap


def main():
    if not os.path.exists(OSM):
        print("нет scripts/osm_real.json — сначала fetch_real.py")
        sys.exit(1)
    with open(OSM, encoding="utf-8") as f:
        osm = json.load(f)
    ways_by_route = osm.get("ways", {})

    result, report = {}, []
    for r in ROUTES:
        rid = r["id"]
        anchors = [tuple(p) for p in r["track"]]
        ways = ways_by_route.get(ALIAS.get(rid, rid), [])
        if len(ways) < 2 or len(anchors) < 2:
            report.append((rid, "нет данных", 0, 0, 0))
            continue
        path, eg = build_chain(anchors, ways)
        sg = hav(path[0], anchors[0]) if path else 9e9
        if len(path) < 4 or eg > 1200:
            # не смогли дойти — оставляем синтетику
            report.append((rid, "фолбэк (не собрался)", len(path), round(sg), round(eg)))
            continue
        result[rid] = [[round(p[0], 6), round(p[1], 6)] for p in path]
        report.append((rid, "OK", len(path), round(sg), round(eg)))

    # не перетираем то, что уже собрано (Valhalla) — только добавляем/заменяем своё
    final = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                final = json.load(f).get("routes", {})
        except Exception:
            final = {}
    final.update(result)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "© OpenStreetMap contributors (ODbL)",
                   "routes": final}, f, ensure_ascii=False)

    print("%-16s %-24s %6s %8s %8s" % ("route", "статус", "точки", "старт_м", "финиш_м"))
    for rid, st, n, sg, eg in report:
        print("%-16s %-24s %6d %8d %8d" % (rid, st, n, sg, eg))
    print("\n->", OUT, "| всего маршрутов по тропам:", len(final))


if __name__ == "__main__":
    main()
