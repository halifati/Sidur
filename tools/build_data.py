#!/usr/bin/env python3
"""Build the siddur data files (data/*.js) from the Sefaria export.

Usage:
    python3 tools/build_data.py <dir-with-downloaded-json>

The directory must contain the Hebrew "merged.json" of each siddur, downloaded from
https://storage.googleapis.com/sefaria-export/json/Liturgy/Siddur/<Title>/Hebrew/merged.json
saved as: ashkenaz.json, sefard.json, edot.json
"""
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")

SHVA_NA_MARK = "︀"  # invisible marker meaning "this shva is na" (forced)

NUSACHIM = {
    "ashkenaz": {
        "file": "ashkenaz.json",
        "title": "נוסח אשכנז",
        "srcShvaNa": True,
        "prayers": {
            "shacharit": {"title": "שחרית לימות החול", "paths": [["Weekday", "Shacharit"]]},
            "mincha": {"title": "מנחה לימות החול", "paths": [["Weekday", "Minchah"]]},
            "arvit": {
                "title": "ערבית לימות החול",
                "paths": [["Weekday", "Maariv"]],
                "skip": ["Birkat HaLevana", "Keri'at Shema al Hamita"],
            },
        },
    },
    "sefard": {
        "file": "sefard.json",
        "title": "נוסח ספרד",
        "srcShvaNa": True,
        "prayers": {
            "shacharit": {
                "title": "שחרית לימות החול",
                "paths": [["Upon Arising"], ["Weekday Shacharit"], ["Additional Prayers "]],
            },
            "mincha": {"title": "מנחה לימות החול", "paths": [["Weekday Mincha"]]},
            "arvit": {"title": "ערבית לימות החול", "paths": [["Weekday Maariv"]]},
        },
    },
    "edot": {
        "file": "edot.json",
        "title": "נוסח עדות המזרח",
        "srcShvaNa": False,
        "prayers": {
            "shacharit": {
                "title": "שחרית לימי החול",
                "paths": [["Preparatory Prayers"], ["Weekday Shacharit"], ["Additions for Shacharit"]],
            },
            "mincha": {"title": "מנחה לימי החול", "paths": [["Weekday Mincha"]]},
            "arvit": {"title": "ערבית לימי החול", "paths": [["Weekday Arvit"]]},
        },
    },
}

ALLOWED_TAGS = {"b", "small", "big", "br", "em"}


def clean(s, src_shva_na):
    # decompose Hebrew presentation forms (U+FB1D..U+FB4F) into letters + marks
    s = "".join(unicodedata.normalize("NFKD", ch) if "יִ" <= ch <= "ﭏ" else ch for ch in s)
    s = re.sub("[‎‏‪-‮‍­◌]", "", s)
    s = re.sub("[   ]+", " ", s)
    s = s.replace("‑", "-")
    if src_shva_na:
        # the source marks a shva na with U+0592 directly after the shva
        s = re.sub("ְ([ּׁׂ]*)֒", "ְ\\1" + SHVA_NA_MARK, s)
    # drop unknown tags, keep the simple inline ones
    def tag(m):
        name = m.group(2).lower()
        if name not in ALLOWED_TAGS:
            return ""
        if name == "br":
            return "<br>"
        return "<" + m.group(1) + name + ">"
    s = re.sub(r"<(/?)\s*([a-zA-Z]+)[^>]*>", tag, s)
    s = re.sub(r"[ \t\r\n]+", " ", s).strip()
    return s


def he_title(node):
    return node.get("heTitle") or node.get("enTitle")


def find_node(schema, path):
    node = schema
    for name in path:
        nxt = None
        for c in node.get("nodes", []):
            if c.get("enTitle") == name:
                nxt = c
                break
        if nxt is None:
            raise KeyError("/".join(path))
        node = nxt
    return node


def get_text(text, path):
    t = text
    for name in path:
        t = t[name]
    return t


def flatten(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, list):
        for x in v:
            yield from flatten(x)


def build_doc(data, cfg, nus_cfg):
    blocks = []
    counter = [0]

    def nid():
        counter[0] += 1
        return format(counter[0], "x")

    def emit(type_, html):
        blocks.append({"i": nid(), "t": type_, "h": html})

    def walk(node, text, level, skip):
        if node.get("enTitle") in skip:
            return
        has_content = any(s.strip() for s in flatten(text)) if not isinstance(text, dict) else True
        if not has_content:
            return
        emit("h%d" % min(level, 4), he_title(node))
        if isinstance(text, dict):
            for c in node.get("nodes", []):
                key = c.get("enTitle")
                if key in text:
                    walk(c, text[key], level + 1, skip)
        else:
            for s in flatten(text):
                s = clean(s, nus_cfg["srcShvaNa"])
                if s:
                    emit("p", s)

    emit("h1", cfg["title"])
    skip = set(cfg.get("skip", []))
    for path in cfg["paths"]:
        node = find_node(data["schema"], path)
        text = get_text(data["text"], path)
        if len(cfg["paths"]) == 1:
            # the single root is the prayer itself: its children are level 2
            for c in node.get("nodes", []):
                key = c.get("enTitle")
                if key in text:
                    walk(c, text[key], 2, skip)
        else:
            walk(node, text, 2, skip)
    return blocks


def main():
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for nus, ncfg in NUSACHIM.items():
        with open(os.path.join(src, ncfg["file"]), encoding="utf-8") as f:
            data = json.load(f)
        index[nus] = {"title": ncfg["title"], "prayers": {}}
        for pr, pcfg in ncfg["prayers"].items():
            blocks = build_doc(data, pcfg, ncfg)
            doc = {
                "nusach": nus,
                "prayer": pr,
                "title": pcfg["title"],
                "srcShvaNa": ncfg["srcShvaNa"],
                "source": "Sefaria – " + data.get("title", "") + " (" + data.get("versionTitle", "") + ")",
                "blocks": blocks,
            }
            key = nus + "/" + pr
            js = "window.SIDUR_DATA=window.SIDUR_DATA||{};window.SIDUR_DATA[%s]=%s;\n" % (
                json.dumps(key),
                json.dumps(doc, ensure_ascii=False, separators=(",", ":")),
            )
            path = os.path.join(OUT, "%s_%s.js" % (nus, pr))
            with open(path, "w", encoding="utf-8") as f:
                f.write(js)
            index[nus]["prayers"][pr] = pcfg["title"]
            print(path, len(blocks), "blocks", len(js) // 1024, "KB")


if __name__ == "__main__":
    main()
