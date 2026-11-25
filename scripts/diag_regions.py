"""Сверка наших опорных точек с реальными объектами OSM (озёра, вершины, деревни).

Один запрос на регион, дальше — расстояние от наших точек до ближайших объектов.
Overpass любит паузы: между регионами выдерживаем паузу.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, "scripts")
import fetch_trails as F  # noqa: E402

REGIONS = {
    "west": (43.00, 76.80, 43.50, 77.70),   # БАО, Тургень, Кок-Жайляу
    "east": (42.90, 78.00, 43.45, 79.30),   # Кольсае, Кайынды, Чарын
}


def fetch(q, tries=3):
    data = urllib.parse.urlencode({"data": q}).encode()
    for i in range(tries):
        for ep in F.ENDPOINTS:
            try:
                req = urllib.request.Request(
                    ep, data=data, headers={"User-Agent": "hiker-trails/1.0"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:  # noqa: BLE001
                print("   fail", ep, e, flush=True)
                time.sleep(8)
    return {"elements": []}


def query_region(name):
    s, w, n, e = REGIONS[name]
    bs = "%.4f,%.4f,%.4f,%.4f" % (s, w, n, e)
    q = ('[out:json][timeout:240];'
         '(way["natural"="water"]["name"](' + bs + ');'
         'relation["natural"="water"]["name"](' + bs + ');'
         'node["natural"="peak"]["name"](' + bs + ');'
         'way["natural"="peak"]["name"](' + bs + ');'
         'node["place"~"village|hamlet|town"]["name"](' + bs + ');'
         'way["tourism"~"attraction|viewpoint|camp_site|picnic_site"]["name"](' + bs + ');'
         'node["tourism"~"attraction|viewpoint|camp_site"]["name"](' + bs + ');'
         ');out tags center;')
    print("\n### регион", name, bs, flush=True)
    return fetch(q).get("elements", [])


def center(e):
    if e.get("lat") is not None:
        return (e["lat"], e["lon"])
    c = e.get("center")
    return (c["lat"], c["lon"]) if c else None


def main():
    regs = sys.argv[1:] or list(REGIONS)
    feats = {}
    for i, reg in enumerate(regs):
        if i:
            time.sleep(20)
        for e in query_region(reg):
            t = e.get("tags", {})
            nm = t.get("name")
            if not nm:
                continue
            c = center(e)
            if not c:
                continue
            kind = (t.get("natural") or t.get("place") or t.get("tourism") or "")
            feats[(nm, kind, round(c[0], 5), round(c[1], 5))] = (kind, nm, c)

    print("\n\n=== объекты OSM рядом с нашими опорными точками ===", flush=True)
    for rid, anchors in F.ANCHORS.items():
        print("\n--", rid, flush=True)
        for label, pt in (("СТАРТ", anchors[0]), ("ФИНИШ", anchors[-1])):
            best = []
            for (kind, nm, c) in feats.values():
                d = F.haversine(pt, c)
                best.append((d, kind, nm, c))
            best.sort()
            print("  %s %.5f,%.5f ->" % (label, pt[0], pt[1]), flush=True)
            for d, kind, nm, c in best[:4]:
                print("      %6.0f м  %-12s %-34s %.5f,%.5f"
                      % (d, kind, nm[:34], c[0], c[1]), flush=True)


if __name__ == "__main__":
    main()
