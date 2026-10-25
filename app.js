(function () {
  var SG = window.SplitGoa;
  var KEY = 'splitgoa.v2', OLD_KEY = 'splitgoa.v1';
  var state = null;
  var history = [];
  var formMode = null;

  var EXAMPLES = [
    'Rahul paid twelve hundred for dinner, split equally',
    'Aman paid 3k for scooter rental, split between Aman and Priya',
    'Priya paid 1,800 for beers except Rahul',
    'Rahul paid 1000 for dinner, Aman owes 300 and Priya owes 200',
    'Sneha paid Rahul 500'
  ];
  var DEMO = [
    'Rahul paid 12000 for the Airbnb in Anjuna, split equally',
    'Aman paid 2400 for scooter rentals, split between Aman, Priya and Rahul',
    'Priya paid three thousand one hundred fifty for dinner at the beach shack',
    'Rahul paid 1800 for beers except Sneha',
    'Sneha paid 900 for cab to the airport, split with Priya',
    'Aman paid 2000 for parasailing, Priya owes 800 and Sneha owes 600'
  ];
  var DEMO_PEOPLE = ['Rahul', 'Aman', 'Priya', 'Sneha'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var inr = function (n) { return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  var listify = function (a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1]; };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var titleCase = function (s) { return s.trim().replace(/\s+/g, ' ').replace(/(^|\s)([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); }); };
  var trip = function () { return state.trips.filter(function (t) { return t.id === state.current; })[0]; };
  var say = function (msg) { $('toolMsg').textContent = msg; };

  /* ---------- storage ---------- */
  function newTrip(name) { return { id: uid(), name: name, people: [], expenses: [] }; }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.trips) && s.trips.length) { state = s; if (!trip()) state.current = s.trips[0].id; return; }
    } catch (e) {}
    var t = newTrip('Goa Trip');
    try { /* carry over a v1 trip */
      var old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old && Array.isArray(old.people) && Array.isArray(old.expenses)) { t.people = old.people; t.expenses = old.expenses; }
    } catch (e) {}
    state = { v: 2, current: t.id, trips: [t] };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---------- history (undo) ---------- */
  function snapshot() {
    history.push(JSON.stringify({ people: trip().people, expenses: trip().expenses }));
    if (history.length > 30) history.shift();
  }

  function addPeople(names) {
    names.forEach(function (n) { if (trip().people.indexOf(n) < 0) trip().people.push(n); });
  }

  function addFromText(text) {
    var lines = SG.splitInput(text), errors = [], added = 0;
    if (lines.length) snapshot();
    lines.forEach(function (line) {
      var r = SG.parseExpense(line, trip().people);
      if (r.error) { errors.push('“' + line + '” → ' + r.error); return; }
      addPeople(r.payers.concat(r.participants));
      var e = { id: uid(), payers: r.payers, amount: r.amount, desc: r.desc, participants: r.participants };
      if (r.shares) e.shares = r.shares;
      if (r.settlement) e.settlement = true;
      trip().expenses.push(e);
      added++;
    });
    if (!added) history.pop();
    save();
    return { added: added, errors: errors };
  }

  /* ---------- rendering ---------- */
  function describeSplit(e) {
    if (e.settlement) return esc(listify(e.payers)) + ' paid ' + esc(listify(e.participants)) + ' back';
    var who = esc(listify(e.payers)) + ' paid · ';
    if (e.shares) return who + 'custom split between ' + e.participants.length;
    return who + 'split ' + e.participants.length + ' ways (' + inr(e.amount / e.participants.length) + ' each)';
  }

  function renderPreview() {
    var lines = SG.splitInput($('input').value);
    $('preview').innerHTML = lines.map(function (line) {
      var r = SG.parseExpense(line, trip().people);
      if (r.error) return '<div class="pv err">' + esc(r.error) + '</div>';
      var cat = r.settlement ? SG.SETTLEMENT : SG.categoryOf(r.desc);
      if (r.settlement) return '<div class="pv ok">' + cat.emoji + ' <b>' + esc(r.payers[0]) + '</b> pays <b>' + esc(r.participants[0]) + '</b> ' + inr(r.amount) + ' (settlement)</div>';
      var detail = r.shares
        ? Object.keys(r.shares).map(function (p) { return esc(p) + ' ' + inr(r.shares[p] / 100); }).join(', ')
        : esc(listify(r.participants)) + ' (' + inr(r.amount / r.participants.length) + ' each)';
      return '<div class="pv ok">' + cat.emoji + ' <b>' + esc(r.desc) + '</b> · ' + inr(r.amount) + ' paid by <b>' + esc(listify(r.payers)) + '</b> · shared: ' + detail + '</div>';
    }).join('');
    $('add').disabled = !lines.length;
  }

  function render() {
    var t = trip();
    $('trip').innerHTML = state.trips.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === t.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    $('deleteTrip').disabled = state.trips.length < 2;

    var used = {};
    t.expenses.forEach(function (e) { e.payers.concat(e.participants).forEach(function (p) { used[p] = true; }); });
    $('people').innerHTML = t.people.length ? t.people.map(function (p) {
      return '<span class="chip">' + esc(p) + '<button class="x" data-p="' + esc(p) + '"' + (used[p] ? ' disabled title="Part of an expense"' : ' title="Remove"') + '>×</button></span>';
    }).join('') : '<span class="hint">Nobody yet. Add expenses and names appear automatically.</span>';
    $('groupHint').textContent = t.people.length ? t.people.length + ' people' : '';

    var real = t.expenses.filter(function (e) { return !e.settlement; });
    var total = real.reduce(function (s, e) { return s + e.amount; }, 0);
    $('total').textContent = real.length ? inr(total) : '';
    $('expenses').innerHTML = t.expenses.length ? t.expenses.slice().reverse().map(function (e) {
      var cat = e.settlement ? SG.SETTLEMENT : SG.categoryOf(e.desc);
      return '<li class="item"><div class="emoji">' + cat.emoji + '</div><div class="grow"><div class="title">' + esc(e.desc) +
        (e.shares ? '<span class="tag">custom</span>' : '') + '</div><div class="sub">' + describeSplit(e) + '</div></div>' +
        '<div class="amt">' + inr(e.amount) + '</div><button class="del" data-id="' + esc(e.id) + '" title="Delete">🗑</button></li>';
    }).join('') : '<li class="empty">No expenses yet. Try one of the examples above.</li>';

    var net = SG.computeBalances(t.expenses);
    var tot = SG.personTotals(t.expenses);
    var names = Object.keys(net).sort(function (a, b) { return net[b] - net[a]; });
    $('balances').innerHTML = names.length ? names.map(function (p) {
      var v = net[p] / 100, cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
      var pt = tot[p] || { paid: 0, share: 0 };
      return '<li class="item"><div class="grow"><div class="title">' + esc(p) + '</div><div class="sub">spent ' + inr(pt.paid / 100) + ' · own share ' + inr(pt.share / 100) + '</div></div>' +
        '<div class="amt ' + cls + '">' + (v > 0 ? 'gets back ' : v < 0 ? 'owes ' : 'settled ') + (v ? inr(Math.abs(v)) : '') + '</div></li>';
    }).join('') : '<li class="empty">Nothing to balance yet.</li>';

    var s = SG.settle(net);
    $('settlements').innerHTML = s.length ? s.map(function (x) {
      return '<li class="settle"><b>' + esc(x.from) + '</b><span class="arrow">→</span><b>' + esc(x.to) + '</b><span style="margin-left:auto" class="amt">' + inr(x.amount) + '</span>' +
        '<button class="small" data-from="' + esc(x.from) + '" data-to="' + esc(x.to) + '" data-amt="' + x.amount + '">✓ Paid</button></li>';
    }).join('') : '<li class="empty">All square 🎉</li>';

    var cats = SG.spendByCategory(t.expenses), max = cats.length ? cats[0].total : 1;
    $('categories').innerHTML = cats.length ? cats.map(function (c) {
      return '<div class="barrow"><span>' + c.cat.emoji + ' ' + c.cat.label + '</span><div class="bar"><i style="width:' + Math.max(3, Math.round(c.total / max * 100)) + '%"></i></div><b>' + inr(c.total) + '</b></div>';
    }).join('') : '<div class="empty">Add an expense to see the breakdown.</div>';

    $('undo').disabled = !history.length;
    $('copy').disabled = $('whatsapp').disabled = !s.length;
    $('export').disabled = !t.expenses.length;
    renderPreview();
  }

  function summary() {
    var t = trip(), s = SG.settle(SG.computeBalances(t.expenses));
    var real = t.expenses.filter(function (e) { return !e.settlement; });
    var total = real.reduce(function (a, e) { return a + e.amount; }, 0);
    return 'SplitGoa 🌴 ' + t.name + '\nTotal spent: ' + inr(total) + '\n\nSettle up:\n' +
      s.map(function (x) { return x.from + ' → ' + x.to + ': ' + inr(x.amount); }).join('\n');
  }

  function submit() {
    var res = addFromText($('input').value);
    if (res.added) $('input').value = '';
    render();
    if (res.errors.length) $('preview').innerHTML += res.errors.map(function (e) { return '<div class="pv err">' + esc(e) + '</div>'; }).join('');
  }

  /* ---------- trips ---------- */
  function openForm(mode) {
    formMode = mode;
    $('tripForm').style.display = 'flex';
    $('tripName').value = mode === 'rename' ? trip().name : '';
    $('tripName').focus();
  }
  function closeForm() { formMode = null; $('tripForm').style.display = 'none'; }
  function saveForm() {
    var name = titleCase($('tripName').value);
    if (!name) return;
    if (formMode === 'rename') trip().name = name;
    else { var t = newTrip(name); state.trips.push(t); state.current = t.id; history = []; }
    closeForm(); save(); render();
  }

  /* ---------- events ---------- */
  $('add').addEventListener('click', submit);
  $('input').addEventListener('input', renderPreview);
  $('input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });

  $('trip').addEventListener('change', function () { state.current = $('trip').value; history = []; closeForm(); save(); render(); });
  $('newTrip').addEventListener('click', function () { openForm('new'); });
  $('renameTrip').addEventListener('click', function () { openForm('rename'); });
  $('cancelTrip').addEventListener('click', closeForm);
  $('saveTrip').addEventListener('click', saveForm);
  $('tripName').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveForm(); if (e.key === 'Escape') closeForm(); });
  $('deleteTrip').addEventListener('click', function () {
    if (state.trips.length < 2) return;
    if (!confirm('Delete “' + trip().name + '” and all its expenses?')) return;
    state.trips = state.trips.filter(function (x) { return x.id !== state.current; });
    state.current = state.trips[0].id; history = []; save(); render();
  });

  function addPerson() {
    var v = titleCase($('newPerson').value);
    if (!v) return;
    snapshot(); addPeople([v]);
    $('newPerson').value = '';
    save(); render();
  }
  $('addPerson').addEventListener('click', addPerson);
  $('newPerson').addEventListener('keydown', function (e) { if (e.key === 'Enter') addPerson(); });
  $('people').addEventListener('click', function (e) {
    var p = e.target.dataset && e.target.dataset.p;
    if (p && !e.target.disabled) { snapshot(); trip().people = trip().people.filter(function (x) { return x !== p; }); save(); render(); }
  });
  $('expenses').addEventListener('click', function (e) {
    var id = e.target.dataset && e.target.dataset.id;
    if (id) { snapshot(); trip().expenses = trip().expenses.filter(function (x) { return x.id !== id; }); save(); render(); }
  });
  $('settlements').addEventListener('click', function (e) {
    var d = e.target.dataset;
    if (!d || !d.from) return;
    snapshot();
    trip().expenses.push({ id: uid(), payers: [d.from], amount: parseFloat(d.amt), desc: 'Settlement', participants: [d.to], settlement: true });
    save(); render(); say(d.from + ' → ' + d.to + ' marked as paid.');
  });

  $('undo').addEventListener('click', function () {
    var prev = history.pop();
    if (!prev) return;
    var s = JSON.parse(prev);
    trip().people = s.people; trip().expenses = s.expenses;
    save(); render(); say('Undone.');
  });
  $('reset').addEventListener('click', function () {
    if (trip().expenses.length || trip().people.length) { if (!confirm('Clear everyone and every expense in this trip?')) return; }
    snapshot(); trip().people = []; trip().expenses = []; save(); render();
  });
  $('demo').addEventListener('click', function () {
    snapshot();
    trip().people = DEMO_PEOPLE.slice(); trip().expenses = [];
    addFromText(DEMO.join('\n')); history.pop(); render();
  });

  $('copy').addEventListener('click', function () {
    var done = function () { say('Summary copied.'); };
    if (navigator.clipboard) navigator.clipboard.writeText(summary()).then(done, function () { alert(summary()); });
    else alert(summary());
  });
  $('whatsapp').addEventListener('click', function () {
    window.open('https://wa.me/?text=' + encodeURIComponent(summary()), '_blank', 'noopener');
  });

  $('export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ app: 'splitgoa', version: 2, trip: trip() }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'splitgoa-' + trip().name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    say('Exported ' + trip().expenses.length + ' expenses.');
  });
  $('import').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () {
    var f = $('file').files[0];
    $('file').value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var t = sanitizeTrip(reader.result);
      if (!t) { say('That file is not a SplitGoa export.'); return; }
      state.trips.push(t); state.current = t.id; history = []; save(); render();
      say('Imported “' + t.name + '” with ' + t.expenses.length + ' expenses.');
    };
    reader.readAsText(f);
  });

  function sanitizeTrip(text) {
    try {
      var raw = JSON.parse(text), src = raw && raw.trip ? raw.trip : raw;
      if (!src || !Array.isArray(src.expenses) || src.expenses.length > 2000) return null;
      var str = function (x) { return String(x).slice(0, 60); };
      var names = function (a) { return Array.isArray(a) ? a.slice(0, 50).map(str) : null; };
      var t = newTrip(str(src.name || 'Imported trip'));
      for (var i = 0; i < src.expenses.length; i++) {
        var e = src.expenses[i], payers = names(e && e.payers), parts = names(e && e.participants);
        if (!payers || !parts || !payers.length || !parts.length || !(Number(e.amount) > 0) || Number(e.amount) > 1e9) return null;
        var out = { id: uid(), payers: payers, amount: Number(e.amount), desc: str(e.desc || 'Expense'), participants: parts };
        if (e.settlement === true) out.settlement = true;
        if (e.shares && typeof e.shares === 'object') {
          var sh = {}, sum = 0;
          for (var k = 0; k < parts.length; k++) {
            var v = Math.round(Number(e.shares[parts[k]]));
            if (!(v >= 0)) return null;
            sh[parts[k]] = v; sum += v;
          }
          if (sum !== Math.round(out.amount * 100)) return null;
          out.shares = sh;
        }
        t.expenses.push(out);
      }
      var people = names(src.people) || [];
      t.expenses.forEach(function (e) { people = people.concat(e.payers, e.participants); });
      t.people = people.filter(function (p, i) { return people.indexOf(p) === i; });
      return t;
    } catch (err) { return null; }
  }

  $('examples').innerHTML = '<span class="hint">Try:</span> ' + EXAMPLES.map(function (x, i) { return '<button class="chip example" data-i="' + i + '">' + esc(x) + '</button>'; }).join(' ');
  $('examples').addEventListener('click', function (e) {
    var i = e.target.dataset && e.target.dataset.i;
    if (i != null) { var box = $('input'); box.value += (box.value ? '\n' : '') + EXAMPLES[i]; box.focus(); renderPreview(); }
  });

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('mic').style.display = 'none'; }
  else {
    var rec = null;
    $('mic').addEventListener('click', function () {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = false;
      rec.onresult = function (ev) {
        var text = ev.results[ev.results.length - 1][0].transcript.trim();
        var box = $('input'); box.value += (box.value && !/\n$/.test(box.value) ? '\n' : '') + text; renderPreview();
      };
      rec.onend = rec.onerror = function () { rec = null; $('mic').textContent = '🎤 Dictate'; };
      $('mic').textContent = '⏹ Stop';
      rec.start();
    });
  }

  load();
  render();
})();
