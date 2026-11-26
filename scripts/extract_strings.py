# -*- coding: utf-8 -*-
"""Собирает все видимые русские строки из www/ — что нужно перевести.

Вывод:
  STATIC  — точные строки (подходят словарю applyI18n)
  DYN     — с ${...} (нужен tk()/tr() в коде)
"""
import io
import os
import re
import sys

ROOT = "www"
CYR = re.compile(r"[А-Яа-яЁё]")


def add(store, s, src):
    s = s.strip()
    if not s or not CYR.search(s):
        return
    # отсекаем обрывки: одна буква, мусор из кода
    if len(CYR.findall(s)) < 2:
        return
    if s not in store:
        store[s] = src


static, dyn = {}, {}

# ── HTML: текстовые узлы ──
with io.open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
    html = f.read()
html = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
html = re.sub(r"<style.*?</style>", " ", html, flags=re.S)
for m in re.finditer(r">([^<>]+)<", html):
    add(static, m.group(1), "index.html")
# плейсхолдеры и title
for m in re.finditer(r'placeholder="([^"]+)"', html):
    add(static, m.group(1), "index.html@ph")
for m in re.finditer(r'title="([^"]+)"', html):
    add(static, m.group(1), "index.html@title")

# ── JS: строковые литералы ──
js_files = ["js/app.js", "js/data.js", "js/map.js", "share.html"]
for name in js_files:
    p = os.path.join(ROOT, name)
    if not os.path.exists(p):
        continue
    with io.open(p, encoding="utf-8") as f:
        src = f.read()
    if name.endswith(".html"):
        src = re.sub(r"<script.*?</script>", " ", src, flags=re.S)
    # одинарные и двойные кавычки
    for m in re.finditer(r"(['\"])((?:[^\\'\"\\n]|\\.)*)\1", src):
        lit = m.group(2)
        if "${" in lit:
            add(dyn, lit, name)
        else:
            add(static, lit, name)
    # шаблонные строки
    for m in re.finditer(r"`([^`]*)`", src):
        add(dyn, m.group(1), name)

# убираем из static те, что содержат ${} (уже в dyn)
for k in list(static):
    if "${" in k:
        dyn[k] = static.pop(k)

out = []
out.append("=== STATIC (%d) ===" % len(static))
for k in sorted(static, key=lambda x: (len(x), x)):
    out.append("[%s] %s" % (static[k], k))
out.append("")
out.append("=== DYN (%d) ===" % len(dyn))
for k in sorted(dyn, key=lambda x: (len(x), x)):
    out.append("[%s] %s" % (dyn[k], k))

with io.open("scripts/strings_ru.txt", "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(out))
print("static:", len(static), "dyn:", len(dyn))
print("-> scripts/strings_ru.txt")
