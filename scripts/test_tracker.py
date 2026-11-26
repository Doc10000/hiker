# -*- coding: utf-8 -*-
"""test_tracker.py — проверка сервера метки: эндпоинты, CORS, ошибки, персистентность."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8087"
TRACK = "server/tracker.py"
DATA = "server/tracks.json"
ok = fail = 0


def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print("  OK   ", name, extra)
    else:
        fail += 1
        print("  FAIL ", name, extra)


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, resp.read().decode(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)
    except Exception as e:  # noqa: BLE001
        return 0, str(e), {}


print("== tracker.py ==")
if os.path.exists(DATA):
    os.remove(DATA)

proc = subprocess.Popen([sys.executable, TRACK, "--port", "8087"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        time.sleep(0.4)
        st, body, _ = req("GET", "/api/health")
        if st == 200:
            break

    print("-- health --")
    st, body, _ = req("GET", "/api/health")
    check("GET /api/health = 200", st == 200, body[:80])
    h = json.loads(body)
    check("health содержит tracks/now", "tracks" in h and "now" in h)

    print("-- запись --")
    payload = {"tripId": "testroute01", "lat": 43.134, "lng": 78.221, "acc": 12,
               "at": int(time.time() * 1000), "status": "ok",
               "name": "Тест", "route": "Кольсае",
               "deadline": 1, "startedAt": 2}
    st, body, _ = req("POST", "/api/track", payload)
    check("POST /api/track = 200", st == 200, body[:80])
    check("POST вернул ok:true", json.loads(body).get("ok") is True)

    print("-- чтение --")
    st, body, hdr = req("GET", "/api/track/testroute01")
    check("GET /api/track/<id> = 200", st == 200)
    rec = json.loads(body)
    check("поля сохранились", rec.get("lat") == 43.134 and rec.get("route") == "Кольсае")
    check("server_now отдан", "server_now" in rec)
    check("CORS: Access-Control-Allow-Origin=*",
          hdr.get("Access-Control-Allow-Origin") == "*",
          str(hdr.get("Access-Control-Allow-Origin")))

    print("-- частичное обновление --")
    st, body, _ = req("POST", "/api/track", {"tripId": "testroute01", "status": "overdue"})
    rec = json.loads(req("GET", "/api/track/testroute01")[1])
    check("status обновился, lat сохранился",
          rec.get("status") == "overdue" and rec.get("lat") == 43.134)

    print("-- ошибки --")
    st, body, _ = req("POST", "/api/track", {"lat": 1})
    check("POST без tripId = 400", st == 400, body[:60])
    st, body, _ = req("POST", "/api/track", {"tripId": "bad id!"})
    check("POST c невалидным tripId = 400", st == 400, body[:60])
    st, body, _ = req("GET", "/api/track/nope123")
    check("GET неизвестного = 404", st == 404)
    st, body, _ = req("GET", "/api/zzz")
    check("неизвестный путь = 404", st == 404)
    st, body, _ = req("GET", "/api/track")
    check("GET /api/track (без id) = 404", st == 404)

    print("-- preflight --")
    st, body, hdr = req("OPTIONS", "/api/track")
    check("OPTIONS = 204 + CORS methods",
          st == 204 and "POST" in (hdr.get("Access-Control-Allow-Methods") or ""),
          str(st))

    print("-- персистентность --")
    check("tracks.json создан", os.path.exists(DATA))
    disk = json.load(open(DATA, encoding="utf-8")) if os.path.exists(DATA) else {}
    check("запись на диске", "testroute01" in disk)
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

if os.path.exists(DATA):
    disk = json.load(open(DATA, encoding="utf-8"))
    print("-- после остановки --")
    check("данные пережили рестарт сервера", "testroute01" in disk)
    os.remove(DATA)

print("\nИТОГ: OK=%d FAIL=%d" % (ok, fail))
sys.exit(1 if fail else 0)
