/* SplitGoa v2 parser: plain-English sentences -> expenses, balances and settlements. */
(function (root) {
  var ALL_RE = /^(everyone|everybody|all|all of us|us|the group|group|everyone else|the rest)$/i;
  var CLAUSE_RE = new RegExp(
    [
      '\\bsplit\\b',
      '\\bdivide[d]?\\b',
      '\\bshare[sd]?\\s+(?:it|this|that|equally|evenly|by|between|among|amongst|with|across)\\b',
      '\\bbetween\\b',
      '\\bamong(?:st)?\\b',
      '\\bexcept\\b',
      '\\bexcluding\\b',
      '\\bwithout\\b',
      '\\bfor\\s+(?:everyone|everybody|all|us)\\b',
      '\\b(?:equally|evenly)\\b'
    ].join('|'),
    'i'
  );
  var AMOUNT_RE = /(\d[\d,]*(?:\.\d+)?)(?:\s*(k|thousand|lakhs?)(?![a-z]))?/i;
  var VERB_RE = /^(.*?)\b(paid|pays|pay|spent|spends|bought|buys|covered|treated|booked|ordered|got|gave|sent|returned|repaid|settled|transferred)\b\s*(.*)$/i;
  var SHARE_RE = /[,\s]*(?:\b(?:and|where|but)\s+)?\b([A-Za-z]+)\s+owes?\s+(\d[\d,]*(?:\.\d+)?)(?:\s*(k|thousand)(?![a-z]))?/gi;
  var SETTLE_VERBS = /^(settled|returned|repaid|gave|sent|transferred)$/;

  var CATEGORIES = [
    { key: 'drinks', label: 'Drinks', emoji: '🍺', re: /beer|drink|bar\b|cocktail|wine|feni|booze|pub|liquor|whisky|rum|vodka/ },
    { key: 'food', label: 'Food', emoji: '🍽️', re: /dinner|lunch|breakfast|food|shack|meal|restaurant|cafe|snack|pizza|chai|coffee|kebab|biryani|thali|seafood|fish|ice ?cream/ },
    { key: 'transport', label: 'Transport', emoji: '🛵', re: /scooter|bike|rental|car\b|cab\b|taxi|uber|ola\b|fuel|petrol|diesel|bus\b|train|flight|toll|parking|ferry/ },
    { key: 'stay', label: 'Stay', emoji: '🏡', re: /villa|airbnb|hotel|hostel|stay|room|resort|homestay/ },
    { key: 'activities', label: 'Activities', emoji: '🎟️', re: /ticket|entry|club|party|casino|cruise|water ?sport|parasail|dive|diving|trek|tour|massage|spa/ },
    { key: 'shopping', label: 'Shopping', emoji: '🛍️', re: /grocer|market|shopping|souvenir|gift|clothes/ }
  ];
  var OTHER = { key: 'other', label: 'Other', emoji: '💸' };
  var SETTLEMENT = { key: 'settlement', label: 'Settlement', emoji: '🤝' };

  function categoryOf(desc) {
    var d = String(desc || '').toLowerCase();
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].re.test(d)) return CATEGORIES[i];
    return OTHER;
  }

  /* ---- spoken numbers: "twelve hundred" -> 1200 ---- */
  var UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var BIG = { hundred: 1, thousand: 1, lakh: 1, lakhs: 1 };

  function numWord(w) { return w in UNITS || w in TENS || w in BIG; }

  function numberWords(text) {
    var toks = String(text).split(' '), out = [], i = 0;
    while (i < toks.length) {
      var w = toks[i].toLowerCase().replace(/[,.;!?]+$/, '');
      if (!numWord(w)) { out.push(toks[i]); i++; continue; }
      var j = i, words = [];
      while (j < toks.length) {
        var wj = toks[j].toLowerCase().replace(/[,.;!?]+$/, '');
        var next = j + 1 < toks.length ? toks[j + 1].toLowerCase().replace(/[,.;!?]+$/, '') : '';
        if (numWord(wj)) words.push(wj);
        else if (wj === 'and' && words.length && numWord(next)) { /* "one hundred and twenty" */ }
        else break;
        j++;
        if (/[,.;!?]$/.test(toks[j - 1])) break;
      }
      var total = 0, cur = 0;
      words.forEach(function (x) {
        if (x in UNITS) cur += UNITS[x];
        else if (x in TENS) cur += TENS[x];
        else if (x === 'hundred') cur = (cur || 1) * 100;
        else if (x === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
        else { total += (cur || 1) * 100000; cur = 0; }
      });
      var value = total + cur;
      var after = j < toks.length ? toks[j].toLowerCase() : '';
      if (words.length > 1 || value >= 10 || after === 'k') {
        var punct = (toks[j - 1].match(/[,.;!?]+$/) || [''])[0];
        if (out.length && /^(a|an)$/i.test(out[out.length - 1]) && /^(hundred|thousand|lakhs?)$/.test(words[0])) out.pop();
        out.push(String(value) + punct);
      } else {
        for (var k = i; k < j; k++) out.push(toks[k]);
      }
      i = j;
    }
    return out.join(' ');
  }

  function cap(s) {
    return s.trim().replace(/\s+/g, ' ').replace(/(^|\s)([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }

  function normName(raw, known) {
    var n = raw.trim().replace(/^(?:the|my|our)\s+/i, '').replace(/[.,!?]+$/, '');
    if (/^(i|me|myself|i've|i'd|i'll)$/i.test(n)) n = 'Me';
    var lower = n.toLowerCase();
    for (var i = 0; i < known.length; i++) if (known[i].toLowerCase() === lower) return known[i];
    return cap(n);
  }

  function splitNames(str) {
    return str.split(/\s*(?:,|&|\+|\band\b)\s*/i).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function isAll(token) {
    return ALL_RE.test(token) || /\bof us\b/i.test(token);
  }

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }

  function parseExpense(input, known) {
    known = known || [];
    var t = String(input || '')
      .replace(/₹/g, ' ')
      .replace(/\b(?:rs|inr)\.?(?=\s*\d)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!]+$/, '');
    if (!t) return { error: 'Type or dictate an expense.' };
    t = numberWords(t);

    /* explicit shares: "Aman owes 300 and Priya owes 200" */
    var shareList = [];
    t = t.replace(SHARE_RE, function (_, name, amt, unit) {
      var v = parseFloat(amt.replace(/,/g, ''));
      if (unit) v *= 1000;
      shareList.push({ name: normName(name, known), amount: v });
      return ' ';
    }).replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/[,\s]+$/, '').trim();

    var cut = t.search(CLAUSE_RE);
    var main = (cut >= 0 ? t.slice(0, cut) : t).trim();
    var clause = cut >= 0 ? t.slice(cut).trim() : '';

    var am = main.match(AMOUNT_RE);
    if (!am) return { error: 'No amount found, say something like “paid 1200”.' };
    var amount = parseFloat(am[1].replace(/,/g, ''));
    var unit = (am[2] || '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') amount *= 1000;
    else if (unit.indexOf('lakh') === 0) amount *= 100000;
    if (!(amount > 0)) return { error: 'The amount must be greater than zero.' };

    var m = (main.slice(0, am.index) + ' ' + main.slice(am.index + am[0].length)).replace(/\s+/g, ' ').trim();

    var payersRaw = '', verb = '';
    var pb = m.match(/\bpaid by\s+(.+)$/i);
    if (pb) {
      payersRaw = pb[1];
      m = m.slice(0, pb.index).trim();
    } else {
      var vm = m.match(VERB_RE);
      if (vm) { payersRaw = vm[1]; verb = vm[2].toLowerCase(); m = vm[3]; }
    }
    var payers = uniq(splitNames(payersRaw).filter(function (x) { return !isAll(x); }).map(function (x) { return normName(x, known); }));
    if (!payers.length) return { error: 'Who paid? Start with a name, e.g. “Rahul paid 1200 for dinner”.' };

    /* settlement: "Sneha paid Rahul 3000", "Sneha settled up with Rahul 3000" */
    if (!clause && !shareList.length && verb) {
      var tn = m.replace(/^(?:(?:back|up|to|with|from)\s+)+/i, '').replace(/[,]+$/, '').trim();
      if (/^[A-Za-z]+$/.test(tn)) {
        var who = normName(tn, known);
        var isKnown = known.some(function (k) { return k === who; });
        if ((isKnown || SETTLE_VERBS.test(verb)) && payers.indexOf(who) < 0) {
          return { payers: payers, amount: amount, desc: 'Settlement', participants: [who], settlement: true };
        }
      }
    }

    var desc = m
      .replace(/\b(?:rupees|rupee|bucks)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:for|on|of|towards?|to|at)\s+/i, '')
      .replace(/^(?:the|a|an|some|our)\s+/i, '')
      .replace(/\s+(?:for|at|of|worth|around|about)$/i, '')
      .replace(/^[,\s-]+|[,\s-]+$/g, '');
    desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Expense';

    var everyone = false, names = [], exclude = [];
    var c = clause;
    var ex = c.match(/\b(?:except|excluding|without|other than)\s+(.+)$/i);
    if (ex) {
      exclude = splitNames(ex[1]).map(function (x) { return normName(x, known); });
      c = c.slice(0, ex.index).trim();
    }
    var withFlag = /\bwith\b/i.test(c);
    c = c.replace(/\b(?:split|shares?d?|divide[d]?|it|this|that|the bill|the cost|equally|evenly|between|among(?:st)?|across|with|by|for)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    splitNames(c).forEach(function (tok) {
      if (isAll(tok)) everyone = true; else names.push(normName(tok, known));
    });
    if (!names.length) everyone = true;

    var participants;
    if (everyone) participants = uniq(known.concat(payers, names));
    else participants = uniq(withFlag ? payers.concat(names) : names);
    participants = participants.filter(function (p) { return exclude.indexOf(p) < 0; });

    if (shareList.length) return withShares(payers, amount, desc, shareList, clause ? participants : payers, clause);

    if (!participants.length) return { error: 'Nobody is left to share this. Name the people: “split between Aman and Priya”.' };
    if (participants.length === 1 && payers.length === 1 && participants[0] === payers[0]) {
      return { error: 'Who else shared this? Add the group first or say “split between …”.' };
    }
    return { payers: payers, amount: amount, desc: desc, participants: participants };
  }

  /* exact shares in paise; whoever is left shares the remainder equally */
  function withShares(payers, amount, desc, shareList, rest, clause) {
    var total = Math.round(amount * 100), sum = 0, map = {}, order = [];
    shareList.forEach(function (s) {
      var p = Math.round(s.amount * 100);
      if (!(s.name in map)) order.push(s.name);
      map[s.name] = (map[s.name] || 0) + p;
      sum += p;
    });
    var remaining = total - sum;
    if (remaining < 0) return { error: 'Those shares add up to more than ₹' + amount + '.' };
    var others = rest.filter(function (p) { return !(p in map); });
    if (remaining > 0) {
      if (!others.length) return { error: '₹' + remaining / 100 + ' is left over. Say who covers the rest, e.g. “split the rest with Priya”.' };
      share(remaining, others.length).forEach(function (v, i) { map[others[i]] = v; order.push(others[i]); });
    }
    return { payers: payers, amount: amount, desc: desc, participants: order, shares: map };
  }

  function splitInput(text) {
    return String(text || '')
      .split(/\n+|;|\.(?=\s+[A-Z])/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /* Divide `total` paise into n integer parts that add up exactly. */
  function share(total, n) {
    var base = Math.floor(total / n), rem = total - base * n, out = [];
    for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
    return out;
  }

  function owedMap(e) {
    var total = Math.round(e.amount * 100), map = {};
    if (e.shares) { Object.keys(e.shares).forEach(function (p) { map[p] = e.shares[p]; }); return map; }
    share(total, e.participants.length).forEach(function (v, i) { map[e.participants[i]] = (map[e.participants[i]] || 0) + v; });
    return map;
  }

  function paidMap(e) {
    var total = Math.round(e.amount * 100), map = {};
    share(total, e.payers.length).forEach(function (v, i) { map[e.payers[i]] = (map[e.payers[i]] || 0) + v; });
    return map;
  }

  function computeBalances(expenses) {
    var net = {};
    expenses.forEach(function (e) {
      var paid = paidMap(e), owed = owedMap(e);
      Object.keys(paid).forEach(function (p) { net[p] = (net[p] || 0) + paid[p]; });
      Object.keys(owed).forEach(function (p) { net[p] = (net[p] || 0) - owed[p]; });
    });
    return net; // paise, positive = is owed, negative = owes
  }

  /* Real spending only (settlements excluded): per person paid vs. consumed, in paise. */
  function personTotals(expenses) {
    var out = {};
    expenses.forEach(function (e) {
      if (e.settlement) return;
      var paid = paidMap(e), owed = owedMap(e);
      Object.keys(paid).forEach(function (p) { (out[p] = out[p] || { paid: 0, share: 0 }).paid += paid[p]; });
      Object.keys(owed).forEach(function (p) { (out[p] = out[p] || { paid: 0, share: 0 }).share += owed[p]; });
    });
    return out;
  }

  function spendByCategory(expenses) {
    var by = {};
    expenses.forEach(function (e) {
      if (e.settlement) return;
      var c = categoryOf(e.desc);
      (by[c.key] = by[c.key] || { cat: c, total: 0 }).total += e.amount;
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.total - a.total; });
  }

  function settle(net) {
    var cr = [], db = [];
    Object.keys(net).forEach(function (p) {
      if (net[p] > 0) cr.push({ p: p, v: net[p] });
      else if (net[p] < 0) db.push({ p: p, v: -net[p] });
    });
    var out = [];
    while (cr.length && db.length) {
      cr.sort(function (a, b) { return b.v - a.v; });
      db.sort(function (a, b) { return b.v - a.v; });
      var x = Math.min(cr[0].v, db[0].v);
      out.push({ from: db[0].p, to: cr[0].p, amount: x / 100 });
      cr[0].v -= x; db[0].v -= x;
      if (cr[0].v === 0) cr.shift();
      if (db[0].v === 0) db.shift();
    }
    return out;
  }

  var api = {
    VERSION: 2,
    SETTLEMENT: SETTLEMENT,
    parseExpense: parseExpense,
    splitInput: splitInput,
    numberWords: numberWords,
    categoryOf: categoryOf,
    computeBalances: computeBalances,
    personTotals: personTotals,
    spendByCategory: spendByCategory,
    settle: settle
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitGoa = api;
})(typeof window !== 'undefined' ? window : this);
