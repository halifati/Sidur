#!/usr/bin/env python3
"""Build the "Edot HaMizrach with kavanot" siddur (data/kavanot_*.js) from a Word file.

Usage:
    python3 tools/build_kavanot.py <siddur.docx>

How the Word file is read (by font size and parentheses):
  * text inside parentheses, and small cue words (size <= 12pt, e.g. "נשימה") -> kavanah  <k>
  * other text up to 16pt                                                    -> instruction <small>
  * larger text                                                              -> prayer text (bold kept)
  * a short, unvocalized paragraph in large type                            -> section heading
The prayer text is copied exactly, with its nikud; the app adds shva na etc. on top of it.
"""
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

# paragraph ranges of the weekday prayers in the Word file, located by their title paragraphs
PRAYERS = [
    # key, title in the app, first title in the file, title that ends the range
    ('shacharit', 'שחרית לימי החול', 'סדר השכמת הבוקר', 'תפילת מנחה לימי החול'),
    ('mincha', 'מנחה לימי החול', 'תפילת מנחה לימי החול', 'תפילת ערבית לימי החול'),
    ('arvit', 'ערבית לימי החול', 'תפילת ערבית לימי החול', 'ספירת העומר'),
]

NIK = re.compile('[ְ-ׇּׁׂ]')
HEB = re.compile('[א-ת]')


def rval(rpr, tag):
    if rpr is None:
        return None
    x = rpr.find(W + tag)
    if x is None:
        return None
    return x.get(W + 'val', 'true')


def read_paragraphs(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read('word/document.xml'))
    paras = []
    for p in root.find(W + 'body').iter(W + 'p'):
        chars = []  # (char, size_halfpoints, bold)
        for r in p.iter(W + 'r'):
            rpr = r.find(W + 'rPr')
            sz = int(rval(rpr, 'szCs') or rval(rpr, 'sz') or 24)
            b = (rval(rpr, 'b') or rval(rpr, 'bCs')) not in (None, '0', 'false')
            for ch in r:
                if ch.tag == W + 't':
                    for c in ch.text or '':
                        chars.append((c, sz, b))
                elif ch.tag == W + 'tab':
                    chars.append((' ', sz, b))
                elif ch.tag in (W + 'br', W + 'cr'):
                    chars.append(('\n', sz, b))
        paras.append(chars)
    return paras


def plain(chars):
    return ''.join(c for c, _, _ in chars)


def vocalized_ratio(text):
    words = [w for w in text.split() if HEB.search(w)]
    if not words:
        return 0
    return sum(1 for w in words if NIK.search(w)) / len(words)


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def classify(chars):
    """-> list of (category, bold, text) with category in prayer|instr|kav|br"""
    out = []
    depth = 0
    for c, sz, b in chars:
        if c == '\n':
            out.append(['br', False, ''])
            continue
        if c == '(':
            depth += 1
        cat = 'kav' if depth > 0 else ('kav' if sz <= 24 else 'instr' if sz <= 32 else 'prayer')
        if c == ')':
            depth = max(0, depth - 1)
        if c.isspace():
            # whitespace joins the previous run, so it never creates a run of its own
            if out and out[-1][0] != 'br':
                out[-1][2] += ' '
            continue
        bold = b and cat == 'prayer'
        if out and out[-1][0] == cat and out[-1][1] == bold:
            out[-1][2] += c
        else:
            out.append([cat, bold, c])
    # punctuation-only pieces outside parentheses belong to the prayer text around them
    for r in out:
        if r[0] == 'instr' and not HEB.search(r[2]):
            r[0], r[1] = 'prayer', False
    merged = []
    for r in out:
        if merged and r[0] != 'br' and merged[-1][0] == r[0] and merged[-1][1] == r[1]:
            merged[-1][2] += r[2]
        else:
            merged.append(r)
    return merged


def to_html(runs):
    html = ''
    prev = ''
    for cat, bold, text in runs:
        if cat == 'br':
            html += '<br>'
            prev = ' '
            continue
        # keep a space between a word and a kavanah in parentheses, for line breaking
        if text.startswith('(') and prev and not prev[-1].isspace():
            text = ' ' + text
        elif cat != 'kav' and prev.endswith(')') and HEB.match(text):
            text = ' ' + text
        t = esc(re.sub(r'\s+', ' ', text))
        # spaces stay outside the tags, so hiding a kavanah never glues two words together
        m = re.match(r'^(\s*)(.*?)(\s*)$', t, re.S)
        lead, core, trail = m.group(1), m.group(2), m.group(3)
        if core:
            if cat == 'kav':
                core = '<k>' + core + '</k>'
            elif cat == 'instr':
                core = '<small>' + core + '</small>'
            elif bold:
                core = '<b>' + core + '</b>'
        html += lead + core + trail
        prev = text
    html = re.sub(r'(<br>)+$', '', html.strip())
    return html


def is_heading(chars):
    text = plain(chars).strip()
    outside = re.sub(r'\([^)]*\)', '', text).strip()
    if not outside or len(outside) > 60 or '\n' in text:
        return False
    if vocalized_ratio(outside) > 0.3:
        return False
    sizes = [sz for c, sz, _ in chars if not c.isspace()]
    return bool(sizes) and min(sizes) >= 44 or (bool(sizes) and all(s >= 44 for c, s, _ in chars
                                                                       if not c.isspace() and c not in '()'))


def build(paras, start, end, title):
    blocks = []
    n = [0]

    def emit(t, h):
        n[0] += 1
        blocks.append({'i': format(n[0], 'x'), 't': t, 'h': h})

    emit('h1', title)
    for chars in paras[start:end]:
        text = plain(chars).strip()
        if not text:
            continue
        if is_heading(chars):
            heading = text.strip('* ')
            if heading in (title, 'תפילת ' + title) or re.sub('^תפילת ', '', heading) == title:
                continue
            h = to_html([r for r in classify([c for c in chars if c[0] != '*'])])
            emit('h2', re.sub(r'</?b>', '', h))
            continue
        h = to_html(classify(chars))
        if h:
            emit('p', h)
    return blocks


def find_title(paras, title, after=0):
    for i in range(after, len(paras)):
        if plain(paras[i]).strip().strip('*').strip() == title:
            return i
    raise SystemExit('title not found: ' + title)


def main():
    paras = read_paragraphs(sys.argv[1])
    os.makedirs(OUT, exist_ok=True)
    pos = 0
    for key, title, first, until in PRAYERS:
        start = find_title(paras, first, pos)
        end = find_title(paras, until, start + 1)
        pos = end
        blocks = build(paras, start, end, title)
        doc = {
            'nusach': 'kavanot', 'prayer': key, 'title': title, 'srcShvaNa': False,
            'source': 'סידור עדות המזרח עם כוונות (מקובץ Word); נוסח התפילה – ספריא',
            'blocks': blocks,
        }
        k = 'kavanot/' + key
        js = 'window.SIDUR_DATA=window.SIDUR_DATA||{};window.SIDUR_DATA[%s]=%s;\n' % (
            json.dumps(k), json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
        path = os.path.join(OUT, 'kavanot_%s.js' % key)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(js)
        print(path, 'paragraphs %d-%d' % (start, end - 1), len(blocks), 'blocks', len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
