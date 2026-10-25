(function () {
  var SG = window.SplitGoa;
  var KEY = 'splitgoa.v1';
  var state = { people: [], expenses: [] };

  var EXAMPLES = [
    'Rahul paid 4500 for the villa, split equally',
    'Aman paid 3k for scooter rental, split between Aman and Priya',
    'Priya paid 1,800 for beers except Rahul',
    'I paid ₹950 for dinner shared with Rahul'
  ];
  var DEMO = [
    'Rahul paid 12000 for the Airbnb in Anjuna, split equally',
    'Aman paid 2400 for scooter rentals, split between Aman, Priya and Rahul',
    'Priya paid 3150 for dinner at the beach shack',
    'Rahul paid 1800 for beers except Sneha',
    'Sneha paid 900 for cab to the airport, split with Priya'
  ];
  var DEMO_PEOPLE = ['Rahul', 'Aman', 'Priya', 'Sneha'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var inr = function (n) { return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  var listify = function (a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1]; };

  function emojiFor(desc) {
    var d = desc.toLowerCase();
    var map = [
      [/beer|drink|bar|cocktail|wine|feni|booze/, '🍺'], [/dinner|lunch|breakfast|food|shack|meal|restaurant|cafe|snack|pizza/, '🍽️'],
      [/scooter|bike|rental|car|cab|taxi|uber|ola|fuel|petrol|bus|train|flight/, '🛵'], [/villa|airbnb|hotel|hostel|stay|room|resort/, '🏡'],
      [/ticket|entry|club|party|casino|cruise|water ?sport|parasail/, '🎟️'], [/groceries|market|shopping|souvenir/, '🛍️']
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(d)) return map[i][1];
    return '💸';
  }

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.people && s.expenses) state = s; } catch (e) {}
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function addPeople(names) {
    names.forEach(function (n) { if (state.people.indexOf(n) < 0) state.people.push(n); });
  }

  function addFromText(text) {
    var lines = SG.splitInput(text), errors = [], added = 0;
    lines.forEach(function (line) {
      var r = SG.parseExpense(line, state.people);
      if (r.error) { errors.push('“' + line + '” → ' + r.error); return; }
      addPeople(r.payers.concat(r.participants));
      state.expenses.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), payers: r.payers, amount: r.amount, desc: r.desc, participants: r.participants });
      added++;
    });
    save();
    return { added: added, errors: errors };
  }

  function renderPreview() {
    var lines = SG.splitInput($('input').value);
    $('preview').innerHTML = lines.map(function (line) {
      var r = SG.parseExpense(line, state.people);
      if (r.error) return '<div class="pv err">' + esc(r.error) + '</div>';
      return '<div class="pv ok">' + emojiFor(r.desc) + ' <b>' + esc(r.desc) + '</b> · ' + inr(r.amount) + ' paid by <b>' + esc(listify(r.payers)) +
        '</b> · shared by ' + esc(listify(r.participants)) + ' (' + inr(r.amount / r.participants.length) + ' each)</div>';
    }).join('');
    $('add').disabled = !lines.length;
  }

  function render() {
    var used = {};
    state.expenses.forEach(function (e) { e.payers.concat(e.participants).forEach(function (p) { used[p] = true; }); });
    $('people').innerHTML = state.people.length ? state.people.map(function (p) {
      return '<span class="chip">' + esc(p) + '<button class="x" data-p="' + esc(p) + '"' + (used[p] ? ' disabled title="Part of an expense"' : ' title="Remove"') + '>×</button></span>';
    }).join('') : '<span class="hint">Nobody yet. Add expenses and names appear automatically.</span>';
    $('groupHint').textContent = state.people.length ? state.people.length + ' people' : '';

    var total = state.expenses.reduce(function (s, e) { return s + e.amount; }, 0);
    $('total').textContent = state.expenses.length ? inr(total) : '';
    $('expenses').innerHTML = state.expenses.length ? state.expenses.slice().reverse().map(function (e) {
      return '<li class="item"><div class="emoji">' + emojiFor(e.desc) + '</div><div class="grow"><div class="title">' + esc(e.desc) +
        '</div><div class="sub">' + esc(listify(e.payers)) + ' paid · split ' + e.participants.length + ' ways (' + inr(e.amount / e.participants.length) + ' each)</div></div>' +
        '<div class="amt">' + inr(e.amount) + '</div><button class="del" data-id="' + e.id + '" title="Delete">🗑</button></li>';
    }).join('') : '<li class="empty">No expenses yet. Try one of the examples above.</li>';

    var net = SG.computeBalances(state.expenses);
    var names = Object.keys(net).sort(function (a, b) { return net[b] - net[a]; });
    $('balances').innerHTML = names.length ? names.map(function (p) {
      var v = net[p] / 100, cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
      return '<li class="item"><div class="grow title">' + esc(p) + '</div><div class="amt ' + cls + '">' + (v > 0 ? 'gets back ' : v < 0 ? 'owes ' : 'settled ') + (v ? inr(Math.abs(v)) : '') + '</div></li>';
    }).join('') : '<li class="empty">Nothing to balance yet.</li>';

    var s = SG.settle(net);
    $('settlements').innerHTML = s.length ? s.map(function (t) {
      return '<li class="settle"><b>' + esc(t.from) + '</b><span class="arrow">→</span><b>' + esc(t.to) + '</b><span style="margin-left:auto" class="amt">' + inr(t.amount) + '</span></li>';
    }).join('') : '<li class="empty">All square 🎉</li>';
    $('copy').disabled = !s.length;
    renderPreview();
  }

  function summary() {
    var s = SG.settle(SG.computeBalances(state.expenses));
    return 'SplitGoa settle-up 🌴\n' + s.map(function (t) { return t.from + ' → ' + t.to + ': ' + inr(t.amount); }).join('\n');
  }

  function submit() {
    var res = addFromText($('input').value);
    if (res.added) $('input').value = '';
    render();
    if (res.errors.length) $('preview').innerHTML += res.errors.map(function (e) { return '<div class="pv err">' + esc(e) + '</div>'; }).join('');
  }

  $('add').addEventListener('click', submit);
  $('input').addEventListener('input', renderPreview);
  $('input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } });
  $('addPerson').addEventListener('click', addPerson);
  $('newPerson').addEventListener('keydown', function (e) { if (e.key === 'Enter') addPerson(); });
  function addPerson() {
    var v = $('newPerson').value.trim();
    if (!v) return;
    addPeople([v.replace(/(^|\s)([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); })]);
    $('newPerson').value = '';
    save(); render();
  }
  $('people').addEventListener('click', function (e) {
    var p = e.target.dataset && e.target.dataset.p;
    if (p && !e.target.disabled) { state.people = state.people.filter(function (x) { return x !== p; }); save(); render(); }
  });
  $('expenses').addEventListener('click', function (e) {
    var id = e.target.dataset && e.target.dataset.id;
    if (id) { state.expenses = state.expenses.filter(function (x) { return x.id !== id; }); save(); render(); }
  });
  $('reset').addEventListener('click', function () {
    if (state.expenses.length || state.people.length) { if (!confirm('Clear everyone and every expense?')) return; }
    state = { people: [], expenses: [] }; save(); render();
  });
  $('demo').addEventListener('click', function () {
    state = { people: DEMO_PEOPLE.slice(), expenses: [] };
    addFromText(DEMO.join('\n')); render();
  });
  $('copy').addEventListener('click', function () {
    var btn = $('copy');
    var done = function () { btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy summary'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(summary()).then(done, function () { alert(summary()); });
    else alert(summary());
  });

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
      rec.onend = function () { rec = null; $('mic').textContent = '🎤 Dictate'; };
      rec.onerror = function () { rec = null; $('mic').textContent = '🎤 Dictate'; };
      $('mic').textContent = '⏹ Stop';
      rec.start();
    });
  }

  load();
  render();
})();
