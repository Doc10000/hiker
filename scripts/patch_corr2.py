# -*- coding: utf-8 -*-
"""Чинит CORRECTIONS.update → слияние (иначе второй блок затирает первый)."""
import io

P = "scripts/build_i18n.py"
src = io.open(P, encoding="utf-8").read()

if "CORRECTIONS_M" in src:
    print("already fixed")
else:
    assert "CORRECTIONS.update({" in src, "no update block"
    src = src.replace("CORRECTIONS.update({", "CORRECTIONS_M = {", 1)

    tail = "\n})\n\nif __name__"
    assert tail in src, "tail not found"
    src = src.replace(
        tail,
        "\n}\nfor _lang, _fix in CORRECTIONS_M.items():\n"
        "    CORRECTIONS.setdefault(_lang, {}).update(_fix)\n\n"
        "if __name__",
        1,
    )
    io.open(P, "w", encoding="utf-8", newline="\n").write(src)
    print("fixed ok")
