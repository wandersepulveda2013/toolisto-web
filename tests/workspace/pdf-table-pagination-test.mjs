#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

// Los modulos del Workspace se sirven al navegador como ES modules, mientras que
// el paquete raiz no marca .js como module para Node. Cargarlo como data URL
// mantiene esta prueba unitaria sin necesitar un servidor ni cambiar el paquete.
const source = await readFile(new URL('../../workspace/core/pdf-generator.js', import.meta.url), 'utf8');
const { generatePDF } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let pass = 0;
let fail = 0;
function check(name, condition) {
  if (condition) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.error(`FAIL: ${name}`); }
}

const rows = Array.from({ length: 70 }, (_, index) => [`Fila ${index + 1}`, String(index + 1)]);
const pdf = generatePDF({
  title: 'Tabla larga',
  format: 'A4',
  orientation: 'portrait',
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
  sections: [{ type: 'table', data: { headers: ['Concepto', 'Valor'], rows } }],
});

const pageCount = (pdf.match(/\/Type \/Page\b/g) || []).length;
const headerCount = (pdf.match(/\(Concepto\)/g) || []).length;
check('una tabla larga se divide en varias páginas', pageCount > 1);
check('el encabezado se repite en cada fragmento', headerCount === pageCount);
check('conserva la primera fila', pdf.includes('(Fila 1)'));
check('conserva la última fila', pdf.includes('(Fila 70)'));
check('no duplica ni omite filas al paginar', (pdf.match(/\(Fila \d+\)/g) || []).length === rows.length);

const compactPdf = generatePDF({
  title: 'Tabla corta',
  sections: [{ type: 'table', data: { headers: ['A'], rows: [['uno'], ['dos']] } }],
});
check('una tabla corta permanece en una página', (compactPdf.match(/\/Type \/Page\b/g) || []).length === 1);
check('una tabla corta conserva un único encabezado', (compactPdf.match(/\(A\)/g) || []).length === 1);

console.log(`Resultados: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
