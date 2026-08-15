import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(testDir, '..', '..', 'workspace', 'workspace.js'),
  path.join(testDir, '..', '..', 'dist', 'workspace', 'workspace.js')
];
const corruptMarkers = /[\u251c\u252c\u0393\ufffd]/u;
const expectedText = [
  'd\u00f3nde',
  'im\u00e1genes',
  'm\u00f3dulo',
  'RITUALES \u00daTILES',
  'LOCAL / LISTO \u00b7',
  'Alt + \u2190',
  'Alt + \u2192'
];

const contents = files.map((file) => fs.readFileSync(file, 'utf8'));
assert.equal(contents[0], contents[1], 'source y dist deben contener el mismo workspace.js');

for (const [index, content] of contents.entries()) {
  assert.equal(corruptMarkers.test(content), false, `secuencia corrupta en ${files[index]}`);
  for (const text of expectedText) {
    assert.equal(content.includes(text), true, `falta texto corregido ${text} en ${files[index]}`);
  }
}

console.log(`PASS: codificacion validada en ${files.length} copias de workspace.js`);
