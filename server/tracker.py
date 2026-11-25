# -*- coding: utf-8 -*-
"""tracker.py — локальный сервер живой метки «Горный хайкер».

Запуск:  python server/tracker.py            (порт 8087)
         python server/tracker.py --port 9000

Эндпоинты:
  POST /api/track      {tripId, lat, lng, acc, at, status, name, route, deadline, startedAt}
  GET  /api/track/<id> последнее состояние похода
  GET  /api/health     проверка

Хранение: server/tracks.json (перезаписывается при каждом обновлении).
CORS открыт — страница близкого может лежать на любом домене.
Ничего кроме стандартной библиотеки не нужно.
"""
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8087
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "tracks.json")

store = {}
if os.path.exists(DATA):
    try:
        with open(DATA, encoding="utf-8") as f:
            store = json.load(f)
    except Exception:
        store = {}


def save():
    try:
        with open(DATA, "w", encoding="utf-8") as f:
            json.dump(store, f, ensure_ascii=False)
    except Exception as e:
        print("save error:", e, flush=True)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            return self._json(200, {"ok": True, "tracks": len(store),
                                    "now": int(time.time())})
        m = re.match(r"^/api/track/([A-Za-z0-9_-]+)$", path)
        if m:
            tid = m.group(1)
            rec = store.get(tid)
            if not rec:
                return self._json(404, {"ok": False, "error": "not found"})
            rec = dict(rec)
            rec["ok"] = True
            rec["server_now"] = int(time.time())
            return self._json(200, rec)
        return self._json(404, {"ok": False, "error": "unknown path"})

    def do_POST(self):
        path = self.path.split("?")[0]
        if path != "/api/track":
            return self._json(404, {"ok": False, "error": "unknown path"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception as e:
            return self._json(400, {"ok": False, "error": "bad json: %s" % e})

        tid = payload.get("tripId")
        if not tid or not re.match(r"^[A-Za-z0-9_-]{6,64}$", str(tid)):
            return self._json(400, {"ok": False, "error": "bad tripId"})

        cur = store.get(tid, {})
        for k in ("lat", "lng", "acc", "at", "status", "name", "route",
                  "deadline", "startedAt", "msg"):
            if k in payload:
                cur[k] = payload[k]
        cur["tripId"] = tid
        cur["seen"] = int(time.time())
        store[tid] = cur
        save()
        return self._json(200, {"ok": True, "tripId": tid, "seen": cur["seen"]})

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - %s\n" % (time.strftime("%H:%M:%S"), fmt % args))
        sys.stdout.flush()


def main():
    global PORT
    if "--port" in sys.argv:
        try:
            PORT = int(sys.argv[sys.argv.index("--port") + 1])
        except Exception:
            pass
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("tracker: http://127.0.0.1:%d  (data: %s)" % (PORT, DATA), flush=True)
    print("health:  http://127.0.0.1:%d/api/health" % PORT, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("stopped", flush=True)


if __name__ == "__main__":
    main()
