"""fetch_trails.py — вытягивает реальные тропы из OpenStreetMap (Overpass API).

Использование:  python scripts/fetch_trails.py [--route kolsai] [--dump out.json]

Лицензия данных: © OpenStreetMap contributors, ODbL — атрибуция обязательна.
Скрипт одноразовый: результат встраивается в www/js/data.js, на устройстве
сетевые запросы не выполняются.
"""
import json
import sys
import urllib.parse
import urllib.request

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Опорные точки маршрутов (как в www/js/data.js) — для построения bbox
ANCHORS = {
    "bao": [(43.216, 77.075), (43.204, 77.066), (43.193, 77.056),
            (43.181, 77.049), (43.170, 77.044), (43.159, 77.041)],
    "turgень": [(43.265, 77.268), (43.251, 77.290), (43.236, 77.313),
                (43.220, 77.334), (43.203, 77.353), (43.187, 77.371)],
    "charyn": [(43.358, 79.072), (43.352, 79.060), (43.345, 79.050),
               (43.337, 79.043), (43.328, 79.038), (43.319, 79.034)],
    "kolsai": [(43.218, 78.290), (43.205, 78.278), (43.191, 78.266),
               (43.176, 78.254), (43.161, 78.243), (43.147, 78.232),
               (43.134, 78.221)],
    "kolsai-kaindy": [(43.147, 78.232), (43.128, 78.256), (43.108, 78.277),
                      (43.086, 78.294), (43.063, 78.306), (43.040, 78.312),
                      (43.018, 78.311), (42.998, 78.303)],
    "kok-zhaylyau": [(43.251, 77.290), (43.244, 77.310), (43.237, 77.330),
                     (43.230, 77.349), (43.224, 77.366), (43.219, 77.381)],
}


def bbox(anchors, pad=0.02):
    lats = [a[0] for a in anchors]
    lngs = [a[1] for a in anchors]
    return (min(lats) - pad, min(lngs) - pad,
            max(lats) + pad, max(lngs) + pad)


def query(bbox_s, hw):
    q = f'[out:json][timeout:90];way["highway"~"^({hw})$"]({bbox_s});out geom;'
    data = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=data,
                                         headers={"User-Agent": "hiker-trails/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:          # noqa: BLE001
            last = e
    raise RuntimeError(f"Overpass недоступен: {last}")


def haversine(a, b):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371000.0
    dlat = radians(b[0] - a[0])
    dlng = radians(b[1] - a[1])
    x = sin(dlat / 2) ** 2 + cos(radians(a[0])) * cos(radians(b[0])) * sin(dlng / 2) ** 2
    return 2 * R * atan2(sqrt(x), sqrt(1 - x))


def dist_point_to_poly(p, poly):
    """Минимальное расстояние от точки до ломаной (грубо, по сегментам)."""
    best = float("inf")
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        # проекция на отрезок в градусах → метры приближённо
        dx, dy = b[1] - a[1], b[0] - a[0]
        if dx == 0 and dy == 0:
            d = haversine(p, a)
        else:
            t = ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / (dx * dx + dy * dy)
            t = max(0.0, min(1.0, t))
            proj = (a[0] + t * dy, a[1] + t * dx)
            d = haversine(p, proj)
        best = min(best, d)
    return best


def score(anchors, poly):
    """Насколько ломаная похожа на наш коридор: среднее отклонение опорных точек."""
    if len(poly) < 2:
        return float("inf")
    ds = [dist_point_to_poly(p, poly) for p in anchors]
    ds.sort()
    # берём80% лучших — устойчивее к ответвлениям
    k = max(1, int(len(ds) * 0.8))
    return sum(ds[:k]) / k


def main():
    routes = sys.argv[2:] if len(sys.argv) > 2 and sys.argv[1] == "--route" else list(ANCHORS)
    if len(sys.argv) > 1 and sys.argv[1] == "--route" and len(sys.argv) > 2:
        routes = [sys.argv[2]]

    HW = "path|footway|track|bridleway|steps"
    out = {}
    for rid in routes:
        anchors = ANCHORS[rid]
        b = bbox(anchors)
        bs = f"{b[0]:.5f},{b[1]:.5f},{b[2]:.5f},{b[3]:.5f}"
        print(f"\n=== {rid}  bbox={bs}", flush=True)
        js = query(bs, HW)
        ways = [e for e in js.get("elements", []) if e.get("type") == "way"
                and len(e.get("geometry", [])) > 1]
        print(f"  ways: {len(ways)}", flush=True)
        if not ways:
            print("  !! нет ways — оставляем текущие точки", flush=True)
            continue

        ranked = []
        for w in ways:
            poly = [(g["lat"], g["lon"]) for g in w["geometry"]]
            s = score(anchors, poly)
            length = sum(haversine(poly[i], poly[i + 1]) for i in range(len(poly) - 1))
            ranked.append({"id": w["id"], "score": round(s, 1),
                           "len_m": round(length), "poly": poly,
                           "tags": w.get("tags", {})})
        ranked.sort(key=lambda r: r["score"])
        for r in ranked[:6]:
            print(f"  way {r['id']}: отклонение {r['score']} м, длина {r['len_m']} м, "
                  f"{r['tags'].get('highway')} {r['tags'].get('name','')}", flush=True)

        main_w = ranked[0]
        others = [r for r in ranked[1:] if r["score"] < 200 and r["len_m"] > 150][:3]
        out[rid] = {
            "bbox": bs,
            "main": {"osm_id": main_w["id"], "score": main_w["score"],
                     "len_m": main_w["len_m"], "tags": main_w["tags"],
                     "poly": [[round(p[0], 6), round(p[1], 6)] for p in main_w["poly"]]},
            "others": [{"osm_id": r["id"], "score": r["score"], "len_m": r["len_m"],
                        "poly": [[round(p[0], 6), round(p[1], 6)] for p in r["poly"]]}
                       for r in others],
        }
        print(f"  --> основной way {main_w['id']} (отклонение {main_w['score']} м), "
              f"соседних: {len(others)}", flush=True)

    path = "scripts/osm_trails.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"source": "© OpenStreetMap contributors (ODbL)",
                   "overpass": ENDPOINTS[0], "routes": out}, f, ensure_ascii=False)
    print(f"\nЗаписано {path}")


if __name__ == "__main__":
    main()
