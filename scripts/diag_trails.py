"""Диагностика: что реально лежит в OSM вокруг наших маршрутов."""
import json
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, "scripts")
import fetch_trails as F  # noqa: E402

HW = sys.argv[1] if len(sys.argv) > 1 else "path|footway|track|bridleway|steps|service"
ROUTES = sys.argv[2:] or ["kolsai"]


def fetch(bs, hw):
    q = '[out:json][timeout:180];way["highway"~"^(' + hw + ')$"](' + bs + ');out geom;'
    data = urllib.parse.urlencode({"data": q}).encode()
    for ep in F.ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=data,
                                         headers={"User-Agent": "hiker-trails/1.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print("  endpoint fail:", ep, e, flush=True)
    return {"elements": []}


for rid in ROUTES:
    anchors = F.ANCHORS[rid]
    b = F.bbox(anchors, pad=0.03)
    bs = "%.5f,%.5f,%.5f,%.5f" % b
    print("\n===", rid, "bbox", bs, flush=True)
    js = fetch(bs, HW)
    rows = []
    for w in js.get("elements", []):
        if w.get("type") != "way" or len(w.get("geometry", [])) < 2:
            continue
        poly = [(g["lat"], g["lon"]) for g in w["geometry"]]
        s = F.score(anchors, poly)
        ln = sum(F.haversine(poly[i], poly[i + 1]) for i in range(len(poly) - 1))
        tags = w.get("tags", {})
        rows.append((s, w["id"], tags.get("highway", ""),
                     (tags.get("name") or "")[:24], round(ln), len(poly)))
    rows.sort()
    print("  ways:", len(rows), flush=True)
    for r in rows[:20]:
        print("  откл %7.0f | way %-11s | %-11s | %-24s | %5d м | %d точек" % r,
              flush=True)
