/* Siddur editor app: state, UI, editing, pagination, printing. */
(function () {
  'use strict';
  const { N, F, VOWEL_NAMES, parseCluster, serializeCluster } = window.Heb;
  const R = window.Render;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const NUSACHIM = { ashkenaz: 'נוסח אשכנז', sefard: 'נוסח ספרד', edot: 'עדות המזרח' };
  const PRAYERS = { shacharit: 'שחרית', mincha: 'מנחה', arvit: 'ערבית' };
  const FONTS = ['Noto Serif Hebrew', 'Frank Ruhl Libre', 'David Libre', 'Noto Sans Hebrew'];
  const PAGE_PRESETS = {
    A4: [210, 297], A5: [148, 210], A6: [105, 148], B5: [176, 250], B6: [125, 176],
    Letter: [216, 279], 'כיס 10×15': [100, 150], 'סידור 12×17': [120, 170], 'סידור 13×20': [130, 200],
  };
  const MARK_NAMES = {
    sn: 'שווא נע', sc: 'שווא נח', kk: 'קמץ קטן', kg: 'קמץ גדול (פתח גדול)', pg: 'פתח גנובה',
  };
  const MARK_SAMPLES = { sn: 'בְּ', sc: 'שְׁ', kk: 'חָ', kg: 'דָ', pg: 'חַ' };

  const DEFAULTS = {
    nusach: 'ashkenaz', prayer: 'shacharit',
    font: 'Noto Serif Hebrew', customFont: '', fontSize: 13, lineHeight: 1.65, align: 'justify',
    paraSpace: 0.35, indent: 0, color: '#111111',
    taamim: false, meteg: true,
    h1: { size: 1.9, color: '#7a1c1c', align: 'center', bold: true },
    h2: { size: 1.45, color: '#7a1c1c', align: 'center', bold: true },
    h3: { size: 1.15, color: '#333333', align: 'center', bold: true },
    instr: { size: 0.78, color: '#555555' },
    marks: {
      sn: { on: true, color: '#c62828', bold: true, scale: 1.25, dx: 0 },
      sc: { on: false, color: '#2e7d32', bold: false, scale: 1, dx: 0 },
      kk: { on: true, color: '#1565c0', bold: true, scale: 1.25, dx: 0 },
      kg: { on: false, color: '#6a1b9a', bold: true, scale: 1.25, dx: 0 },
      pg: { on: true, color: '#e65100', bold: false, scale: 1, dx: 0.18 },
    },
    rules: { autoShva: true, longVowel: 'auto', autoKatan: true, autoGenuva: true },
    page: { preset: 'A5', w: 148, h: 210, mt: 15, mb: 14, mi: 16, mo: 11, mirror: true, cols: 1, gap: 6 },
    header: { show: true, size: 8, content: 'both' },
    pnum: { show: true, hebrew: true, start: 1, size: 9 },
    zoom: 0.8, edit: true, spread: false, side: true, tab: 'toc',
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const deepMerge = (a, b) => {
    for (const k of Object.keys(b || {})) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
      else a[k] = b[k];
    }
    return a;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { status('שגיאה בשמירה: ' + e.message); return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // ------------------------------------------------------------------ state
  let S = deepMerge(clone(DEFAULTS), store.get('sidur.settings', {}));
  let doc = null;        // {key, title, srcShvaNa, base: Map, baseOrder: []}
  let edits = null;      // {blocks:{}, order:null|[]}
  let undoStack = [], redoStack = [];
  let sel = null;        // {id, r, o}
  let selBlock = null;   // block id selected (for inserting)
  let layout = null;     // result of paginate
  let renderVer = 1;
  const htmlCache = new Map();

  const editsKey = () => 'sidur.edits.' + doc.key;
  const saveSettings = () => store.set('sidur.settings', S);
  const saveEdits = () => {
    const empty = !Object.keys(edits.blocks).length && !edits.order;
    if (empty) store.del(editsKey()); else store.set(editsKey(), edits);
  };
  let statusTimer;
  function status(msg, keep) {
    const el = $('#status');
    el.textContent = msg;
    clearTimeout(statusTimer);
    if (!keep) statusTimer = setTimeout(() => { el.textContent = layout ? layout.pages + ' עמודים' : ''; }, 2500);
  }

  // ------------------------------------------------------------------ data
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('לא ניתן לטעון ' + src));
      document.head.appendChild(s);
    });
  }
  async function loadDoc(nusach, prayer) {
    const key = nusach + '/' + prayer;
    window.SIDUR_DATA = window.SIDUR_DATA || {};
    if (!window.SIDUR_DATA[key]) await loadScript('data/' + nusach + '_' + prayer + '.js');
    const d = window.SIDUR_DATA[key];
    const base = new Map();
    const baseOrder = [];
    for (const b of d.blocks) {
      base.set(b.i, { id: b.i, type: b.t, runs: R.htmlToRuns(b.h) });
      baseOrder.push(b.i);
    }
    doc = { key, title: d.title, srcShvaNa: d.srcShvaNa, source: d.source, base, baseOrder };
    edits = store.get('sidur.edits.' + key, null) || { blocks: {}, order: null };
    undoStack = []; redoStack = [];
    sel = null; selBlock = null;
    htmlCache.clear();
  }

  const getBlock = (id) => edits.blocks[id] || doc.base.get(id);
  const order = () => edits.order || doc.baseOrder;
  const allBlocks = () => order().map(getBlock).filter(Boolean);
  const headingLevel = (b) => (/^h(\d)$/.test(b.type) ? +b.type[1] : 0);

  /** Blocks to show, honouring hidden blocks and hidden sections. */
  function visibleBlocks() {
    const out = [];
    let hideLevel = 0;
    for (const b of allBlocks()) {
      const lvl = headingLevel(b);
      if (hideLevel) {
        if (lvl && lvl <= hideLevel) hideLevel = 0; else continue;
      }
      if (b.style && b.style.hide) { if (lvl) hideLevel = lvl; continue; }
      out.push(b);
    }
    return out;
  }

  // ------------------------------------------------------------------ undo
  function snapshot() {
    undoStack.push(JSON.stringify(edits));
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(edits));
    edits = JSON.parse(undoStack.pop());
    saveEdits(); htmlCache.clear(); refresh(); updateUndoButtons(); status('בוטל');
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(edits));
    edits = JSON.parse(redoStack.pop());
    saveEdits(); htmlCache.clear(); refresh(); updateUndoButtons();
  }
  function updateUndoButtons() {
    $('#btnUndo').disabled = !undoStack.length;
    $('#btnRedo').disabled = !redoStack.length;
  }

  function modifyBlock(id, fn) {
    snapshot();
    const b = clone(getBlock(id));
    fn(b);
    b.runs = R.mergeRuns(b.runs);
    edits.blocks[id] = b;
    saveEdits();
    refresh();
  }
  function ensureOrder() { if (!edits.order) edits.order = doc.baseOrder.slice(); }
  function insertBlock(refId, pos, block) {
    snapshot();
    ensureOrder();
    block.id = 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    block.added = true;
    edits.blocks[block.id] = block;
    let idx = refId ? edits.order.indexOf(refId) : -1;
    if (idx < 0) idx = pos === 'before' ? 0 : edits.order.length - 1;
    edits.order.splice(pos === 'before' ? idx : idx + 1, 0, block.id);
    saveEdits();
    selBlock = block.id;
    refresh({ scrollTo: block.id });
  }
  function deleteBlock(id) {
    snapshot();
    ensureOrder();
    edits.order = edits.order.filter((x) => x !== id);
    if (!doc.base.has(id)) delete edits.blocks[id];
    saveEdits(); closePop(); refresh();
  }
  function restoreBlock(id) {
    snapshot();
    delete edits.blocks[id];
    saveEdits(); htmlCache.delete(id); refresh();
  }

  // ------------------------------------------------------------------ css from settings
  function applyCss() {
    const p = S.page;
    const font = (S.customFont || S.font).replace(/'/g, '');
    const m = S.marks;
    let css = '';
    css += '.page{width:' + p.w + 'mm;height:' + p.h + 'mm;}';
    const sides = (inR, inL) => 'right:' + inR + 'mm;left:' + inL + 'mm;';
    const odd = sides(p.mi, p.mo);
    const even = p.mirror ? sides(p.mo, p.mi) : sides(p.mi, p.mo);
    css += '.page .body{top:' + p.mt + 'mm;bottom:' + p.mb + 'mm;}';
    css += '.page.odd .body,.page.odd .hdr,.page.odd .ftr{' + odd + '}';
    css += '.page.even .body,.page.even .hdr,.page.even .ftr{' + even + '}';
    css += '.page .hdr{top:' + (p.mt * 0.3) + 'mm;font-size:' + S.header.size + 'pt;font-family:\'' + font + '\',serif;line-height:1.5;' + (S.header.show ? '' : 'display:none;') + '}';
    css += '.page .ftr{bottom:' + (p.mb * 0.25) + 'mm;font-size:' + S.pnum.size + 'pt;font-family:\'' + font + '\',serif;line-height:1.5;' + (S.pnum.show ? '' : 'display:none;') + '}';
    css += '.body,.page-src{font-family:\'' + font + '\',\'Noto Serif Hebrew\',serif;font-size:' + S.fontSize + 'pt;line-height:' + S.lineHeight +
      ';text-align:' + S.align + ';color:' + S.color + ';' + (p.cols > 1 ? 'column-count:' + p.cols + ';column-gap:' + p.gap + 'mm;column-fill:auto;' : '') + '}';
    css += '.page-src{width:calc(' + p.w + 'mm - ' + (p.mi + p.mo) + 'mm);}';
    css += '.blk{margin:0 0 ' + S.paraSpace + 'em;}';
    css += '.blk.t-p{text-indent:' + S.indent + 'em;}';
    for (const h of ['h1', 'h2', 'h3']) {
      const st = S[h];
      const sel = h === 'h3' ? '.blk.t-h3,.blk.t-h4' : '.blk.t-' + h;
      css += sel + '{font-size:' + st.size + 'em;color:' + st.color + ';text-align:' + st.align + ';text-align-last:' + st.align +
        ';font-weight:' + (st.bold ? 700 : 400) + ';line-height:1.35;margin:' + (h === 'h1' ? 0.2 : 0.5) + 'em 0 0.3em;break-after:avoid;column-span:' + (h === 'h1' ? 'all' : 'none') + ';}';
    }
    css += '.r.s1{font-size:' + S.instr.size + 'em;color:' + S.instr.color + ';}';
    css += '.r.s2{font-size:' + S.instr.size * 0.9 + 'em;color:' + S.instr.color + ';}';
    css += '.r.g1{font-size:1.2em;}.r.g2{font-size:1.4em;}';
    css += '.blk.instr{text-align-last:auto;}';
    for (const k of Object.keys(m)) {
      const st = m[k];
      css += '.mk.' + k + '{color:' + st.color + ';' + (st.bold ? '-webkit-text-stroke:0.035em ' + st.color + ';' : '') +
        'transform:translateX(' + (st.dx || 0) + 'em) scale(' + (st.scale || 1) + ');transform-origin:50% 88%;}';
    }
    css += '.heb{font-family:\'' + font + '\',\'Noto Serif Hebrew\',serif;direction:rtl;}';
    $('#dyn').textContent = css;
    $('#pagecss').textContent = '@page{size:' + p.w + 'mm ' + p.h + 'mm;margin:0;}';
    $('#pages').style.zoom = S.zoom;
    $('#pages').style.setProperty('--pw', 'calc(' + p.w + 'mm + 14px)');
    $('#pages').classList.toggle('spread', !!S.spread);
    $('#pages').classList.toggle('editing', !!S.edit);
    $('#btnEdit').classList.toggle('on', !!S.edit);
    $('#btnSpread').classList.toggle('on', !!S.spread);
    $('#selZoom').value = String(S.zoom);
    if ($('#selZoom').value !== String(S.zoom)) {
      const o = document.createElement('option'); o.value = String(S.zoom); o.textContent = Math.round(S.zoom * 100) + '%';
      $('#selZoom').appendChild(o); $('#selZoom').value = String(S.zoom);
    }
  }

  // ------------------------------------------------------------------ render & paginate
  let refreshTimer = null;
  function refreshSoon(opts) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(opts), 250); }

  function usedFonts() {
    const fams = [S.customFont, S.font].filter(Boolean);
    for (const b of allBlocks()) if (b.style && b.style.font) fams.push(b.style.font);
    return Array.from(new Set(fams)).filter((f) => FONTS.includes(f));
  }
  const FONT_SPECS = (f) => ['400', '700'].map((w) => w + ' 16px "' + f + '"');
  function fontsReady() {
    if (!document.fonts || !document.fonts.check) return true;
    try { return usedFonts().every((f) => FONT_SPECS(f).every((sp) => document.fonts.check(sp, 'אבְּ'))); } catch (e) { return true; }
  }
  async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try { await Promise.all(usedFonts().flatMap((f) => FONT_SPECS(f).map((sp) => document.fonts.load(sp, 'אבְּ')))); } catch (e) { /* ignore */ }
  }

  // settings that change the layout (everything except view-only options)
  const layoutSig = () => {
    const x = Object.assign({}, S);
    for (const k of ['zoom', 'edit', 'spread', 'side', 'tab', 'nusach', 'prayer']) delete x[k];
    return JSON.stringify(x) + '|' + renderVer + '|' + doc.key;
  };
  let lastSig = '';
  let layoutFontsOk = false;

  function refresh(opts = {}) {
    if (!doc) return Promise.resolve();
    if (!opts.fontsOk && !fontsReady()) return ensureFonts().then(() => refresh(Object.assign({}, opts, { fontsOk: true })));
    const t0 = performance.now();
    applyCss();
    const viewer = $('#viewer');
    const anchorId = opts.scrollTo || null;
    const keepTop = viewer.scrollTop;
    const items = [];
    const changed = new Set();
    for (const b of visibleBlocks()) {
      let c = htmlCache.get(b.id);
      if (!c || c.blk !== b || c.ver !== renderVer) {
        c = { blk: b, ver: renderVer, html: R.blockHtml(b, S, doc) };
        htmlCache.set(b.id, c);
        changed.add(items.length);
      }
      items.push({ id: b.id, html: c.html });
    }
    const sig = layoutSig();
    let inc = null;
    if (layout && sig === lastSig && !opts.full) {
      // the changed range compared with the previous layout
      const old = layout.ids;
      let from = 0;
      while (from < items.length && from < old.length && items[from].id === old[from] && !changed.has(from)) from++;
      let eNew = items.length - 1, eOld = old.length - 1;
      while (eNew >= from && eOld >= from && items[eNew].id === old[eOld] && !changed.has(eNew)) { eNew--; eOld--; }
      if (from >= items.length && from >= old.length) inc = 'none';
      else inc = { prev: layout, from: Math.min(from, items.length - 1), to: Math.max(eNew, from) };
    }
    const t1 = performance.now();
    if (window.SIDUR_DEBUG && inc && inc !== 'none') console.log('inc', inc.from, inc.to, items.length);
    if (inc !== 'none') {
      layoutFontsOk = fontsReady();
      layout = window.Paginate.paginate($('#pages'), items, S, doc, inc);
      lastSig = sig;
    }
    if (window.SIDUR_DEBUG) console.log('render', Math.round(t1 - t0), 'paginate', Math.round(performance.now() - t1), inc ? 'inc' : 'full');
    viewer.scrollTop = opts.top ? 0 : keepTop;
    if (anchorId && layout.blockPage.has(anchorId) && !isBlockVisible(anchorId)) scrollToBlock(anchorId);
    $$('.selblk').forEach((e) => e.classList.remove('selblk'));
    if (selBlock) $$('.blk[data-id="' + selBlock + '"]').forEach((e) => e.classList.add('selblk'));
    if (sel) highlightSel();
    if (S.tab === 'toc') renderPanel();
    status(layout.pages + ' עמודים · ' + Math.round(performance.now() - t0) + 'ms', false);
    return Promise.resolve();
  }

  function isBlockVisible(id) {
    const el = $('.blk[data-id="' + id + '"]');
    if (!el) return false;
    const r = el.getBoundingClientRect(), v = $('#viewer').getBoundingClientRect();
    return r.bottom > v.top && r.top < v.bottom;
  }
  function scrollToBlock(id) {
    const el = $('.blk[data-id="' + id + '"]');
    if (!el) return;
    const v = $('#viewer');
    const r = el.getBoundingClientRect(), vr = v.getBoundingClientRect();
    v.scrollTop += r.top - vr.top - 80;
  }

  // ---- mapping between the screen and letters in the model
  const isLetterCh = window.Heb.isLetter;
  function textNodesOf(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }
  // letter clusters inside a segment element: [{node, start, end, el}] in logical order
  function segClusters(seg) {
    const out = [];
    for (const n of textNodesOf(seg)) {
      if (n.parentElement.closest('.mk')) continue;
      const t = n.data;
      for (let i = 0; i < t.length; i++) {
        if (!isLetterCh(t[i])) continue;
        let j = i + 1;
        while (j < t.length && !isLetterCh(t[j]) && window.Heb.isMark(t[j])) j++;
        const L = n.parentElement.closest('.L');
        out.push({ node: n, start: i, end: j, el: L && seg.contains(L) ? L : null });
      }
    }
    return out;
  }
  const rangeOf = (cl) => { const r = document.createRange(); r.setStart(cl.node, cl.start); r.setEnd(cl.node, cl.end); return r; };
  function hitCluster(seg, x, y) {
    let best = -1, bestD = Infinity;
    segClusters(seg).forEach((cl, i) => {
      for (const rc of rangeOf(cl).getClientRects()) {
        const dx = x < rc.left ? rc.left - x : x > rc.right ? x - rc.right : 0;
        const dy = y < rc.top ? rc.top - y : y > rc.bottom ? y - rc.bottom : 0;
        const d = dx * 3 + dy;
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  }
  // source offset (within run) of the n-th letter of a segment
  function segLetterOffset(block, r, segO, n) {
    const letters = window.Heb.tokenize(block.runs[r].t).filter((t) => t.k === 'L' && t.off >= segO);
    return letters[n] ? letters[n].off : null;
  }
  function findSeg(id, r, o) {
    let best = null, bestO = -1;
    for (const seg of $$('.blk[data-id="' + id + '"] .r[data-r="' + r + '"]')) {
      const so = +seg.dataset.o;
      if (so <= o && so > bestO) { best = seg; bestO = so; }
    }
    return best;
  }

  function clearSelMark() {
    for (const m of $$('.selmark')) {
      if (m.classList.contains('L')) { m.classList.remove('selmark', 'sel'); continue; }
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      m.remove();
      parent.normalize();
    }
  }
  function highlightSel() {
    clearSelMark();
    if (!sel) return null;
    const seg = findSeg(sel.id, sel.r, sel.o);
    if (!seg) return null;
    const b = getBlock(sel.id);
    const toks = window.Heb.tokenize(b.runs[sel.r].t).filter((t) => t.k === 'L' && t.off >= +seg.dataset.o);
    const n = toks.findIndex((t) => t.off === sel.o);
    const cl = segClusters(seg)[n];
    if (!cl) return null;
    if (cl.el) { cl.el.classList.add('sel', 'selmark'); return cl.el; }
    const span = document.createElement('span');
    span.className = 'sel selmark';
    rangeOf(cl).surroundContents(span);
    return span;
  }

  // ------------------------------------------------------------------ letter editing
  function currentCluster() {
    if (!sel) return null;
    const b = getBlock(sel.id);
    const it = R.analysisAt(b, sel.r, sel.o, S, doc);
    return it ? { block: b, item: it, c: it.c } : null;
  }

  function setCluster(mut) {
    const cur = currentCluster();
    if (!cur) return;
    const c = parseCluster(cur.item.s);
    mut(c);
    const ns = serializeCluster(c);
    if (ns === cur.item.s) return;
    modifyBlock(sel.id, (b) => {
      const run = b.runs[sel.r];
      run.t = run.t.slice(0, sel.o) + ns + run.t.slice(sel.o + cur.item.s.length);
    });
    openLetterPop();
  }

  function setLetterColor(color) {
    const cur = currentCluster();
    if (!cur) return;
    modifyBlock(sel.id, (b) => {
      const run = b.runs[sel.r];
      const len = cur.item.s.length;
      const before = Object.assign({}, run, { t: run.t.slice(0, sel.o) });
      const mid = Object.assign({}, run, { t: run.t.slice(sel.o, sel.o + len) });
      const after = Object.assign({}, run, { t: run.t.slice(sel.o + len) });
      if (color) mid.c = color; else delete mid.c;
      const parts = [before, mid, after].filter((x) => x.t);
      b.runs.splice(sel.r, 1, ...parts);
      // where does the letter end up once the runs are merged?
      const idx = sel.r + (before.t ? 1 : 0);
      const prefix = R.mergeRuns(b.runs.slice(0, idx));
      const last = prefix[prefix.length - 1];
      if (last && R.sameStyle(last, b.runs[idx])) { sel.r = prefix.length - 1; sel.o = last.t.length; }
      else { sel.r = prefix.length; sel.o = 0; }
    });
    openLetterPop();
  }

  function replaceLetter(ch) {
    if (!ch || !window.Heb.isLetter(ch)) return;
    setCluster((c) => { c.base = ch; if (ch !== 'ש') c.shin = ''; });
  }

  function navLetter(dir) {
    if (!sel) return;
    const vis = visibleBlocks();
    let bi = vis.findIndex((b) => b.id === sel.id);
    const lettersOf = (b) => {
      const out = [];
      b.runs.forEach((run, r) => { if (!run.br) for (const t of window.Heb.tokenize(run.t)) if (t.k === 'L') out.push({ r, o: t.off }); });
      return out;
    };
    let list = lettersOf(vis[bi]);
    let i = list.findIndex((x) => x.r === sel.r && x.o === sel.o) + dir;
    while (i < 0 || i >= list.length) {
      bi += dir;
      if (bi < 0 || bi >= vis.length) return;
      list = lettersOf(vis[bi]);
      i = dir > 0 ? 0 : list.length - 1;
    }
    selectLetter(vis[bi].id, list[i].r, list[i].o);
    const elNow = $('.selmark');
    if (elNow && !isElVisible(elNow)) { elNow.scrollIntoView({ block: 'center' }); positionPop(elNow); }
  }
  function isElVisible(e) {
    const r = e.getBoundingClientRect(), v = $('#viewer').getBoundingClientRect();
    return r.top > v.top && r.bottom < v.bottom;
  }

  function selectLetter(id, r, o) {
    sel = { id, r, o };
    selBlock = id;
    $$('.selblk').forEach((e) => e.classList.remove('selblk'));
    $$('.blk[data-id="' + id + '"]').forEach((e) => e.classList.add('selblk'));
    const el = highlightSel();
    openLetterPop(el);
  }

  /** click on the page: find the letter under the pointer */
  function letterFromEvent(e) {
    const seg = e.target.closest('.r[data-r]');
    if (!seg) return null;
    const blk = seg.closest('.blk');
    const n = hitCluster(seg, e.clientX, e.clientY);
    if (n < 0) return null;
    const o = segLetterOffset(getBlock(blk.dataset.id), +seg.dataset.r, +seg.dataset.o, n);
    if (o == null) return null;
    return { id: blk.dataset.id, r: +seg.dataset.r, o };
  }

  // ------------------------------------------------------------------ popover
  const pop = $('#pop');
  let popTab = 'letter';
  let popAnchor = null;

  function closePop() {
    pop.classList.remove('open');
    sel = null;
    clearSelMark();
  }

  function positionPop(el) {
    if (window.innerWidth <= 800) return;
    const r = (el || popAnchor || pop).getBoundingClientRect();
    const w = pop.offsetWidth || 360, h = pop.offsetHeight || 400;
    let left = r.left - w - 16;
    if (left < 8) left = r.right + 16;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    let top = Math.min(Math.max(58, r.top - 60), window.innerHeight - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = Math.max(58, top) + 'px';
  }

  function chip(label, on, fn, title) {
    const b = document.createElement('button');
    b.textContent = label;
    if (on) b.className = 'on';
    if (title) b.title = title;
    b.onclick = fn;
    return b;
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e[k] = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }

  function openLetterPop(anchorEl) {
    const cur = currentCluster();
    if (!cur) { closePop(); return; }
    if (anchorEl) popAnchor = anchorEl;
    pop.innerHTML = '';
    pop.append(el('button', { class: 'close', onclick: closePop, title: 'סגירה' }, '✕'));
    const tabs = el('div', { class: 'ptabs' },
      chip('אות וניקוד', popTab === 'letter', () => { popTab = 'letter'; openLetterPop(); }),
      chip('פסקה', popTab === 'para', () => { popTab = 'para'; openLetterPop(); }));
    pop.append(tabs);
    if (popTab === 'letter') buildLetterTab(cur); else buildParaTab(cur.block);
    pop.classList.add('open');
    const elNow = highlightSel();
    positionPop(elNow || anchorEl);
  }

  function buildLetterTab(cur) {
    const c = cur.c, an = cur.item.an || {};
    const { base, ov } = R.clusterHtml(c, an, S);
    // word context
    const words = wordContext(cur.block, sel.r, sel.o);
    const big = el('div', { class: 'big-letter heb', html: '<span class="L">' + base + ov + '</span>' });
    if (words) big.append(el('span', { class: 'ctx', html: words }));
    pop.append(big);

    pop.append(el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => navLetter(1), title: 'האות הבאה (←)' }, '→ הבאה'),
      el('button', { class: 'btn', onclick: () => navLetter(-1), title: 'האות הקודמת (→)' }, 'הקודמת ←')));

    pop.append(el('div', { class: 'plabel' }, 'תנועה'));
    const grid = el('div', { class: 'vgrid' });
    const vowels = ['', N.SHVA, N.HATAF_PATACH, N.HATAF_SEGOL, N.HATAF_KAMATZ, N.HIRIK, N.TSERE, N.SEGOL, N.PATACH,
      N.KAMATZ, N.KAMATZ_KATAN, N.HOLAM, N.KUBUTZ];
    if (c.base === 'ו') vowels.push(N.HOLAM_HASER);
    for (const v of vowels) {
      const b = el('button', { title: VOWEL_NAMES[v] },
        el('span', { class: 'g' }, c.base + (c.shin || '') + (c.dagesh ? N.DAGESH : '') + v),
        el('span', { class: 'n' }, VOWEL_NAMES[v]));
      if (c.vowel === v) b.classList.add('on');
      b.onclick = () => setCluster((x) => { x.vowel = v; x.flags.clear(); });
      grid.append(b);
    }
    pop.append(grid);

    // special states
    if (c.vowel === N.SHVA) {
      const auto = !c.flags.has(F.SHVA_NA) && !c.flags.has(F.SHVA_NACH);
      pop.append(el('div', { class: 'plabel' }, 'סוג השווא'));
      pop.append(el('div', { class: 'chips' },
        chip('אוטומטי (' + (an.shva === 'na' ? 'נע' : 'נח') + ')', auto, () => setCluster((x) => { x.flags.delete(F.SHVA_NA); x.flags.delete(F.SHVA_NACH); })),
        chip('שווא נע', !auto && c.flags.has(F.SHVA_NA), () => setCluster((x) => { x.flags.delete(F.SHVA_NACH); x.flags.add(F.SHVA_NA); })),
        chip('שווא נח', !auto && c.flags.has(F.SHVA_NACH), () => setCluster((x) => { x.flags.delete(F.SHVA_NA); x.flags.add(F.SHVA_NACH); }))));
    }
    if (c.vowel === N.KAMATZ || c.vowel === N.KAMATZ_KATAN) {
      const auto = c.vowel === N.KAMATZ && !c.flags.has(F.KAMATZ_GADOL);
      pop.append(el('div', { class: 'plabel' }, 'סוג הקמץ'));
      pop.append(el('div', { class: 'chips' },
        chip('אוטומטי (' + (an.kamatz === 'katan' ? 'קטן' : 'גדול') + ')', auto, () => setCluster((x) => { x.vowel = N.KAMATZ; x.flags.delete(F.KAMATZ_GADOL); })),
        chip('קמץ גדול', !auto && c.vowel === N.KAMATZ, () => setCluster((x) => { x.vowel = N.KAMATZ; x.flags.add(F.KAMATZ_GADOL); })),
        chip('קמץ קטן', c.vowel === N.KAMATZ_KATAN, () => setCluster((x) => { x.vowel = N.KAMATZ_KATAN; x.flags.delete(F.KAMATZ_GADOL); }))));
    }
    if (c.vowel === N.PATACH) {
      const auto = !c.flags.has(F.GENUVA) && !c.flags.has(F.NO_GENUVA);
      pop.append(el('div', { class: 'plabel' }, 'פתח גנובה'));
      pop.append(el('div', { class: 'chips' },
        chip('אוטומטי (' + (an.genuva ? 'כן' : 'לא') + ')', auto, () => setCluster((x) => { x.flags.delete(F.GENUVA); x.flags.delete(F.NO_GENUVA); })),
        chip('פתח גנובה', c.flags.has(F.GENUVA), () => setCluster((x) => { x.flags.delete(F.NO_GENUVA); x.flags.add(F.GENUVA); })),
        chip('פתח רגיל', c.flags.has(F.NO_GENUVA), () => setCluster((x) => { x.flags.delete(F.GENUVA); x.flags.add(F.NO_GENUVA); }))));
    }

    pop.append(el('div', { class: 'plabel' }, 'סימנים נוספים'));
    const chips = el('div', { class: 'chips' },
      chip('דגש / מפיק', c.dagesh, () => setCluster((x) => { x.dagesh = !x.dagesh; })),
      chip('מתג', c.meteg, () => setCluster((x) => { x.meteg = !x.meteg; })),
      chip('רפה', c.rafe, () => setCluster((x) => { x.rafe = !x.rafe; })));
    if (c.base === 'ש') {
      chips.append(chip('שׁ ימנית', c.shin === N.SHIN_DOT, () => setCluster((x) => { x.shin = N.SHIN_DOT; })));
      chips.append(chip('שׂ שמאלית', c.shin === N.SIN_DOT, () => setCluster((x) => { x.shin = N.SIN_DOT; })));
    }
    if (c.taamim) chips.append(chip('הסר טעמים מהאות', false, () => setCluster((x) => { x.taamim = ''; })));
    pop.append(chips);

    pop.append(el('div', { class: 'plabel' }, 'צבע האות והחלפת אות'));
    const run = cur.block.runs[sel.r];
    const col = el('input', { type: 'color', value: run.c || '#c62828' });
    const rep = el('input', { type: 'text', maxlength: '1', placeholder: 'אות', style: 'width:50px' });
    pop.append(el('div', { class: 'row' },
      col,
      el('button', { class: 'btn', onclick: () => setLetterColor(col.value) }, 'צבע אות'),
      el('button', { class: 'btn', onclick: () => setLetterColor(null), disabled: run.c ? null : 'disabled' }, 'הסר צבע'),
      rep,
      el('button', { class: 'btn', onclick: () => replaceLetter(rep.value.trim()) }, 'החלף')));
    if (!S.edit) pop.append(el('div', { class: 'hint' }, 'מצב עריכה כבוי.'));
  }

  function wordContext(block, r, o) {
    const items = window.Heb.tokenize(block.runs[r].t || '');
    let i = items.findIndex((t) => t.off === o);
    if (i < 0) return '';
    let a = i, b = i;
    while (a > 0 && items[a - 1].k !== 'S') a--;
    while (b < items.length - 1 && items[b + 1].k !== 'S') b++;
    return items.slice(a, b + 1).map((t, j) => {
      const s = R.esc(t.s.replace(window.Heb.FLAG_RE, ''));
      return a + j === i ? '<u>' + s + '</u>' : s;
    }).join('');
  }

  function buildParaTab(block) {
    const id = block.id;
    const isBase = doc.base.has(id);
    const edited = isBase && !!edits.blocks[id];
    const preview = R.plainText(block).slice(0, 90);
    pop.append(el('div', { class: 'hint', style: 'font-family:Noto Serif Hebrew,serif;font-size:15px;margin-bottom:8px' }, preview + (preview.length >= 90 ? '…' : '')));
    pop.append(el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => openTextDialog('edit', id) }, '✎ עריכת טקסט ועיצוב'),
      el('button', { class: 'btn', onclick: () => openTextDialog('new', id, 'after') }, '＋ הוספת טקסט אחרי'),
      el('button', { class: 'btn', onclick: () => openTextDialog('new', id, 'before') }, '＋ לפני'),
      el('button', { class: 'btn', onclick: () => { modifyBlock(id, (b) => { b.style = Object.assign({}, b.style, { hide: true }); }); closePop(); } }, headingLevel(block) ? 'הסתר את כל הקטע' : 'הסתר פסקה'),
      el('button', { class: 'btn', onclick: () => moveBlock(id, -1) }, '▲ הזז למעלה'),
      el('button', { class: 'btn', onclick: () => moveBlock(id, 1) }, '▼ הזז למטה'),
      el('button', { class: 'btn', onclick: () => { if (confirm('למחוק את הפסקה?')) deleteBlock(id); } }, '🗑 מחיקה'),
      edited ? el('button', { class: 'btn', onclick: () => { restoreBlock(id); openLetterPopOrClose(); } }, '↺ שחזור טקסט המקור') : null));
    pop.append(el('div', { class: 'plabel' }, 'עיצוב מהיר לפסקה'));
    const st = block.style || {};
    const color = el('input', { type: 'color', value: st.color || '#111111' });
    pop.append(el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => modifyBlock(id, (b) => { b.style = Object.assign({}, b.style, { size: Math.round((b.style && b.style.size || 100) * 1.1) }); }) }, 'א+ הגדלה'),
      el('button', { class: 'btn', onclick: () => modifyBlock(id, (b) => { b.style = Object.assign({}, b.style, { size: Math.round((b.style && b.style.size || 100) / 1.1) }); }) }, 'א- הקטנה'),
      color,
      el('button', { class: 'btn', onclick: () => modifyBlock(id, (b) => { b.style = Object.assign({}, b.style, { color: color.value }); }) }, 'צבע'),
      el('button', { class: 'btn', onclick: () => modifyBlock(id, (b) => { const s = Object.assign({}, b.style); delete s.size; delete s.color; delete s.bold; delete s.align; delete s.font; delete s.bg; b.style = s; }) }, 'ברירת מחדל')));
  }
  function openLetterPopOrClose() { if (currentCluster()) openLetterPop(); else closePop(); }

  function moveBlock(id, dir) {
    snapshot();
    ensureOrder();
    const i = edits.order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= edits.order.length) return;
    [edits.order[i], edits.order[j]] = [edits.order[j], edits.order[i]];
    saveEdits(); refresh({ scrollTo: id });
  }

  // ------------------------------------------------------------------ text dialog
  const dlg = $('#dlgText');
  let dlgState = null;
  const NIKUD_KEYS = [N.SHVA, N.HATAF_PATACH, N.HATAF_SEGOL, N.HATAF_KAMATZ, N.HIRIK, N.TSERE, N.SEGOL, N.PATACH, N.KAMATZ,
    N.KAMATZ_KATAN, N.HOLAM, N.KUBUTZ, N.DAGESH, N.SHIN_DOT, N.SIN_DOT, N.METEG, N.MAQAF, F.SHVA_NA];

  function buildNikudKb() {
    const kb = $('#nikudKb');
    kb.innerHTML = '';
    for (const k of NIKUD_KEYS) {
      const label = k === N.MAQAF ? '־' : k === F.SHVA_NA ? 'נע' : 'ב' + k;
      const name = k === F.SHVA_NA ? 'סימון שווא נע (אחרי השווא)' : k === N.MAQAF ? 'מקף' : (VOWEL_NAMES[k] ||
        { [N.DAGESH]: 'דגש', [N.SHIN_DOT]: 'שין ימנית', [N.SIN_DOT]: 'שין שמאלית', [N.METEG]: 'מתג' }[k] || '');
      const b = el('button', { title: name, type: 'button' }, label);
      if (k === F.SHVA_NA) b.style.fontSize = '13px';
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => { $('#editor').focus(); document.execCommand('insertText', false, k); };
      kb.append(b);
    }
  }

  const STYLE_FIELDS = [
    { k: 'font', label: 'גופן', type: 'select', options: [['', 'ברירת מחדל']].concat(FONTS.map((f) => [f, f])) },
    { k: 'size', label: 'גודל (%)', type: 'number', min: 30, max: 400, step: 5, ph: '100' },
    { k: 'color', label: 'צבע', type: 'color' },
    { k: 'bg', label: 'רקע', type: 'color' },
    { k: 'align', label: 'יישור', type: 'select', options: [['', 'ברירת מחדל'], ['justify', 'מיושר לשני הצדדים'], ['right', 'ימין'], ['center', 'מרכז'], ['left', 'שמאל']] },
    { k: 'bold', label: 'מודגש', type: 'checkbox' },
    { k: 'mt', label: 'רווח לפני (em)', type: 'number', min: 0, max: 10, step: 0.1, ph: '0' },
    { k: 'mb', label: 'רווח אחרי (em)', type: 'number', min: 0, max: 10, step: 0.1, ph: '' },
    { k: 'lh', label: 'מרווח שורות', type: 'number', min: 0.8, max: 4, step: 0.05, ph: '' },
    { k: 'indent', label: 'הזחה (em)', type: 'number', min: 0, max: 10, step: 0.5, ph: '0' },
  ];

  function buildStyleForm(st) {
    const box = $('#dlgStyle');
    box.innerHTML = '';
    for (const f of STYLE_FIELDS) {
      let input;
      if (f.type === 'select') {
        input = el('select', {});
        for (const [v, l] of f.options) input.append(el('option', { value: v }, l));
        input.value = st[f.k] || '';
      } else if (f.type === 'checkbox') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!st[f.k];
      } else if (f.type === 'color') {
        input = el('input', { type: 'color', value: st[f.k] || (f.k === 'bg' ? '#fff8e1' : '#111111') });
        const use = el('input', { type: 'checkbox', title: 'השתמש בצבע' });
        use.checked = !!st[f.k];
        use.dataset.k = f.k + '_use';
        input.oninput = () => { use.checked = true; };
        input.dataset.k = f.k;
        box.append(el('div', { class: 'row' }, el('label', {}, f.label), use, input));
        continue;
      } else {
        input = el('input', { type: 'number', min: f.min, max: f.max, step: f.step, placeholder: f.ph });
        input.value = st[f.k] != null ? st[f.k] : '';
      }
      input.dataset.k = f.k;
      box.append(el('div', { class: 'row' }, el('label', {}, f.label), input));
    }
  }
  function readStyleForm(prev) {
    const st = Object.assign({}, prev);
    for (const f of STYLE_FIELDS) {
      const input = $('#dlgStyle [data-k="' + f.k + '"]');
      if (f.type === 'checkbox') { if (input.checked) st[f.k] = true; else delete st[f.k]; }
      else if (f.type === 'color') {
        const use = $('#dlgStyle [data-k="' + f.k + '_use"]');
        if (use.checked) st[f.k] = input.value; else delete st[f.k];
      } else if (f.type === 'number') {
        if (input.value === '') delete st[f.k]; else st[f.k] = +input.value;
      } else { if (input.value) st[f.k] = input.value; else delete st[f.k]; }
    }
    return st;
  }

  function openTextDialog(mode, refId, pos) {
    const editor = $('#editor');
    dlgState = { mode, refId, pos: pos || 'after' };
    $('#dlgTitle').textContent = mode === 'edit' ? 'עריכת טקסט ועיצוב' : 'הוספת טקסט';
    $('#dlgPos').value = dlgState.pos;
    $('#dlgPos').parentElement.querySelectorAll('label')[1].style.display = mode === 'edit' ? 'none' : '';
    $('#dlgPos').style.display = mode === 'edit' ? 'none' : '';
    let st = {};
    if (mode === 'edit') {
      const b = getBlock(refId);
      editor.innerHTML = R.runsToEditHtml(b.runs);
      const allSmall = b.type === 'p' && b.runs.length && b.runs.every((r) => r.br || r.s);
      $('#dlgType').value = allSmall ? 'instr' : (b.type === 'h4' ? 'h3' : b.type);
      st = b.style || {};
    } else {
      editor.innerHTML = '';
      $('#dlgType').value = 'p';
      st = { color: '#1a237e' };
    }
    buildStyleForm(st);
    dlgState.prevStyle = st;
    dlg.showModal();
    setTimeout(() => editor.focus(), 30);
  }

  function saveTextDialog() {
    const editor = $('#editor');
    let runs = R.editDomToRuns(editor);
    const typ = $('#dlgType').value;
    const style = readStyleForm(dlgState.prevStyle || {});
    if (typ === 'instr') runs = runs.map((r) => (r.br ? r : Object.assign({}, r, { s: r.s || 1 })));
    const type = typ === 'instr' ? 'p' : typ;
    if (!runs.length && dlgState.mode === 'new') { dlg.close(); return; }
    if (dlgState.mode === 'edit') {
      const wasInstr = getBlock(dlgState.refId).runs.every((r) => r.br || r.s);
      if (typ !== 'instr' && wasInstr) runs = runs.map((r) => { const x = Object.assign({}, r); delete x.s; return x; });
      modifyBlock(dlgState.refId, (b) => { b.runs = runs; b.type = type; b.style = style; });
    } else {
      insertBlock(dlgState.refId, $('#dlgPos').value, { type, runs, style });
    }
    dlg.close();
    closePop();
  }

  function wrapSelection(tag) {
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    if (!$('#editor').contains(r.commonAncestorContainer)) return;
    const w = document.createElement(tag);
    w.appendChild(r.extractContents());
    r.insertNode(w);
  }

  function setupDialog() {
    buildNikudKb();
    $$('.ed-toolbar button').forEach((b) => {
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => {
        const cmd = b.dataset.cmd;
        document.execCommand('styleWithCSS', false, false);
        if (cmd === 'bold') document.execCommand('bold');
        else if (cmd === 'small') wrapSelection('small');
        else if (cmd === 'big') wrapSelection('big');
        else if (cmd === 'color') { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, $('#edColor').value); }
        else if (cmd === 'clear') {
          const s = window.getSelection();
          if (s.rangeCount && !s.isCollapsed) {
            const t = s.toString();
            document.execCommand('insertText', false, t);
          }
        } else if (cmd === 'nikud') $('#nikudKb').hidden = !$('#nikudKb').hidden;
      };
    });
    $('#editor').addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, t);
    });
    $('#dlgOk').onclick = saveTextDialog;
    $('#dlgCancel').onclick = () => dlg.close();
  }

  // ------------------------------------------------------------------ side panel
  function setPath(path, value) {
    const ks = path.split('.');
    let o = S;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = value;
  }
  function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }

  /** control row: kind: 'css' (style only) | 'layout' (repaginate) | 'render' (re-render text) */
  function ctl(label, path, type, kind, extra = {}) {
    const v = getPath(path);
    let input;
    if (type === 'select') {
      input = el('select', {});
      for (const [val, l] of extra.options) input.append(el('option', { value: val }, l));
      input.value = String(v);
    } else if (type === 'checkbox') {
      input = el('input', { type: 'checkbox' });
      input.checked = !!v;
    } else if (type === 'range') {
      input = el('input', { type: 'range', min: extra.min, max: extra.max, step: extra.step });
      input.value = v;
    } else {
      input = el('input', { type, min: extra.min, max: extra.max, step: extra.step });
      input.value = v;
    }
    const valLbl = type === 'range' ? el('span', { class: 'val' }, String(v)) : null;
    const handler = () => {
      let nv = type === 'checkbox' ? input.checked : input.value;
      if (type === 'number' || type === 'range') { nv = parseFloat(nv); if (isNaN(nv)) return; }
      if (type === 'select' && extra.numeric) nv = parseFloat(nv);
      setPath(path, nv);
      if (valLbl) valLbl.textContent = String(nv);
      if (extra.after) extra.after(nv);
      saveSettings();
      if (kind === 'render') { renderVer++; refreshSoon(); }
      else if (kind === 'layout') refreshSoon();
      else applyCss();
    };
    input.addEventListener(type === 'range' || type === 'color' || type === 'text' ? 'input' : 'change', handler);
    if (type === 'number') input.addEventListener('input', handler);
    return el('div', { class: 'row' }, el('label', {}, label), input, valLbl);
  }
  const sec = (title, ...kids) => el('div', { class: 'sec' }, el('h4', {}, title), ...kids);

  function renderPanel() {
    const p = $('#panel');
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
    const scroll = p.scrollTop;
    p.innerHTML = '';
    const tab = S.tab;
    if (tab === 'toc') panelToc(p);
    else if (tab === 'text') panelText(p);
    else if (tab === 'nikud') panelNikud(p);
    else if (tab === 'page') panelPage(p);
    else panelFile(p);
    p.scrollTop = scroll;
  }

  function panelToc(p) {
    const ul = el('ul', { class: 'toc' });
    let hideLevel = 0;
    const hiddenParas = [];
    for (const b of allBlocks()) {
      const lvl = headingLevel(b);
      const hiddenHere = b.style && b.style.hide;
      if (!lvl) { if (hiddenHere) hiddenParas.push(b); continue; }
      const parentHidden = hideLevel && lvl > hideLevel;
      if (hideLevel && lvl <= hideLevel) hideLevel = 0;
      if (hiddenHere && !hideLevel) hideLevel = lvl;
      const cb = el('input', { type: 'checkbox', title: 'כלול בהדפסה' });
      cb.checked = !hiddenHere;
      cb.disabled = !!parentHidden;
      cb.onchange = () => modifyBlock(b.id, (x) => { x.style = Object.assign({}, x.style); if (cb.checked) delete x.style.hide; else x.style.hide = true; });
      const pg = layout && layout.blockPage.has(b.id) ? layout.blockPage.get(b.id) + (S.pnum.start || 1) : null;
      const a = el('a', { onclick: () => scrollToBlock(b.id) }, R.plainText(b));
      const li = el('li', { class: 'l' + lvl + (hiddenHere || parentHidden ? ' off' : '') }, cb, a,
        el('span', { class: 'pg' }, pg != null ? (S.pnum.hebrew ? window.Heb.gematria(pg) : String(pg)) : ''));
      ul.append(li);
    }
    p.append(sec('תוכן העניינים', el('div', { class: 'hint' }, 'סמנו/בטלו קטעים כדי לכלול או להשמיט אותם מהסידור המודפס. לחיצה על שם קטע מעבירה אליו.'), ul));
    if (hiddenParas.length) {
      const box = sec('פסקאות מוסתרות (' + hiddenParas.length + ')');
      for (const b of hiddenParas) {
        box.append(el('div', { class: 'row' }, el('span', { style: 'flex:1;font-size:12px' }, R.plainText(b).slice(0, 50) + '…'),
          el('button', { class: 'btn', onclick: () => modifyBlock(b.id, (x) => { x.style = Object.assign({}, x.style); delete x.style.hide; }) }, 'הצג')));
      }
      p.append(box);
    }
    p.append(el('div', { class: 'hint' }, 'מקור הטקסט: ' + doc.source + ' (ספריא, sefaria.org).'));
  }

  function panelText(p) {
    const fontOpts = FONTS.map((f) => [f, f]);
    p.append(sec('גופן וגודל',
      ctl('גופן', 'font', 'select', 'layout', { options: fontOpts }),
      ctl('גופן מותקן אחר (שם)', 'customFont', 'text', 'layout'),
      el('div', { class: 'hint' }, 'אפשר לכתוב שם של גופן שמותקן במחשב, למשל: Taamey Frank CLM, SBL Hebrew, David.'),
      ctl('גודל גופן (pt)', 'fontSize', 'number', 'layout', { min: 6, max: 40, step: 0.5 }),
      ctl('מרווח בין השורות', 'lineHeight', 'range', 'layout', { min: 1, max: 3, step: 0.05 }),
      ctl('רווח בין פסקאות (em)', 'paraSpace', 'range', 'layout', { min: 0, max: 2, step: 0.05 }),
      ctl('הזחת שורה ראשונה (em)', 'indent', 'number', 'layout', { min: 0, max: 5, step: 0.5 }),
      ctl('יישור', 'align', 'select', 'layout', { options: [['justify', 'מיושר לשני הצדדים'], ['right', 'ימין'], ['center', 'מרכז']] }),
      ctl('צבע טקסט', 'color', 'color', 'css')));
    const hsec = (name, key) => sec(name,
      ctl('גודל (יחסי)', key + '.size', 'range', 'layout', { min: 0.8, max: 3, step: 0.05 }),
      ctl('צבע', key + '.color', 'color', 'css'),
      ctl('יישור', key + '.align', 'select', 'layout', { options: [['center', 'מרכז'], ['right', 'ימין'], ['justify', 'מיושר']] }),
      ctl('מודגש', key + '.bold', 'checkbox', 'layout'));
    p.append(hsec('כותרת ראשית', 'h1'), hsec('כותרת', 'h2'), hsec('כותרת משנה', 'h3'));
    p.append(sec('הוראות והערות (טקסט קטן)',
      ctl('גודל (יחסי)', 'instr.size', 'range', 'layout', { min: 0.5, max: 1.2, step: 0.02 }),
      ctl('צבע', 'instr.color', 'color', 'css')));
    p.append(sec('טעמים ומתג',
      ctl('הצגת טעמי המקרא', 'taamim', 'checkbox', 'render'),
      ctl('הצגת מתג / געיה', 'meteg', 'checkbox', 'render')));
  }

  function panelNikud(p) {
    const box = sec('הדגשת ניקוד מיוחד',
      el('div', { class: 'hint' }, 'לכל סוג אפשר לבחור צבע, הדגשה, הגדלה והזזה. הסימון מוצג גם בהדפסה.'));
    for (const k of Object.keys(MARK_NAMES)) {
      const m = S.marks[k];
      const sample = el('div', { class: 'sample heb' });
      const upd = () => {
        const c = parseCluster(MARK_SAMPLES[k]);
        const an = { shva: k === 'sn' ? 'na' : k === 'sc' ? 'nach' : null, kamatz: k === 'kk' ? 'katan' : k === 'kg' ? 'gadol' : null, genuva: k === 'pg' };
        const { base, ov } = R.clusterHtml(c, an, S);
        sample.innerHTML = '<span class="L">' + base + ov + '</span>';
      };
      upd();
      const inner = el('div', { style: 'border-top:1px solid #eee;padding-top:6px;margin-top:6px' },
        el('div', { class: 'markrow' }, el('b', {}, MARK_NAMES[k]), sample),
        ctl('הפעלה', 'marks.' + k + '.on', 'checkbox', 'render', { after: () => { renderVer++; upd(); } }),
        ctl('צבע', 'marks.' + k + '.color', 'color', 'css'),
        ctl('הדגשה (עובי)', 'marks.' + k + '.bold', 'checkbox', 'css'),
        ctl('הגדלה', 'marks.' + k + '.scale', 'range', 'css', { min: 0.8, max: 2, step: 0.05 }),
        ctl('הזזה אופקית', 'marks.' + k + '.dx', 'range', 'css', { min: -0.4, max: 0.4, step: 0.02 }));
      box.append(inner);
    }
    p.append(box);
    p.append(sec('זיהוי אוטומטי',
      el('div', { class: 'hint' }, 'הזיהוי האוטומטי מבוסס על סימוני המקור (באשכנז וספרד) ועל כללי הדקדוק: שווא בתחילת מילה, שני שוואים, אות דגושה, שתי אותיות זהות ועוד. כל אות אפשר לתקן ידנית בלחיצה עליה.'),
      ctl('זיהוי שווא נע אוטומטי', 'rules.autoShva', 'checkbox', 'render'),
      ctl('שווא אחרי תנועה גדולה = נע', 'rules.longVowel', 'select', 'render', { options: [['auto', 'אוטומטי לפי הנוסח'], ['on', 'כן'], ['off', 'לא']] }),
      ctl('זיהוי קמץ קטן אוטומטי', 'rules.autoKatan', 'checkbox', 'render'),
      ctl('זיהוי פתח גנובה אוטומטי', 'rules.autoGenuva', 'checkbox', 'render')));
  }

  function panelPage(p) {
    const presetOpts = Object.keys(PAGE_PRESETS).map((k) => [k, k + ' (' + PAGE_PRESETS[k][0] + '×' + PAGE_PRESETS[k][1] + ' מ״מ)']).concat([['custom', 'מותאם אישית']]);
    p.append(sec('גודל הדף',
      ctl('גודל', 'page.preset', 'select', 'layout', {
        options: presetOpts,
        after: (v) => { if (PAGE_PRESETS[v]) { S.page.w = PAGE_PRESETS[v][0]; S.page.h = PAGE_PRESETS[v][1]; } setTimeout(renderPanel, 0); },
      }),
      ctl('רוחב (מ״מ)', 'page.w', 'number', 'layout', { min: 50, max: 500, step: 1, after: () => { S.page.preset = 'custom'; } }),
      ctl('גובה (מ״מ)', 'page.h', 'number', 'layout', { min: 50, max: 700, step: 1, after: () => { S.page.preset = 'custom'; } }),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { const { w, h } = S.page; S.page.w = h; S.page.h = w; S.page.preset = 'custom'; saveSettings(); renderPanel(); refresh(); } }, '⟲ לרוחב / לאורך'))));
    p.append(sec('שוליים (מ״מ)',
      ctl('עליון', 'page.mt', 'number', 'layout', { min: 0, max: 60, step: 0.5 }),
      ctl('תחתון', 'page.mb', 'number', 'layout', { min: 0, max: 60, step: 0.5 }),
      ctl('פנימי (צד הכריכה)', 'page.mi', 'number', 'layout', { min: 0, max: 60, step: 0.5 }),
      ctl('חיצוני', 'page.mo', 'number', 'layout', { min: 0, max: 60, step: 0.5 }),
      ctl('שוליים מתחלפים (ספר)', 'page.mirror', 'checkbox', 'layout')));
    p.append(sec('טורים',
      ctl('מספר טורים', 'page.cols', 'select', 'layout', { options: [['1', 'טור אחד'], ['2', 'שני טורים']], numeric: true }),
      ctl('רווח בין טורים (מ״מ)', 'page.gap', 'number', 'layout', { min: 0, max: 30, step: 0.5 })));
    p.append(sec('כותרת עליונה ומספרי עמודים',
      ctl('כותרת עליונה', 'header.show', 'checkbox', 'layout'),
      ctl('תוכן הכותרת', 'header.content', 'select', 'layout', { options: [['both', 'שם התפילה / שם הקטע לסירוגין'], ['section', 'שם הקטע']] }),
      ctl('גודל כותרת (pt)', 'header.size', 'number', 'layout', { min: 5, max: 20, step: 0.5 }),
      ctl('מספרי עמודים', 'pnum.show', 'checkbox', 'layout'),
      ctl('מספור באותיות (א, ב, ג)', 'pnum.hebrew', 'checkbox', 'layout'),
      ctl('מספר עמוד ראשון', 'pnum.start', 'number', 'layout', { min: 1, max: 9999, step: 1 }),
      ctl('גודל מספר (pt)', 'pnum.size', 'number', 'layout', { min: 5, max: 20, step: 0.5 })));
    p.append(sec('הדפסה',
      el('div', { class: 'hint' }, 'בחלון ההדפסה: בחרו "שמירה כ-PDF" או מדפסת, השוליים: "ללא", קנה מידה 100%, והפעילו "גרפיקת רקע" כדי שהצבעים יודפסו. גודל הנייר נקבע אוטומטית לפי הגודל שנבחר כאן.'),
      el('button', { class: 'btn primary', onclick: doPrint }, '🖶 הדפסה / שמירה כ-PDF')));
  }

  function panelFile(p) {
    p.append(sec('שמירה וגיבוי',
      el('div', { class: 'hint' }, 'כל השינויים נשמרים אוטומטית בדפדפן הזה. כדי להעביר למחשב אחר או לגבות – ייצאו קובץ.'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: exportAll }, '⭳ ייצוא שינויים והגדרות'),
        el('button', { class: 'btn', onclick: () => $('#fileImport').click() }, '⭱ ייבוא מקובץ'))));
    const n = Object.keys(edits.blocks).length;
    p.append(sec('איפוס',
      el('div', { class: 'hint' }, 'בתפילה הנוכחית יש ' + n + ' פסקאות ששונו או נוספו.'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => { if (confirm('למחוק את כל השינויים בתפילה הזו (' + doc.title + ')?')) { snapshot(); edits = { blocks: {}, order: null }; saveEdits(); htmlCache.clear(); refresh(); renderPanel(); } } }, 'איפוס שינויי הטקסט בתפילה זו'),
        el('button', { class: 'btn', onclick: () => { if (confirm('לאפס את כל הגדרות העיצוב והדף?')) { const keep = { nusach: S.nusach, prayer: S.prayer }; S = deepMerge(clone(DEFAULTS), keep); saveSettings(); renderVer++; refresh(); renderPanel(); } } }, 'איפוס הגדרות עיצוב'))));
    p.append(sec('עזרה',
      el('div', { class: 'hint', html:
        '• <b>מצב עריכה</b>: לחיצה על אות פותחת חלון לשינוי הניקוד, סוג השווא (נע/נח), קמץ גדול/קטן, פתח גנובה, דגש, צבע ועוד. ' +
        'מעבר בין אותיות: חצים במקלדת.<br>• לשונית <b>פסקה</b> בחלון: עריכת טקסט, הוספת טקסט לפני/אחרי, הסתרה, מחיקה והזזה.<br>' +
        '• <b>הוספת טקסט</b> בסרגל העליון: מוסיף טקסט אחרי הפסקה שנבחרה, עם בחירת גופן, גודל, צבע ויישור.<br>' +
        '• התצוגה תמיד מחולקת לעמודים בגודל שנבחר בלשונית <b>דף</b> – כך בדיוק זה יודפס.<br>• ביטול: Ctrl+Z, חזרה: Ctrl+Y.' })));
  }

  function exportAll() {
    const all = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('sidur.edits.')) all[k.slice(12)] = JSON.parse(localStorage.getItem(k));
      }
    } catch (e) { /* storage unavailable */ }
    all[doc.key] = edits;
    const data = { app: 'sidur', version: 1, settings: S, edits: all };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sidur-backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importFile(file) {
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const data = JSON.parse(fr.result);
        if (data.app !== 'sidur') throw new Error('קובץ לא מתאים');
        if (data.settings) { S = deepMerge(clone(DEFAULTS), data.settings); saveSettings(); }
        for (const k of Object.keys(data.edits || {})) store.set('sidur.edits.' + k, data.edits[k]);
        await switchDoc(S.nusach, S.prayer);
        status('הייבוא הושלם');
      } catch (e) { alert('שגיאה בייבוא: ' + e.message); }
    };
    fr.readAsText(file);
  }

  // ------------------------------------------------------------------ print
  async function doPrint() {
    closePop();
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const z = S.zoom;
    $('#pages').style.zoom = 1;
    // repaginate at zoom 1 to be exact
    await refresh();
    setTimeout(() => {
      window.print();
      $('#pages').style.zoom = z;
    }, 100);
  }

  // ------------------------------------------------------------------ switching docs
  async function switchDoc(nusach, prayer) {
    $('#loading').classList.remove('hide');
    try {
      S.nusach = nusach; S.prayer = prayer; saveSettings();
      await loadDoc(nusach, prayer);
      closePop();
      $('#selNusach').value = nusach;
      $$('#segPrayer button').forEach((b) => b.classList.toggle('on', b.dataset.p === prayer));
      document.title = doc.title + ' – ' + NUSACHIM[nusach];
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await refresh({ top: true, full: true });
      renderPanel();
      updateUndoButtons();
    } catch (e) {
      alert(e.message);
    } finally {
      $('#loading').classList.add('hide');
    }
  }

  // ------------------------------------------------------------------ init
  function init() {
    const sn = $('#selNusach');
    for (const k of Object.keys(NUSACHIM)) sn.append(el('option', { value: k }, NUSACHIM[k]));
    sn.onchange = () => switchDoc(sn.value, S.prayer);
    $$('#segPrayer button').forEach((b) => { b.onclick = () => switchDoc(S.nusach, b.dataset.p); });
    $$('#tabs button').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; saveSettings(); renderPanel(); }; });
    $('#btnSide').onclick = () => { S.side = !S.side; saveSettings(); $('#side').classList.toggle('closed', !S.side); };
    $('#side').classList.toggle('closed', !S.side || (window.innerWidth <= 800 && !store.get('sidur.sideMobile', false)));
    if (window.innerWidth <= 800) $('#btnSide').onclick = () => $('#side').classList.toggle('closed');
    $('#btnEdit').onclick = () => { S.edit = !S.edit; saveSettings(); applyCss(); if (!S.edit) closePop(); };
    $('#btnAdd').onclick = () => openTextDialog('new', selBlock || (sel && sel.id) || null, 'after');
    $('#btnUndo').onclick = undo;
    $('#btnRedo').onclick = redo;
    $('#btnPrint').onclick = doPrint;
    $('#btnSpread').onclick = () => { S.spread = !S.spread; saveSettings(); applyCss(); };
    const fitZoom = () => {
      const avail = $('#viewer').clientWidth - (window.innerWidth <= 800 ? 20 : 60);
      return avail / (S.page.w * 96 / 25.4) / (S.spread ? 2.1 : 1);
    };
    if (!store.get('sidur.settings', null) && window.innerWidth <= 800) S.zoom = Math.round(fitZoom() * 100) / 100;
    const setZoom = (z) => { S.zoom = Math.round(Math.min(3, Math.max(0.25, z)) * 100) / 100; saveSettings(); applyCss(); };
    $('#selZoom').onchange = () => setZoom($('#selZoom').value === 'fit' ? fitZoom() : +$('#selZoom').value);
    $('#zoomIn').onclick = () => setZoom(S.zoom * 1.15);
    $('#zoomOut').onclick = () => setZoom(S.zoom / 1.15);
    $('#fileImport').onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };

    $('#pages').addEventListener('click', (e) => {
      if (!S.edit) return;
      const hit = letterFromEvent(e);
      if (hit) { popTab = 'letter'; selectLetter(hit.id, hit.r, hit.o); return; }
      const blk = e.target.closest('.blk');
      if (blk) {
        selBlock = blk.dataset.id;
        $$('.selblk').forEach((x) => x.classList.remove('selblk'));
        $$('.blk[data-id="' + selBlock + '"]').forEach((x) => x.classList.add('selblk'));
        popTab = 'para';
        sel = null;
        const b = getBlock(selBlock);
        // paragraph without letters (or click between words)
        pop.innerHTML = '';
        pop.append(el('button', { class: 'close', onclick: closePop }, '✕'));
        buildParaTab(b);
        pop.classList.add('open');
        positionPop(blk);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (dlg.open) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tag !== 'input') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && tag !== 'input') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); doPrint(); return; }
      if (!pop.classList.contains('open') || tag === 'input' || tag === 'select') return;
      if (e.key === 'Escape') closePop();
      else if (sel && e.key === 'ArrowLeft') { e.preventDefault(); navLetter(1); }
      else if (sel && e.key === 'ArrowRight') { e.preventDefault(); navLetter(-1); }
    });
    if (document.fonts) document.fonts.addEventListener('loadingdone', () => { if (!layoutFontsOk && fontsReady()) refreshSoon({ full: true }); });
    window.addEventListener('beforeprint', () => { $('#pages').style.zoom = 1; });
    window.addEventListener('afterprint', () => { $('#pages').style.zoom = S.zoom; });
    setupDialog();
    window.SidurApp = { refresh: (o) => refresh(o || {}), get layout() { return layout; } };
    switchDoc(S.nusach, S.prayer);
  }

  init();
})();
