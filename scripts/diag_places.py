"""Есть ли водоёмы/населённые пункты рядом с нашими опорными точками."""
import json
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, "scripts")
import fetch_trails as F  # noqa: E402


def fetch(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    for ep in F.ENDPOINTS:
        try:
            req = urllib.request.Request(ep, data=data,
                                         headers={"User-Agent": "hiker-trails/1.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print("  fail:", ep, e, flush=True)
    return {"elements": []}


for rid in sys.argv[1:] or ["kolsai", "kok-zhaylyau", "charyn"]:
    b = F.bbox(F.ANCHORS[rid], pad=0.12)
    bs = "%.5f,%.5f,%.5f,%.5f" % b
    print("\n===", rid, "широкий bbox", bs, flush=True)
    q = ('[out:json][timeout:180];'
         '(way["natural"="water"](' + bs + ');'
         'relation["natural"="water"](' + bs + ');'
         'way["place"~"village|hamlet|town"](' + bs + ');'
         'node["place"~"village|hamlet|town"](' + bs + '););'
         'out tags center;')
    js = fetch(q)
    for e in js.get("elements", []):
        t = e.get("tags", {})
        name = t.get("name", "")
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if name:
            print("   %-12s %-28s %s %s" % (t.get("natural") or t.get("place"),
                                           name, lat, lon), flush=True)
