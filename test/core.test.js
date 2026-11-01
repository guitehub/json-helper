/*
 * Tests unitaires des fonctions pures de content.js.
 * Zéro dépendance : node --test (Node 18+).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jh = require('../content.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** Reconvertit l'arbre fidèle en valeur JS, pour comparaison avec JSON.parse. */
function astToValue(node) {
  switch (node.t) {
    case 'o': {
      const obj = {};
      for (const [k, v] of node.e) obj[k] = astToValue(v);
      return obj;
    }
    case 'a':
      return node.e.map(astToValue);
    case 's':
    case 'b':
      return node.v;
    case 'n':
      return Number(node.raw);
    case 'z':
      return null;
    default:
      throw new Error('type inconnu ' + node.t);
  }
}

test('isJsonContentType reconnaît les types JSON', () => {
  for (const ct of [
    'application/json',
    'application/json; charset=utf-8',
    'APPLICATION/JSON',
    'text/json',
    'application/x-json',
    'application/vnd.api+json',
    'application/problem+json',
    'application/geo+json',
    'application/json-patch+json',
  ]) {
    assert.equal(jh.isJsonContentType(ct), true, ct);
  }
});

test('isJsonContentType rejette les autres types', () => {
  for (const ct of ['', null, undefined, 'text/html', 'text/plain', 'application/javascript', 'application/jsonp', 'application/x-ndjson', 'image/json-ish']) {
    assert.equal(jh.isJsonContentType(ct), false, String(ct));
  }
});

test('cleanText retire le BOM et les préfixes anti-XSSI', () => {
  assert.equal(jh.cleanText('﻿{"a":1}'), '{"a":1}');
  assert.equal(jh.cleanText(")]}',\n{\"a\":1}"), '{"a":1}');
  assert.equal(jh.cleanText(")]}'\n[1]"), '[1]');
  assert.equal(jh.cleanText('while(1);{"a":1}'), '{"a":1}');
  assert.equal(jh.cleanText('for(;;);[]'), '[]');
  assert.equal(jh.cleanText('  {"a":1}'), '  {"a":1}');
});

test('looksLikeJsonContainer', () => {
  assert.equal(jh.looksLikeJsonContainer('{"a":1}'), true);
  assert.equal(jh.looksLikeJsonContainer('\n  [1,2]'), true);
  assert.equal(jh.looksLikeJsonContainer('42'), false);
  assert.equal(jh.looksLikeJsonContainer('"texte"'), false);
  assert.equal(jh.looksLikeJsonContainer('<html>'), false);
});

test('tryParse ne lève jamais', () => {
  assert.equal(jh.tryParse('{"a":1}').ok, true);
  assert.equal(jh.tryParse(fixture('invalid.json')).ok, false);
  assert.equal(jh.tryParse('').ok, false);
});

test('parseAst équivaut à JSON.parse sur toutes les fixtures valides', () => {
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json') && f !== 'invalid.json');
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = jh.cleanText(fixture(file));
    assert.deepEqual(astToValue(jh.parseAst(text)), JSON.parse(text), file);
  }
});

test('parseAst conserve l’ordre des clés (même numériques)', () => {
  const ast = jh.parseAst(fixture('edge-cases.json'));
  const keys = ast.e.map(([k]) => k);
  assert.deepEqual(keys.slice(0, 4), ['b', '2', 'a', '1']);
});

test('parseAst conserve le texte exact des nombres', () => {
  const ast = jh.parseAst(fixture('edge-cases.json'));
  const get = (key) => ast.e.find(([k]) => k === key)[1];
  assert.equal(get('bigint').raw, '12345678901234567890');
  assert.equal(get('snowflake_id').raw, '1234567890123456789');
  assert.equal(get('exp').raw, '1.5e+300');
  assert.equal(get('negative').raw, '-0');
});

test('parseAst affiche les clés dupliquées', () => {
  const ast = jh.parseAst(fixture('edge-cases.json'));
  assert.equal(ast.e.filter(([k]) => k === 'dup').length, 2);
});

test('parseAst gère les échappements et l’unicode', () => {
  const ast = jh.parseAst('{"s":"a\\"b\\\\","t":"\\u00e9\\ud83d\\ude00","\\"k":1}');
  assert.equal(ast.e[0][1].v, 'a"b\\');
  assert.equal(ast.e[1][1].v, 'é😀');
  assert.equal(ast.e[2][0], '"k');
});

