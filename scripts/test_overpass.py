# -*- coding: utf-8 -*-
"""Печатает тело ответа Overpass при ошибке — диагностика HTTP 400."""
import json
import sys
import urllib.parse
import urllib.request

QUERIES = {
    "relation+ways": (
        '[out:json][timeout:120];'
        '(relation(19350811);'
        'way["highway"~"^(path|footway|track|bridleway|steps)$"]'
        '(43.12,76.98,43.20,77.04););out geom;'
    ),
    "only-ways": (
        '[out:json][timeout:120];'
        'way["highway"~"^(path|footway|track|bridleway|steps)$"]'
        '(43.12,76.98,43.20,77.04);out geom;'
    ),
    "only-relation": '[out:json][timeout:120];relation(19350811);out geom;'
}

for name, q in QUERIES.items():
    data = urllib.parse.urlencode({"data": q}).encode()
    for ep in ("https://overpass-api.de/api/interpreter",
               "https://overpass.kumi.systems/api/interpreter"):
        try:
            req = urllib.request.Request(
                ep, data=data, headers={"User-Agent": "hiker-trails/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                js = json.loads(r.read().decode("utf-8"))
            print(name, "@", ep.split("//")[1][:20], "-> OK, elements:",
                  len(js.get("elements", [])), flush=True)
            break
        except Exception as ex:  # noqa: BLE001
            print(name, "@", ep.split("//")[1][:20], "->", type(ex).__name__,
                  str(ex)[:120], flush=True)
            fn = getattr(ex, "read", None)
            if fn:
                print("   BODY:", fn().decode("utf-8", "ignore")[:400], flush=True)
            sys.stdout.flush()
