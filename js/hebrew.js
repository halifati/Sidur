/* Hebrew letter/nikud engine: parsing letter clusters, serializing them back,
 * and detecting shva na / shva nach, kamatz katan and patach genuva. */
(function (global) {
  'use strict';

  const N = {
    SHVA: 'ְ', HATAF_SEGOL: 'ֱ', HATAF_PATACH: 'ֲ', HATAF_KAMATZ: 'ֳ',
    HIRIK: 'ִ', TSERE: 'ֵ', SEGOL: 'ֶ', PATACH: 'ַ', KAMATZ: 'ָ',
    HOLAM: 'ֹ', HOLAM_HASER: 'ֺ', KUBUTZ: 'ֻ', DAGESH: 'ּ', METEG: 'ֽ',
    MAQAF: '־', RAFE: 'ֿ', SHIN_DOT: 'ׁ', SIN_DOT: 'ׂ', KAMATZ_KATAN: 'ׇ',
  };
  // invisible markers stored in the text (variation selectors are default-ignorable)
  const F = {
    SHVA_NA: '︀', SHVA_NACH: '︁', KAMATZ_GADOL: '︃', GENUVA: '︄', NO_GENUVA: '︅',
  };
  const FLAG_RE = /[︀-️]/g;

  const VOWELS = [N.SHVA, N.HATAF_SEGOL, N.HATAF_PATACH, N.HATAF_KAMATZ, N.HIRIK, N.TSERE, N.SEGOL,
    N.PATACH, N.KAMATZ, N.HOLAM, N.HOLAM_HASER, N.KUBUTZ, N.KAMATZ_KATAN];
  const VOWEL_SET = new Set(VOWELS);

  const VOWEL_NAMES = {
    '': 'ללא', [N.SHVA]: 'שווא', [N.HATAF_PATACH]: 'חטף פתח', [N.HATAF_SEGOL]: 'חטף סגול',
    [N.HATAF_KAMATZ]: 'חטף קמץ', [N.HIRIK]: 'חיריק', [N.TSERE]: 'צירה', [N.SEGOL]: 'סגול',
    [N.PATACH]: 'פתח', [N.KAMATZ]: 'קמץ', [N.KAMATZ_KATAN]: 'קמץ קטן', [N.HOLAM]: 'חולם',
    [N.HOLAM_HASER]: 'חולם חסר (לו׳)', [N.KUBUTZ]: 'קובוץ',
  };

  const isLetter = (ch) => ch >= 'א' && ch <= 'ת' || ch >= 'װ' && ch <= 'ײ';
  const isMark = (ch) => (ch >= '֑' && ch <= 'ׇ' && ch !== '־' && ch !== '׀' &&
    ch !== '׃' && ch !== '׆') || (ch >= '︀' && ch <= '️');
  const isTaam = (ch) => ch >= '֑' && ch <= '֮';

  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const normLetter = (l) => FINALS[l] || l;
  const BGDKPT = new Set(['ב', 'ג', 'ד', 'כ', 'ך', 'פ', 'ף', 'ת']);

  /** Parse one cluster string (letter + marks) into parts. */
  function parseCluster(s) {
    const c = { base: s[0], vowel: '', vowel2: '', dagesh: false, shin: '', meteg: false, rafe: false,
      taamim: '', other: '', flags: new Set() };
    for (let k = 1; k < s.length; k++) {
      const ch = s[k];
      if (VOWEL_SET.has(ch)) { if (!c.vowel) c.vowel = ch; else c.vowel2 += ch; }
      else if (ch === N.DAGESH) c.dagesh = true;
      else if (ch === N.SHIN_DOT || ch === N.SIN_DOT) c.shin = ch;
      else if (ch === N.METEG) c.meteg = true;
      else if (ch === N.RAFE) c.rafe = true;
      else if (ch >= '︀' && ch <= '️') c.flags.add(ch);
      else if (isTaam(ch)) c.taamim += ch;
      else c.other += ch;
    }
    return c;
  }

  /** Serialize parts back to a string in a stable logical order. */
  function serializeCluster(c) {
    let s = c.base + (c.shin || '') + (c.dagesh ? N.DAGESH : '') + (c.rafe ? N.RAFE : '') +
      (c.vowel || '') + (c.vowel2 || '') + (c.meteg ? N.METEG : '') + (c.taamim || '') + (c.other || '');
    // flags are only meaningful for certain vowels
    for (const f of c.flags) {
      if ((f === F.SHVA_NA || f === F.SHVA_NACH) && c.vowel !== N.SHVA) continue;
      if (f === F.KAMATZ_GADOL && c.vowel !== N.KAMATZ) continue;
      if ((f === F.GENUVA || f === F.NO_GENUVA) && c.vowel !== N.PATACH) continue;
      s += f;
    }
    return s;
  }

  /** Split a text into items: {k:'L', s, off} letter clusters, {k:'S'} whitespace, {k:'X'} other. */
  function tokenize(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (isLetter(ch)) {
        let j = i + 1;
        while (j < text.length && isMark(text[j])) j++;
        out.push({ k: 'L', s: text.slice(i, j), off: i });
        i = j;
      } else if (/\s/.test(ch)) {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        out.push({ k: 'S', s: ' ', off: i });
        i = j;
      } else {
        let j = i + 1;
        while (j < text.length && isMark(text[j])) j++; // stray marks stick to it
        out.push({ k: 'X', s: text.slice(i, j), off: i });
        i = j;
      }
    }
    return out;
  }

  // stems where a kamatz followed by shva is a kamatz katan (common in the siddur)
  const KATAN_STEMS = ['חכמ', 'אזנ', 'קדש', 'עזר', 'גדל', 'אכל', 'שרש', 'חפש', 'רחב', 'אמנ', 'עשר', 'טהר', 'ערפ', 'תמכ', 'צהר', 'סלח'];
  const KOL_WORDS = new Set(['כל', 'וכל', 'בכל', 'לכל', 'מכל', 'שכל', 'הכל', 'ככל', 'ובכל', 'ולכל', 'שבכל', 'מכל']);

  const hasFullVowel = (c) => !!c.vowel && c.vowel !== N.SHVA;
  const isShuruk = (cs, j) => cs[j].base === 'ו' && cs[j].dagesh && !cs[j].vowel &&
    (j === 0 || !cs[j - 1].vowel || cs[j - 1].vowel === N.SHVA);
  const isMater = (cs, j) => j > 0 && !cs[j].vowel && !cs[j].dagesh && 'אהוי'.includes(cs[j].base) && !isShuruk(cs, j);

  /**
   * Analyze one word (array of parsed clusters).
   * Returns array of {shva:'na'|'nach'|null, kamatz:'katan'|'gadol'|null, genuva:bool, src:{...}}
   */
  function analyzeWord(cs, opts) {
    const n = cs.length;
    const res = cs.map(() => ({ shva: null, kamatz: null, genuva: false }));
    if (!n) return res;
    const skeleton = cs.map((c) => c.base).join('');
    const isName = /^[ולבכמשה]?יהו[הה]$/.test(skeleton) || skeleton === 'יהוה';

    // --- kamatz katan / gadol
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      if (c.vowel === N.KAMATZ_KATAN) { res[i].kamatz = 'katan'; continue; }
      if (c.vowel !== N.KAMATZ) continue;
      if (c.flags.has(F.KAMATZ_GADOL) || c.meteg || !opts.autoKatan) { res[i].kamatz = 'gadol'; continue; }
      let katan = false;
      const nx = cs[i + 1], nx2 = cs[i + 2];
      if (KOL_WORDS.has(skeleton) && c.base === 'כ' && nx && nx.base === 'ל' && !nx.vowel) katan = true;
      else if (opts.beforeMaqaf && i === n - 2 && nx && !nx.vowel && !nx.dagesh) katan = true;
      else if (nx && nx.vowel === N.SHVA && !nx.flags.has(F.SHVA_NA)) {
        if (nx2 && BGDKPT.has(nx2.base) && nx2.dagesh) katan = true; // dagesh kal => closed syllable
        else {
          const stem = normLetter(c.base) + normLetter(nx.base) + (nx2 ? normLetter(nx2.base) : '');
          if (KATAN_STEMS.includes(stem)) katan = true;
        }
      } else if (nx && nx.vowel === N.HATAF_KAMATZ) katan = true; // e.g. צָהֳרַיִם, טָהֳרָה
      res[i].kamatz = katan ? 'katan' : 'gadol';
    }

    // --- shva na / nach
    let lastVowel = -1;
    for (let i = 0; i < n; i++) if (hasFullVowel(cs[i]) || isShuruk(cs, i)) lastVowel = i;
    const prevLong = (i) => {
      let j = i - 1;
      if (j < 0) return false;
      if (isMater(cs, j) && j > 0) j--;
      const c = cs[j];
      if (isShuruk(cs, j)) return true;
      if (c.vowel === N.KAMATZ) return res[j].kamatz !== 'katan';
      if (c.vowel === N.TSERE || c.vowel === N.HOLAM || c.vowel === N.HOLAM_HASER) return true;
      if (c.base === 'ו' && c.vowel === N.HOLAM) return true;
      if (c.vowel === N.HIRIK && j + 1 < i && cs[j + 1].base === 'י') return true; // hirik male
      return false;
    };
    for (let i = 0; i < n; i++) {
      const c = cs[i];
      if (c.vowel !== N.SHVA) continue;
      let r;
      if (c.flags.has(F.SHVA_NA)) r = 'na';
      else if (c.flags.has(F.SHVA_NACH)) r = 'nach';
      else if (!opts.autoShva) r = 'nach';
      else if (i > lastVowel) r = 'nach';
      else if (isName) r = 'nach';
      else if (i === 0) r = 'na';
      else if (res[i - 1].shva === 'na') r = 'nach';
      else if (cs[i - 1].vowel === N.SHVA) r = 'na';
      else if (i === 1 && isShuruk(cs, 0)) r = 'na';
      else if (i + 1 < n && normLetter(cs[i + 1].base) === normLetter(c.base)) r = 'na';
      else if (c.dagesh && !(BGDKPT.has(c.base) && !hasFullVowel(cs[i - 1]) && !isShuruk(cs, i - 1))) r = 'na';
      else if (i + 1 < n && BGDKPT.has(cs[i + 1].base) && cs[i + 1].dagesh) r = 'nach';
      else if (opts.longVowel && (prevLong(i) || cs[i - 1].meteg)) r = 'na';
      else r = 'nach';
      res[i].shva = r;
    }

    // --- patach genuva
    const last = cs[n - 1];
    if (last.vowel === N.PATACH && n >= 2) {
      if (last.flags.has(F.GENUVA)) res[n - 1].genuva = true;
      else if (!last.flags.has(F.NO_GENUVA) && opts.autoGenuva) {
        const okLetter = last.base === 'ח' || last.base === 'ע' || (last.base === 'ה' && last.dagesh);
        const p = cs[n - 2];
        const prevVowel = (hasFullVowel(p) || isShuruk(cs, n - 2) || (p.base === 'י' && !p.vowel) ||
          (p.base === 'ו' && p.vowel === N.HOLAM));
        res[n - 1].genuva = okLetter && prevVowel && p.vowel !== N.PATACH;
      }
    }
    return res;
  }

  /** Hebrew numerals (gematria) for page numbers. */
  function gematria(num) {
    if (num <= 0) return String(num);
    const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    const hund = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
    let s = '';
    if (num >= 1000) { s += gematria(Math.floor(num / 1000)) + '׳'; num %= 1000; }
    s += hund[Math.floor(num / 100)];
    num %= 100;
    if (num === 15) s += 'טו';
    else if (num === 16) s += 'טז';
    else s += tens[Math.floor(num / 10)] + ones[num % 10];
    if (s.length === 1) return s + '׳';
    return s.slice(0, -1) + '״' + s.slice(-1);
  }

  global.Heb = { N, F, FLAG_RE, VOWELS, VOWEL_NAMES, isLetter, isMark, isTaam, parseCluster,
    serializeCluster, tokenize, analyzeWord, gematria };
})(window);
