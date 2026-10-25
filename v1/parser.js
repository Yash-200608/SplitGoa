/* SplitGoa parser: turns plain-English sentences into expenses, balances and settlements. */
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
  var VERB_RE = /^(.*?)\b(paid|pays|pay|spent|spends|bought|buys|covered|treated|booked|ordered|got)\b\s*(.*)$/i;

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

    var payersRaw = '';
    var pb = m.match(/\bpaid by\s+(.+)$/i);
    if (pb) {
      payersRaw = pb[1];
      m = m.slice(0, pb.index).trim();
    } else {
      var vm = m.match(VERB_RE);
      if (vm) { payersRaw = vm[1]; m = vm[3]; }
    }
    var payers = uniq(splitNames(payersRaw).filter(function (x) { return !isAll(x); }).map(function (x) { return normName(x, known); }));
    if (!payers.length) return { error: 'Who paid? Start with a name, e.g. “Rahul paid 1200 for dinner”.' };

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

    if (!participants.length) return { error: 'Nobody is left to share this. Name the people: “split between Aman and Priya”.' };
    if (participants.length === 1 && payers.length === 1 && participants[0] === payers[0]) {
      return { error: 'Who else shared this? Add the group first or say “split between …”.' };
    }
    return { payers: payers, amount: amount, desc: desc, participants: participants };
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

  function computeBalances(expenses) {
    var net = {};
    expenses.forEach(function (e) {
      var total = Math.round(e.amount * 100);
      share(total, e.payers.length).forEach(function (v, i) { net[e.payers[i]] = (net[e.payers[i]] || 0) + v; });
      share(total, e.participants.length).forEach(function (v, i) { net[e.participants[i]] = (net[e.participants[i]] || 0) - v; });
    });
    return net; // paise, positive = is owed, negative = owes
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

  var api = { parseExpense: parseExpense, splitInput: splitInput, computeBalances: computeBalances, settle: settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SplitGoa = api;
})(typeof window !== 'undefined' ? window : this);
