# -*- coding: utf-8 -*-
"""route_valhalla.py — строит треки по реальной пешей сети OSM (Valhalla).

Запрос: https://valhalla1.openstreetmap.de/route, costing=pedestrian.
Возвращает полилинию маршрута по дорогам/тропам — это и есть «тропа».

Критерий качества: финиш ближе 1.5 км до цели и длина не больше 4× прямой.
Не прошедшие проверку маршруты остаются на синтетике (см. gen_routes.py).

Запуск: python scripts/route_valhalla.py
"""
import json
import math
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_routes import ROUTES  # noqa: E402

URL = "https://valhalla1.openstreetmap.de/route"
OUT = "scripts/route_trails.json"
MAX_DETOUR = 4.0        # длина / прямая
MAX_END_GAP = 1500      # м до цели


def hav(a, b):
    dy = (a[0] - b[0]) * 111320.0
    dx = (a[1] - b[1]) * 111320.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def decode(shape, precision=6):
    """Декодирование polyline Google (precision6)."""
    coords, index, lat, lng = [], 0, 0, 0
    factor = 10 ** precision
    while index < len(shape):
        for coord in range(2):
            shift = result = 0
            while True:
                b = ord(shape[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if not (b & 0x20):
                    break
            if result & 1:
                result = ~(result >> 1)
            else:
                result >>= 1
            if coord == 0:
                lat += result
            else:
                lng += result
        coords.append((lat / factor, lng / factor))
    return coords


def route(start, finish):
    body = {"locations": [{"lat": start[0], "lon": start[1]},
                          {"lat": finish[0], "lon": finish[1]}],
            "costing": "pedestrian",
            "directions_options": {"units": "kilometers"}}
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json",
                 "User-Agent": "hiker-trails/1.0 (hackathon demo)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    result = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            result = json.load(f).get("routes", {})

    print("%-16s %6s %8s %8s %8s %s" %
          ("route", "точки", "км", "прямая", "финиш_м", "статус"))
    for r in ROUTES:
        rid = r["id"]
        if rid in result:
            print("%-16s %6s %8s %8s %8s %s" %
                  (rid, "-", "-", "-", "-", "уже есть (тропа OSM)"))
            continue
        anchors = [tuple(p) for p in r["track"]]
        start, finish = anchors[0], anchors[-1]
        straight = hav(start, finish)
        try:
            resp = route(start, finish)
        except Exception as e:  # noqa: BLE001
            print("%-16s %6s %8s %8s %8s %s" % (rid, "-", "-", "-", "-", "ERR " + str(e)[:40]))
            time.sleep(2)
            continue
        if "trip" not in resp:
            print("%-16s %6s %8s %8s %8s %s" % (rid, "-", "-", "-", "-", "нет trip"))
            time.sleep(2)
            continue
        leg = resp["trip"]["legs"][0]
        poly = decode(leg.get("shape", ""))
        km = resp["trip"]["summary"].get("length", 0)
        end_gap = hav(poly[-1], finish) if poly else 9e9
        detour = (km * 1000 / straight) if straight > 1 else 99

        if len(poly) >= 4 and end_gap <= MAX_END_GAP and detour <= MAX_DETOUR:
            result[rid] = [[round(p[0], 6), round(p[1], 6)] for p in poly]
            status = "OK"
        else:
            status = "отклонён (объезд %.1f×, финиш %d м)" % (detour, end_gap)
        print("%-16s %6d %8.1f %8.1f %8d %s" %
              (rid, len(poly), km, straight, end_gap, status))
        time.sleep(1.5)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "© OpenStreetMap contributors (ODbL)",
                   "engine": "Valhalla pedestrian (valhalla1.openstreetmap.de)",
                   "routes": result}, f, ensure_ascii=False)
    print("\n->", OUT, "| маршрутов по тропам:", len(result))


if __name__ == "__main__":
    main()
