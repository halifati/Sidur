/* Flow rendered blocks into fixed-size pages (what you see is what gets printed).
 * Supports incremental re-layout: after an edit only the affected pages are rebuilt
 * until the flow meets the previous layout again. */
(function (global) {
  'use strict';

  function parseOne(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content.firstElementChild;
  }

  /**
   * @param {HTMLElement} container element that receives .page elements
   * @param {{id:string, html:string}[]} items blocks to lay out, in order
   * @param {object} S settings
   * @param {object} doc {title}
   * @param {object} [inc] incremental: {prev: previous layout, from, to} (indices into items that changed)
   */
  function paginate(container, items, S, doc, inc) {
    let pages = [];        // [{el, firstId, firstCont}]
    let startIdx = 0;
    let leading = null;    // continuation fragment carried over from the previous layout
    let oldTail = [];
    let elements = null;

    if (inc && inc.prev && inc.prev.pageInfo.length) {
      const prev = inc.prev;
      let s = inc.from;
      while (s > 0 && !prev.blockPage.has(items[s] ? items[s].id : '')) s--;
      const p0 = items[s] && prev.blockPage.has(items[s].id) ? prev.blockPage.get(items[s].id) : -1;
      // restart from the first block that appears on page p0 (unchanged blocks before the edit included)
      const first = p0 >= 0 ? prev.pageInfo[p0] : null;
      const idxFirst = first ? items.findIndex((x) => x.id === first.firstId) : -1;
      if (first && idxFirst >= 0 && idxFirst <= s) {
        pages = prev.pageInfo.slice(0, p0);
        oldTail = prev.pageInfo.slice(p0);
        startIdx = idxFirst;
        const firstEl = oldTail[0].el.children[1].firstElementChild;
        if (first.firstCont && firstEl && firstEl.classList.contains('cont') && idxFirst < s) {
          leading = firstEl;
          leading.remove();
          startIdx = idxFirst + 1;
        }
        for (const p of oldTail) p.el.remove();
      } else {
        inc = null;
      }
    } else {
      inc = null;
    }
    if (!inc) {
      container.innerHTML = '';
      const src = document.createElement('div');
      src.innerHTML = items.map((x) => x.html).join('');
      elements = Array.from(src.children);
    }
    const elementAt = (i) => (elements ? elements[i] : parseOne(items[i].html));

    let body = null, bodyRect = null;
    const newPage = () => {
      const page = document.createElement('div');
      page.className = 'page';
      page.innerHTML = '<div class="hdr"></div><div class="body"></div><div class="ftr"></div>';
      page.classList.add((pages.length + 1) % 2 ? 'odd' : 'even');
      container.appendChild(page);
      const info = { el: page, firstId: null, firstCont: false };
      pages.push(info);
      body = page.children[1];
      bodyRect = body.getBoundingClientRect();
      return info;
    };
    const cur = () => pages[pages.length - 1];
    const noteFirst = (el) => {
      const p = cur();
      if (!p.firstId) { p.firstId = el.dataset.id; p.firstCont = el.classList.contains('cont'); }
    };

    const fitsEl = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return true;
      return r.bottom <= bodyRect.bottom + 1 && r.left >= bodyRect.left - 1 && r.right <= bodyRect.right + 1;
    };
    const wordsOf = (el) => el.querySelectorAll(':scope > .w');
    const blockFits = (el) => {
      const ws = wordsOf(el);
      return fitsEl(ws.length ? ws[ws.length - 1] : el) && (el.classList.contains('t-p') ? true : fitsEl(el));
    };

    // start a new page, carrying trailing headings along (keep with next)
    const breakPage = () => {
      const carry = [];
      let last = body.lastElementChild;
      while (last && /\bt-h\d\b/.test(last.className) && last.previousElementSibling) {
        carry.unshift(last);
        last = last.previousElementSibling;
      }
      if (carry.length && cur().firstId === carry[0].dataset.id) cur().firstId = null;
      newPage();
      for (const h of carry) { body.appendChild(h); noteFirst(h); }
    };

    /** place one element (may split it); returns false if it converged with the old layout */
    const place = (el, idx) => {
      let piece = el;
      let guard = 0;
      while (piece && guard++ < 1000) {
        // convergence: a fresh block at the top of a new page, same as in the old layout
        if (inc && idx > inc.to && !body.firstElementChild && !piece.classList.contains('cont')) {
          const t = oldTail.findIndex((p) => p.firstId === piece.dataset.id && !p.firstCont);
          if (t >= 0) {
            const empty = pages.pop();
            empty.el.remove();
            for (const p of oldTail.slice(t)) { container.appendChild(p.el); pages.push(p); }
            return false;
          }
        }
        body.appendChild(piece);
        if (blockFits(piece)) { noteFirst(piece); return true; }
        const words = Array.from(wordsOf(piece));
        const splittable = piece.classList.contains('t-p') && words.length > 1;
        let k = 0;
        if (splittable) {
          let lo = 0, hi = words.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (fitsEl(words[mid - 1])) lo = mid; else hi = mid - 1;
          }
          k = lo;
          if (k > 0 && k < words.length) {
            const lastTop = words[k - 1].getBoundingClientRect().top;
            if (Math.abs(words[k].getBoundingClientRect().top - lastTop) < 2) {
              while (k > 0 && Math.abs(words[k - 1].getBoundingClientRect().top - lastTop) < 2) k--;
            }
          }
        }
        if (k === 0) {
          if (body.firstElementChild === piece) { noteFirst(piece); return true; } // too big even for an empty page
          body.removeChild(piece);
          breakPage();
          continue;
        }
        const rest = piece.cloneNode(false);
        rest.classList.add('cont');
        rest.classList.remove('split');
        piece.classList.add('split');
        let node = words[k - 1].nextSibling;
        while (node) { const nx = node.nextSibling; rest.appendChild(node); node = nx; }
        while (rest.firstChild && (rest.firstChild.nodeType === 3 || rest.firstChild.tagName === 'BR')) rest.removeChild(rest.firstChild);
        noteFirst(piece);
        newPage();
        piece = rest;
      }
      return true;
    };

    newPage();
    let converged = false;
    if (leading) place(leading, startIdx - 1);
    for (let i = startIdx; i < items.length; i++) {
      if (!place(elementAt(i), i)) { converged = true; break; }
    }
    if (!converged && pages.length > 1 && !body.firstElementChild) pages.pop().el.remove();

    // numbering, parity, running headers, block -> page map
    const blockPage = new Map();
    let section = '';
    pages.forEach((p, i) => {
      const odd = (i + 1) % 2 === 1;
      p.el.classList.toggle('odd', odd);
      p.el.classList.toggle('even', !odd);
      const bodyEl = p.el.children[1];
      let pageSection = section;
      const blks = bodyEl.children;
      for (let j = 0; j < blks.length; j++) {
        const b = blks[j];
        const id = b.dataset.id;
        if (id && !blockPage.has(id)) blockPage.set(id, i);
        if (/\bt-h[12]\b/.test(b.className)) {
          section = b.textContent.trim();
          if (j === 0) pageSection = section;
        }
      }
      const hdr = p.el.children[0], ftr = p.el.children[2];
      const startsWithTitle = !!(blks[0] && blks[0].classList.contains('t-h1'));
      let h = '';
      if (S.header.show && !startsWithTitle) {
        h = S.header.content === 'section' ? pageSection : (odd ? pageSection : doc.title);
        h = h || doc.title;
      }
      hdr.textContent = h;
      hdr.style.visibility = h ? '' : 'hidden';
      const num = i + (S.pnum.start || 1);
      ftr.textContent = S.pnum.show ? (S.pnum.hebrew ? global.Heb.gematria(num) : String(num)) : '';
    });

    return { pages: pages.length, pageInfo: pages, ids: items.map((x) => x.id), blockPage, pageEls: pages.map((p) => p.el) };
  }

  global.Paginate = { paginate };
})(window);
