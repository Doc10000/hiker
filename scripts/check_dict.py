# -*- coding: utf-8 -*-
"""Диагностика: какие ключи есть/нет в i18n_data.js и что в CORRECTIONS."""
import io
import re

src = io.open("www/js/i18n_data.js", encoding="utf-8").read()
b = io.open("scripts/build_i18n.py", encoding="utf-8").read()

keys = ["Близкие", "рекомендовано", "нет связи", "Низкий", "Очень высокий",
        "Риск:", " км", "Данные инфраструктуры", "маршрут"]
for k in keys:
    pat = re.escape("'" + k + "'") + r"\s*:\s*'"
    m = re.search(pat, src)
    print(repr(k), "->", (src[m.start():m.start() + 70].replace("\n", " ")
                          if m else "НЕТ"))

print("--- build_i18n.py ---")
print("CORRECTIONS.update есть:", "CORRECTIONS.update" in b)
m = re.search(r'"en":\s*\{[^}]*\}', b)
print("первая en-запись:", m.group(0)[:160] if m else "?")
