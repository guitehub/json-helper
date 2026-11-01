#!/usr/bin/env node
/*
 * Génère test/fixtures/large.json (~5 Mo, au-delà du seuil de 2 Mo) pour tester le seuil des 2 Mo.
 * Le fichier n'est pas versionné (voir .gitignore).
 * Usage : node scripts/make-large-fixture.js [taille_approx_en_Mo]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const targetMb = Number(process.argv[2]) || 4;
const target = targetMb * 1024 * 1024;
const items = [];
let size = 0;
for (let i = 0; size < target; i++) {
  const item = {
    id: i,
    uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Élément n°${i}`,
    active: i % 3 !== 0,
    score: Math.round(Math.sin(i) * 10000) / 100,
    tags: ['alpha', 'beta', 'gamma'].slice(0, (i % 3) + 1),
    parent: i > 0 ? i - 1 : null,
    meta: { created: new Date(1700000000000 + i * 60000).toISOString(), version: (i % 7) + 1 },
  };
  size += JSON.stringify(item, null, 2).length + 6; // ≈ taille indentée
  items.push(item);
}

const file = path.join(__dirname, '..', 'test', 'fixtures', 'large.json');
fs.writeFileSync(file, JSON.stringify({ count: items.length, items }, null, 2));
console.log(`écrit test/fixtures/large.json (${(fs.statSync(file).size / 1048576).toFixed(1)} Mo)`);
