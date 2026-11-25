"""Какие highway-типы и route-релейшены есть в bbox маршрута."""
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


rid = sys.argv[1] if len(sys.argv) > 1 else "kolsai"
b = F.bbox(F.ANCHORS[rid], pad=0.04)
bs = "%.5f,%.5f,%.5f,%.5f" % b
print("bbox", bs, flush=True)

js = fetch('[out:json][timeout:180];way["highway"](' + bs + ');out tags;')
from collections import Counter  # noqa: E402
c = Counter(e.get("tags", {}).get("highway") for e in js.get("elements", []))
print("highway-типы:", dict(c), flush=True)

js2 = fetch('[out:json][timeout:180];relation["route"~"hiking|foot|footway|bicycle"](' + bs + ');out tags;')
print("route-релейшены:", flush=True)
for e in js2.get("elements", []):
    t = e.get("tags", {})
    print("  rel", e.get("id"), t.get("route"), t.get("name", ""), t.get("network", ""),
          flush=True)

js3 = fetch('[out:json][timeout:180];node["tourism"~"camp_site|picnic_site|viewpoint|attraction"](' + bs + ');out tags;')
print("туристические точки:", flush=True)
for e in js3.get("elements", []):
    t = e.get("tags", {})
    print("  node", e.get("id"), t.get("tourism"), t.get("name", ""), flush=True)
