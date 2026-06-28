// Run with: node tests/test-parsers.js
// Uses node:assert. No external deps.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseAllegro, looksLikeDataDomeBlock, parseAllegroOffers } = require('../parser/allegro.js');
const { parseLokalnie, parseLokalnieOffers } = require('../parser/lokalnie.js');
const { splitKeywords, KEYWORDS, ALLEGRO_CATEGORY_ID, LOKALNIE_CATEGORY_PATH } = require('../parser/keywords.js');
const { composeEmail } = require('../parser/compose-email.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + e.message); }
}

// --- Split Keywords ---

test('splitKeywords returns one item per keyword', () => {
  const items = splitKeywords();
  assert.equal(items.length, KEYWORDS.length);
  for (const it of items) assert.ok(it.json && it.json.keyword && it.json.allegroCategoryId && it.json.lokalnieCategoryPath);
});

test('splitKeywords uses category 3690 / bron-biala-3691', () => {
  const items = splitKeywords();
  assert.equal(items[0].json.allegroCategoryId, ALLEGRO_CATEGORY_ID);
  assert.equal(items[0].json.lokalnieCategoryPath, LOKALNIE_CATEGORY_PATH);
  assert.equal(ALLEGRO_CATEGORY_ID, '3690');
  assert.equal(LOKALNIE_CATEGORY_PATH, 'bron/bron-biala-3691');
});

// --- parseAllegro ---

test('parseAllegro returns offers from synthetic fixture', () => {
  const html = read('allegro-listing.html');
  const offers = parseAllegro(html);
  assert.ok(offers.length >= 2, 'expected >=2 offers, got ' + offers.length);
  for (const o of offers) {
    assert.ok(/^\d{5,}$/.test(o.id), 'id must be numeric: ' + o.id);
    assert.ok(o.title);
    assert.ok(o.url.startsWith('https://allegro.pl/'));
    assert.ok(typeof o.price === 'string');
    assert.ok(typeof o.img === 'string');
  }
});

test('parseAllegro ids are unique', () => {
  const offers = parseAllegro(read('allegro-listing.html'));
  const ids = offers.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- looksLikeDataDomeBlock ---

test('looksLikeDataDomeBlock returns true for synthetic dd page', () => {
  assert.equal(looksLikeDataDomeBlock(read('datadome-challenge.html')), true);
});

test('looksLikeDataDomeBlock returns false for real allegro listing', () => {
  assert.equal(looksLikeDataDomeBlock(read('allegro-listing.html')), false);
});

// --- parseAllegroOffers ---

test('parseAllegroOffers namespaces ids with allegro: prefix', () => {
  const html = read('allegro-listing.html');
  const items = parseAllegroOffers([{ json: { data: html } }]);
  assert.ok(items.length >= 2);
  for (const it of items) {
    assert.equal(it.json.source, 'allegro');
    assert.ok(it.json.id.startsWith('allegro:'), 'id must be namespaced: ' + it.json.id);
    assert.equal(it.json.warning, undefined);
  }
});

test('parseAllegroOrders emits a warning for DataDome block', () => {
  const html = read('datadome-challenge.html');
  const items = parseAllegroOffers([{ json: { data: html } }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].json.warning, true);
  assert.ok(items[0].json.id.startsWith('allegro:skip:'));
});

// --- parseLokalnie ---

test('parseLokalnie returns offers from real lokalnie fixture', () => {
  const html = read('lokalnie-listing.html');
  const offers = parseLokalnie(html);
  assert.ok(offers.length > 0, 'expected >0 offers from fixture');
  for (const o of offers) {
    assert.ok(o.id.startsWith('allegro:') || o.id.startsWith('lokalnie:'), 'bad id: ' + o.id);
    assert.ok(o.source === 'allegro-via-lokalnie' || o.source === 'lokalnie', 'bad source: ' + o.source);
    assert.ok(o.title);
    assert.ok(o.url);
    assert.ok(typeof o.price === 'string');
    assert.ok(typeof o.img === 'string');
  }
});

test('parseLokalnie fixture has both lokalnie and allegro-via-lokalnie sources', () => {
  const offers = parseLokalnie(read('lokalnie-listing.html'));
  const sources = new Set(offers.map(o => o.source));
  assert.ok(sources.has('lokalnie'), 'fixture must have native lokalnie items');
  assert.ok(sources.has('allegro-via-lokalnie'), 'fixture must have cross-syndicated allegro items');
});

test('parseLokalnie ids are unique', () => {
  const offers = parseLokalnie(read('lokalnie-listing.html'));
  const ids = offers.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- parseLokalnieOffers ---

test('parseLokalnieOffers preserves source and namespaces ids', () => {
  const html = read('lokalnie-listing.html');
  const items = parseLokalnieOffers([{ json: { data: html } }], 'tasak');
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.ok(it.json.id.startsWith('allegro:') || it.json.id.startsWith('lokalnie:'));
    assert.ok(it.json.source === 'allegro-via-lokalnie' || it.json.source === 'lokalnie');
    assert.equal(it.json.warning, undefined);
  }
});

test('parseLokalnieOffers emits warning on error input', () => {
  const items = parseLokalnieOffers([{ json: { error: 'HTTP 502' } }], 'tasak');
  assert.equal(items.length, 1);
  assert.equal(items[0].json.warning, true);
  assert.ok(items[0].json.id.startsWith('lokalnie:skip:'));
});

// --- composeEmail ---

test('composeEmail returns 0 items for empty run (no offers, no warnings)', () => {
  assert.equal(composeEmail([]).length, 0);
});

test('composeEmail returns 1 item when there are offers', () => {
  const items = composeEmail([
    { json: { id: 'allegro:1', source: 'allegro', title: 'T', url: 'https://allegro.pl/x', price: '5', img: '' } },
  ]);
  assert.equal(items.length, 1);
  assert.ok(items[0].json.raw);
  assert.ok(items[0].json.subject.includes('1 new offer'));
});

test('composeEmail returns 1 item when only warnings exist (NO silent fail)', () => {
  const items = composeEmail([
    { json: { id: 'allegro:skip:tasak', source: 'allegro', warning: true, title: '⚠ DataDome block' } },
  ]);
  assert.equal(items.length, 1, 'warnings MUST trigger an email so user notices');
});

test('composeEmail groups lokaliie + allegro-via-lokalnie offers under Lokalnie section', () => {
  // Indirect check: subject counts both sections.
  const items = composeEmail([
    { json: { id: 'allegro:1', source: 'allegro', title: 'A', url: 'https://allegro.pl/x', price: '1', img: '' } },
    { json: { id: 'lokalnie:slug', source: 'lokalnie', title: 'L', url: 'https://allegrolokalnie.pl/x', price: '2', img: '' } },
    { json: { id: 'allegro:99', source: 'allegro-via-lokalnie', title: 'X', url: 'https://allegro.pl/x', price: '3', img: '' } },
  ]);
  assert.equal(items.length, 1);
  assert.ok(items[0].json.subject.includes('3 new offer'));
  // body should contain both Lokalnie and Allegro headers
  assert.ok(items[0].json.body.includes('Allegro Lokalnie'));
  assert.ok(items[0].json.body.includes('Allegro.pl'));
});

// --- summary ---

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);