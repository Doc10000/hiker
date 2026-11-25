"""Точечный поиск объектов по имени — эталонные координаты пунктов назначения."""
import json
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, "scripts")
import fetch_trails as F  # noqa: E402

NAMES = ("Көлсай|Кольсае|Kolsai|Қайыңды|Кайынды|Kaindy|Үлкен Алматы|"
         "Большое Алматинское|Big Almaty|Турген|Түрген|Turgen|"
         "Жайлау|Zhailyau|Шарын|Charyn")
BBOX = "42.80,76.60,43.60,79.50"


def fetch(q, tries=4):
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
                time.sleep(10)
    return {"elements": []}


q = ('[out:json][timeout:240];'
     '(node["name"~"' + NAMES + '"](' + BBOX + ');'
     'way["name"~"' + NAMES + '"](' + BBOX + ');'
     'relation["name"~"' + NAMES + '"](' + BBOX + '););'
     'out tags center;')

js = fetch(q)
rows = []
for e in js.get("elements", []):
    t = e.get("tags", {})
    nm = t.get("name")
    if not nm:
        continue
    if e.get("lat") is not None:
        c = (e["lat"], e["lon"])
    else:
        ctr = e.get("center") or {}
        c = (ctr.get("lat"), ctr.get("lon"))
    if not c[0]:
        continue
    kind = (t.get("natural") or t.get("place") or t.get("tourism")
            or t.get("waterway") or t.get("water") or e.get("type") or "")
    rows.append((nm, kind, c[0], c[1], t.get("ele", ""), e.get("id")))

rows.sort(key=lambda r: (r[0], r[2]))
print("найдено:", len(rows), flush=True)
for nm, kind, lat, lon, ele, oid in rows:
    print("  %-34s %-12s %.6f, %.6f  ele=%-6s %s" % (nm[:34], kind, lat, lon, ele, oid),
          flush=True)
