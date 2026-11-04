/* Block model (runs) and rendering of blocks to HTML. */
(function (global) {
  'use strict';
  const { N, F, FLAG_RE, parseCluster, tokenize, analyzeWord, isTaam } = global.Heb;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Parse the simple source HTML (<b>,<small>,<big>,<em>,<br>) to runs. */
  function htmlToRuns(h) {
    const runs = [];
    let b = 0, s = 0, g = 0, i = 0;
    const re = /<(\/?)(b|small|big|em|br)>|([^<]+)|</g;
    let m;
    while ((m = re.exec(h))) {
      if (m[3] !== undefined || m[0] === '<') {
        const t = m[3] !== undefined ? m[3].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '<';
        const r = { t };
        if (b) r.b = 1;
        if (s) r.s = Math.min(s, 2);
        if (g) r.g = Math.min(g, 2);
        if (i) r.i = 1;
        runs.push(r);
      } else {
        const close = m[1] === '/';
        const d = close ? -1 : 1;
        switch (m[2]) {
          case 'b': b = Math.max(0, b + d); break;
          case 'small': s = Math.max(0, s + d); break;
          case 'big': g = Math.max(0, g + d); break;
          case 'em': i = Math.max(0, i + d); break;
          case 'br': if (!close) runs.push({ br: 1 }); break;
        }
      }
    }
    return mergeRuns(runs);
  }

  const sameStyle = (a, b) => !a.br && !b.br && (a.b || 0) === (b.b || 0) && (a.s || 0) === (b.s || 0) &&
    (a.g || 0) === (b.g || 0) && (a.i || 0) === (b.i || 0) && (a.c || '') === (b.c || '') && (a.fs || 0) === (b.fs || 0);

  function mergeRuns(runs) {
    const out = [];
    for (const r of runs) {
      if (!r.br && !r.t) continue;
      const last = out[out.length - 1];
      if (last && sameStyle(last, r)) last.t += r.t;
      else out.push(Object.assign({}, r));
    }
    return out;
  }

  function runClass(r) {
    let c = 'r';
    if (r.b) c += ' b';
    if (r.s) c += ' s' + r.s;
    if (r.g) c += ' g' + r.g;
    if (r.i) c += ' i';
    return c;
  }
  function runStyle(r) {
    let st = '';
    if (r.c) st += 'color:' + r.c + ';';
    if (r.fs) st += 'font-size:' + r.fs + 'em;';
    return st;
  }

  /** Display string of a cluster and the optional styled-mark overlay. */
  function clusterHtml(c, an, S) {
    let vowel = c.vowel;
    let markType = null;
    if (vowel === N.SHVA && an.shva) markType = an.shva === 'na' ? 'sn' : 'sc';
    else if ((vowel === N.KAMATZ || vowel === N.KAMATZ_KATAN) && an.kamatz) markType = an.kamatz === 'katan' ? 'kk' : 'kg';
    else if (vowel === N.PATACH && an.genuva) markType = 'pg';
    const styled = markType && S.marks[markType] && S.marks[markType].on;
    let base = c.base + (c.shin || '') + (c.dagesh ? N.DAGESH : '') + (c.rafe ? N.RAFE : '');
    if (!styled) base += vowel || '';
    base += c.vowel2 || '';
    if (c.meteg && S.meteg) base += N.METEG;
    if (S.taamim) base += c.taamim;
    base += c.other.replace(FLAG_RE, '');
    let ov = '';
    if (styled) ov = '<span class="mk ' + markType + '"> ' + vowel + '</span>';
    return { base, ov, markType };
  }

  /** Analyze all words of a block. Returns items with parsed clusters + analysis. */
  function blockItems(block, S, doc) {
    const items = [];
    block.runs.forEach((run, r) => {
      if (run.br) { items.push({ k: 'BR', r }); return; }
      for (const tk of tokenize(run.t)) { tk.r = r; items.push(tk); }
    });
    const opts = {
      autoShva: S.rules.autoShva,
      longVowel: S.rules.longVowel === 'auto' ? !doc.srcShvaNa : S.rules.longVowel === 'on',
      autoKatan: S.rules.autoKatan,
      autoGenuva: S.rules.autoGenuva,
    };
    // letter sequences (words for grammatical analysis)
    let seq = [];
    const flush = (nextItem) => {
      if (!seq.length) return;
      opts.beforeMaqaf = !!(nextItem && nextItem.k === 'X' && nextItem.s[0] === N.MAQAF);
      const cs = seq.map((it) => it.c);
      const an = analyzeWord(cs, opts);
      seq.forEach((it, j) => { it.an = an[j]; });
      seq = [];
    };
    for (const it of items) {
      if (it.k === 'L') { it.c = parseCluster(it.s); seq.push(it); }
      else flush(it);
    }
    flush(null);
    return items;
  }

  /** Render a block to an HTML string. */
  function blockHtml(block, S, doc) {
    const items = blockItems(block, S, doc);
    const st = block.style || {};
    let cls = 'blk t-' + block.type;
    if (block.type === 'p' && block.runs.length && block.runs.every((r) => r.br || r.s)) cls += ' instr';
    if (st.hide) cls += ' hid';
    if (block.added) cls += ' added';
    let style = '';
    if (st.font) style += "font-family:'" + st.font.replace(/'/g, '') + "',serif;";
    if (st.size) style += 'font-size:' + st.size + '%;';
    if (st.color) { style += 'color:' + st.color + ';'; cls += ' hascolor'; }
    if (st.align) style += 'text-align:' + st.align + ';text-align-last:' + (st.align === 'justify' ? 'auto' : st.align) + ';';
    if (st.bold) style += 'font-weight:700;';
    if (st.italic) style += 'font-style:italic;';
    if (st.bg) style += 'background:' + st.bg + ';';
    if (st.mt != null && st.mt !== '') style += 'margin-top:' + st.mt + 'em;';
    if (st.mb != null && st.mb !== '') style += 'margin-bottom:' + st.mb + 'em;';
    if (st.indent) style += 'text-indent:' + st.indent + 'em;';
    if (st.lh) style += 'line-height:' + st.lh + ';';

    let html = '<div class="' + cls + '" data-id="' + block.id + '"' + (style ? ' style="' + style + '"' : '') + '>';
    let inWord = false, curRun = -1;
    const closeRun = () => { if (curRun >= 0) { html += '</span>'; curRun = -1; } };
    const closeWord = () => { closeRun(); if (inWord) { html += '</span>'; inWord = false; } };
    for (const it of items) {
      if (it.k === 'S') { closeWord(); html += ' '; continue; }
      if (it.k === 'BR') { closeWord(); html += '<br>'; continue; }
      if (!inWord) { html += '<span class="w">'; inWord = true; }
      if (curRun !== it.r) {
        closeRun();
        const run = block.runs[it.r];
        const rs = runStyle(run);
        html += '<span class="' + runClass(run) + '" data-r="' + it.r + '" data-o="' + it.off + '"' + (rs ? ' style="' + rs + '"' : '') + '>';
        curRun = it.r;
      }
      if (it.k === 'L') {
        const { base, ov } = clusterHtml(it.c, it.an, S);
        html += ov ? '<span class="L">' + base + ov + '</span>' : base;
      } else {
        let s = it.s.replace(FLAG_RE, '');
        if (!S.taamim) s = Array.from(s).filter((ch) => !isTaam(ch)).join('');
        html += esc(s);
      }
    }
    closeWord();
    if (!items.length) html += '<span class="w empty">​</span>';
    html += '</div>';
    return html;
  }

  /** Find the cluster (letter) at run r, offset o. */
  function clusterAt(block, r, o) {
    const run = block.runs[r];
    if (!run || run.br) return null;
    const tk = tokenize(run.t).find((t) => t.off === o && t.k === 'L');
    return tk ? { s: tk.s, off: o, len: tk.s.length } : null;
  }

  function analysisAt(block, r, o, S, doc) {
    const items = blockItems(block, S, doc);
    return items.find((it) => it.k === 'L' && it.r === r && it.off === o) || null;
  }

  /** Runs -> editable HTML (for the text editor). */
  function runsToEditHtml(runs) {
    let h = '';
    for (const r of runs) {
      if (r.br) { h += '<br>'; continue; }
      let t = esc(r.t);
      if (r.b) t = '<b>' + t + '</b>';
      if (r.i) t = '<i>' + t + '</i>';
      for (let k = 0; k < (r.s || 0); k++) t = '<small>' + t + '</small>';
      for (let k = 0; k < (r.g || 0); k++) t = '<big>' + t + '</big>';
      const st = runStyle(r);
      if (st) t = '<span style="' + st + '">' + t + '</span>';
      h += t;
    }
    return h;
  }

  /** Editable DOM -> runs. */
  function editDomToRuns(root) {
    const runs = [];
    const walk = (node, ctx) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) {
          const t = ch.nodeValue.replace(/ /g, ' ');
          if (t) {
            const r = { t };
            if (ctx.b) r.b = 1;
            if (ctx.s) r.s = Math.min(ctx.s, 2);
            if (ctx.g) r.g = Math.min(ctx.g, 2);
            if (ctx.i) r.i = 1;
            if (ctx.c) r.c = ctx.c;
            if (ctx.fs) r.fs = ctx.fs;
            runs.push(r);
          }
        } else if (ch.nodeType === 1) {
          const tag = ch.tagName;
          if (tag === 'BR') { runs.push({ br: 1 }); continue; }
          const c2 = Object.assign({}, ctx);
          if (tag === 'B' || tag === 'STRONG') c2.b = 1;
          if (tag === 'I' || tag === 'EM') c2.i = 1;
          if (tag === 'SMALL') c2.s = (c2.s || 0) + 1;
          if (tag === 'BIG') c2.g = (c2.g || 0) + 1;
          if (tag === 'FONT' && ch.getAttribute('color')) c2.c = ch.getAttribute('color');
          const st = ch.style;
          if (st) {
            if (st.color) c2.c = toHex(st.color);
            if (st.fontWeight && (st.fontWeight === 'bold' || +st.fontWeight >= 600)) c2.b = 1;
            if (st.fontWeight && (st.fontWeight === 'normal' || +st.fontWeight === 400)) c2.b = 0;
            if (st.fontSize && /em$/.test(st.fontSize)) c2.fs = parseFloat(st.fontSize);
            if (st.fontStyle === 'italic') c2.i = 1;
          }
          const block = /^(DIV|P)$/.test(tag);
          if (block && runs.length && !runs[runs.length - 1].br) runs.push({ br: 1 });
          walk(ch, c2);
        }
      }
    };
    walk(root, {});
    while (runs.length && runs[runs.length - 1].br) runs.pop();
    return mergeRuns(runs);
  }

  function toHex(c) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (!m) return c;
    return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
  }

  const plainText = (block) => block.runs.map((r) => (r.br ? '\n' : r.t)).join('').replace(FLAG_RE, '');

  global.Render = { htmlToRuns, mergeRuns, sameStyle, blockHtml, clusterHtml, clusterAt, analysisAt, runsToEditHtml,
    editDomToRuns, plainText, esc };
})(window);
