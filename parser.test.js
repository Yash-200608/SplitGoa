const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExpense, splitInput, computeBalances, settle } = require('./parser.js');

const known = ['Rahul', 'Aman', 'Priya', 'Sneha'];

test('splits equally among the known group by default', () => {
  const r = parseExpense('Rahul paid 4500 for the villa, split equally', known);
  assert.deepEqual(r, { payers: ['Rahul'], amount: 4500, desc: 'Villa', participants: known });
});

test('understands k shorthand and explicit participants', () => {
  const r = parseExpense('Aman paid 3k for scooter rental, split between Aman and Priya', known);
  assert.equal(r.amount, 3000);
  assert.equal(r.desc, 'Scooter rental');
  assert.deepEqual(r.participants, ['Aman', 'Priya']);
});

test('handles thousands separators and "except"', () => {
  const r = parseExpense('Priya paid 1,800 for beers except Rahul', known);
  assert.equal(r.amount, 1800);
  assert.deepEqual(r.participants, ['Aman', 'Priya', 'Sneha']);
});

test('maps "I" to Me, strips ₹ and adds payer for "shared with"', () => {
  const r = parseExpense('I paid ₹950 for dinner shared with Rahul', known);
  assert.deepEqual(r.payers, ['Me']);
  assert.equal(r.amount, 950);
  assert.deepEqual(r.participants, ['Me', 'Rahul']);
});

test('supports "paid by" with multiple payers', () => {
  const r = parseExpense('dinner 1200 paid by rahul and aman', known);
  assert.deepEqual(r.payers, ['Rahul', 'Aman']);
  assert.equal(r.desc, 'Dinner');
});

test('does not mistake "shared" in the description for a split clause', () => {
  const r = parseExpense('Rahul paid for the shared cab 600', known);
  assert.equal(r.desc, 'Shared cab');
  assert.deepEqual(r.participants, known);
});

test('reports errors for a missing payer or amount', () => {
  assert.match(parseExpense('paid 500', known).error, /Who paid/);
  assert.match(parseExpense('Rahul paid for dinner', known).error, /No amount/);
  assert.match(parseExpense('', known).error, /Type or dictate/);
});

test('rejects an expense shared by only the payer', () => {
  assert.ok(parseExpense('Rahul paid 500 for chai', []).error);
});

test('splitInput separates lines, semicolons and sentences but keeps decimals', () => {
  assert.deepEqual(
    splitInput('Rahul paid 500 for chai. Aman paid 1.5k for taxi\nPriya paid 20 for gum'),
    ['Rahul paid 500 for chai', 'Aman paid 1.5k for taxi', 'Priya paid 20 for gum']
  );
});

test('balances sum to zero and settlements clear every debt', () => {
  const expenses = [
    { payers: ['Rahul'], amount: 100, participants: ['Rahul', 'Aman', 'Priya'] },
    { payers: ['Aman'], amount: 50, participants: ['Aman', 'Priya'] }
  ];
  const net = computeBalances(expenses);
  assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0);
  const paid = settle(net);
  assert.deepEqual(paid, [
    { from: 'Priya', to: 'Rahul', amount: 58.33 },
    { from: 'Aman', to: 'Rahul', amount: 8.33 }
  ]);
});

test('uneven amounts never lose a paisa', () => {
  const net = computeBalances([{ payers: ['A'], amount: 100, participants: ['A', 'B', 'C'] }]);
  assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(net, { A: 6666, B: -3333, C: -3333 });
});

/* ---------- v2 ---------- */
const { numberWords, categoryOf, personTotals, spendByCategory } = require('./parser.js');

test('v2: spoken numbers become digits', () => {
  assert.equal(numberWords('paid twelve hundred for dinner'), 'paid 1200 for dinner');
  assert.equal(numberWords('two thousand five hundred'), '2500');
  assert.equal(numberWords('one hundred and twenty'), '120');
  assert.equal(numberWords('a thousand'), '1000');
  assert.equal(numberWords('five k'), '5 k');
});

test('v2: lone small number words stay words so "one beer" is not an amount', () => {
  const r = parseExpense('Rahul paid for one beer 300', known);
  assert.equal(r.amount, 300);
  assert.equal(r.desc, 'One beer');
});

test('v2: dictated amounts work end to end', () => {
  assert.equal(parseExpense('Priya paid three thousand one hundred fifty for dinner', known).amount, 3150);
  assert.equal(parseExpense('five k for the villa paid by Rahul', known).amount, 5000);
});

test('v2: custom shares, remainder falls on the payer', () => {
  const r = parseExpense('Rahul paid 1000 for dinner, Aman owes 300 and Priya owes 200', known);
  assert.deepEqual(r.shares, { Aman: 30000, Priya: 20000, Rahul: 50000 });
  assert.equal(r.amount, 1000);
  assert.equal(r.desc, 'Dinner');
});

test('v2: custom shares, remainder split among the named group', () => {
  const r = parseExpense('Rahul paid 1000 for dinner split between Aman, Priya and Sneha where Aman owes 400', known);
  assert.deepEqual(r.shares, { Aman: 40000, Priya: 30000, Sneha: 30000 });
});

test('v2: shares larger than the bill are rejected', () => {
  assert.match(parseExpense('Rahul paid 500 for taxi, Aman owes 600', known).error, /more than/);
});

test('v2: custom shares feed the balances', () => {
  const r = parseExpense('Rahul paid 1000 for dinner, Aman owes 300 and Priya owes 200', known);
  const net = computeBalances([r]);
  assert.deepEqual(net, { Rahul: 50000, Aman: -30000, Priya: -20000 });
});

test('v2: settlement phrases are recognised', () => {
  for (const s of ['Sneha paid Rahul 3000', 'Sneha settled up with Rahul 3000', 'Sneha gave 3000 to Rahul']) {
    const r = parseExpense(s, known);
    assert.equal(r.settlement, true, s);
    assert.deepEqual(r.payers, ['Sneha']);
    assert.deepEqual(r.participants, ['Rahul']);
  }
});

test('v2: a settlement cancels the debt it covers', () => {
  const expense = parseExpense('Rahul paid 1000 for dinner, Aman owes 500', known);
  const pay = parseExpense('Aman paid Rahul 500', known);
  assert.deepEqual(settle(computeBalances([expense])), [{ from: 'Aman', to: 'Rahul', amount: 500 }]);
  assert.deepEqual(settle(computeBalances([expense, pay])), []);
});

test('v2: "paid <thing>" is still an expense, not a settlement', () => {
  const r = parseExpense('Rahul paid 500 for chai', known);
  assert.equal(r.settlement, undefined);
  assert.equal(r.desc, 'Chai');
});

test('v2: categories and spending summaries', () => {
  assert.equal(categoryOf('Beers').key, 'drinks');
  assert.equal(categoryOf('Airbnb in Anjuna').key, 'stay');
  assert.equal(categoryOf('Mystery').key, 'other');
  const ex = [
    parseExpense('Rahul paid 3000 for the villa', known),
    parseExpense('Aman paid 1000 for beers', known),
    parseExpense('Aman paid Rahul 200', known)
  ];
  const cats = spendByCategory(ex);
  assert.deepEqual(cats.map(c => [c.cat.key, c.total]), [['stay', 3000], ['drinks', 1000]]);
  const totals = personTotals(ex);
  assert.equal(totals.Rahul.paid, 300000);
  assert.equal(totals.Aman.paid, 100000);
});
