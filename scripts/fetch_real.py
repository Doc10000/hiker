"""Один запрос: геометрия реального туристического релейшена + соседние тропы."""
import json
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, "scripts")
import fetch_trails as F  # noqa: E402

# новые bbox под исправленные маршруты (см. ROUTES в www/js/data.js)
BBOX = {
    "bao": "43.03,76.96,43.20,77.09",
    "turgень": "43.16,77.58,43.37,77.74",
    "charyn": "43.33,78.97,43.38,79.10",
    "kolsai": "42.92,78.27,43.04,78.35",
    "kaindy": "42.97,78.31,43.00,78.48",
    "kok-zhaylyau": "43.12,76.98,43.20,77.04",
}
RELATION_ID = 19350811          # «Ак-Булак – Кок Жайлау», реальный маршрут


def fetch(q, tries=4):
    data = urllib.parse.urlencode({"data": q}).encode()
    for _ in range(tries):
        for ep in F.ENDPOINTS:
            try:
                req = urllib.request.Request(
                    ep, data=data, headers={"User-Agent": "hiker-trails/1.0"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:  # noqa: BLE001
                print("  fail", ep, e, flush=True)
                time.sleep(10)
    return {"elements": []}


parts = ["relation(" + str(RELATION_ID) + ")"]
for bb in BBOX.values():
    parts.append('way["highway"~"^(path|footway|track|bridleway|steps)$"](' + bb + ")")
q = "[out:json][timeout:240];(" + ";".join(parts) + ");out geom;"
print("query ok, идёт запрос...", flush=True)
js = fetch(q)

rel = None
ways = []
for e in js.get("elements", []):
    if e.get("type") == "relation":
        rel = e
    elif e.get("type") == "way":
        ways.append(e)

out = {"relation": None, "ways": {}}
if rel:
    members = [m for m in rel.get("members", []) if m.get("geometry")]
    poly = []
    for m in members:
        poly += [[round(g["lat"], 6), round(g["lon"], 6)] for g in m["geometry"]]
    out["relation"] = {"id": rel.get("id"),
                       "tags": rel.get("tags", {}),
                       "points": len(poly), "poly": poly}
    print("релейшен", rel.get("id"), rel.get("tags", {}).get("name"),
          "точек:", len(poly), flush=True)

for rid in BBOX:
    out["ways"][rid] = []
print("ways всего:", len(ways), flush=True)

# раскладываем ways по bbox — по принадлежности центра
for w in ways:
    geom = w.get("geometry") or []
    if not geom:
        continue
    clat = sum(g["lat"] for g in geom) / len(geom)
    clon = sum(g["lon"] for g in geom) / len(geom)
    for rid, bb in BBOX.items():
        s, we, n, e = [float(x) for x in bb.split(",")]
        if s <= clat <= n and we <= clon <= e:
            out["ways"][rid].append({
                "id": w["id"],
                "tags": w.get("tags", {}),
                "poly": [[round(g["lat"], 6), round(g["lon"], 6)] for g in geom]})
            break

for rid, lst in out["ways"].items():
    print(rid, "ways:", len(lst), flush=True)

with open("scripts/osm_real.json", "w", encoding="utf-8") as f:
    json.dump({"source": "© OpenStreetMap contributors (ODbL)", **out}, f,
              ensure_ascii=False)
print("записано scripts/osm_real.json", flush=True)