test('parseAst rejette le JSON invalide', () => {
  for (const bad of ['{', '[1,]', '{"a":1,}', '{"a" 1}', 'tru', '01', '[1] x', '"abc']) {
    assert.throws(() => jh.parseAst(bad), SyntaxError, bad);
  }
});

test('itemsLabel et formatSize', () => {
  assert.equal(jh.itemsLabel(1), '1 item');
  assert.equal(jh.itemsLabel(12), '12 items');
  assert.equal(jh.formatSize(512), '512 o');
  assert.equal(jh.formatSize(2048), '2,0 Ko');
  assert.equal(jh.formatSize(3 * 1024 * 1024), '3,0 Mo');
});

test('isLinkable n’accepte que http(s)', () => {
  assert.equal(jh.isLinkable('https://example.com/a?b=1'), true);
  assert.equal(jh.isLinkable('http://localhost:8080'), true);
  assert.equal(jh.isLinkable('javascript:alert(1)'), false);
  assert.equal(jh.isLinkable('data:text/html,x'), false);
  assert.equal(jh.isLinkable('https://exa mple.com'), false);
  assert.equal(jh.isLinkable(42), false);
});

test('formatPath en notation JavaScript', () => {
  assert.equal(jh.formatPath([], 'js'), '');
  assert.equal(jh.formatPath(['data', 'items', 3, 'id'], 'js'), 'data.items[3].id');
  assert.equal(jh.formatPath([0, 'name'], 'js'), '[0].name');
  assert.equal(jh.formatPath(['$ref', '_id'], 'js'), '$ref._id');
  assert.equal(jh.formatPath(['headers', 'content-type'], 'js'), 'headers["content-type"]');
  assert.equal(jh.formatPath(['a b', '1', '', 'é'], 'js'), '["a b"]["1"][""]["é"]');
  assert.equal(jh.formatPath(['say "hi"'], 'js'), '["say \\"hi\\""]');
});

test('formatPath en notation jq', () => {
  assert.equal(jh.formatPath([], 'jq'), '.');
  assert.equal(jh.formatPath(['data', 'items', 3, 'id'], 'jq'), '.data.items[3].id');
  assert.equal(jh.formatPath([0, 'name'], 'jq'), '.[0].name');
  assert.equal(jh.formatPath(['headers', 'content-type'], 'jq'), '.headers["content-type"]');
  assert.equal(jh.formatPath(['content-type'], 'jq'), '.["content-type"]');
  assert.equal(jh.formatPath(['$ref'], 'jq'), '.["$ref"]'); // $ n'est pas un identifiant jq
});

test('stringifyAst produit la même chose que JSON.stringify(…, null, 2) sur du JSON simple', () => {
  for (const file of ['simple.json', 'nested.json', 'root-array.json', 'root-primitive.json']) {
    const text = jh.cleanText(fixture(file));
    assert.equal(jh.stringifyAst(jh.parseAst(text)), JSON.stringify(JSON.parse(text), null, 2), file);
  }
});

test('stringifyAst reste fidèle à la source', () => {
  const out = jh.stringifyAst(jh.parseAst('{"b":1,"2":2,"big":12345678901234567890,"x":1.0,"dup":1,"dup":2,"e":{},"f":[]}'));
  assert.equal(
    out,
    '{\n  "b": 1,\n  "2": 2,\n  "big": 12345678901234567890,\n  "x": 1.0,\n  "dup": 1,\n  "dup": 2,\n  "e": {},\n  "f": []\n}'
  );
});

test('stringifyAst produit du JSON valide sur toutes les fixtures valides', () => {
  for (const file of fs.readdirSync(FIXTURES)) {
    const text = jh.cleanText(fixture(file));
    if (!jh.tryParse(text).ok) continue;
    assert.deepEqual(JSON.parse(jh.stringifyAst(jh.parseAst(text))), JSON.parse(text), file);
  }
});

test('le seuil « gros JSON » vaut 2 Mo', () => {
  assert.equal(jh.LARGE_THRESHOLD, 2 * 1024 * 1024);
});
