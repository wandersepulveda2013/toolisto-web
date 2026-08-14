const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const { join } = require('path');
const BASE = 'http://localhost:8080';
const DIST = join(__dirname, '..', 'dist');

const tools = [
  { slug: 'dividir-paginas-dobles-pdf', toolId: 'splitDoublePdf' },
  { slug: 'crear-cuadernillo-pdf',     toolId: 'bookletPdf' },
  { slug: 'agregar-marca-de-agua-pdf', toolId: 'watermarkPdf' },
  { slug: 'numerar-paginas-pdf',       toolId: 'addPageNumbersPdf' },
  { slug: 'encabezado-pie-pdf',        toolId: 'addHeaderFooterPdf' },
];

let failures = 0;
const ok = (label, cond) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${label}`); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext();

  for (const t of tools) {
    console.log('\n=== ' + t.toolId + ' (' + t.slug + ') — página en revisión ===');
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    const pageHtml = readFileSync(join(DIST, t.slug + '.html'), 'utf8');
    ok(`${t.slug}: página conservada en dist`, pageHtml.length > 0);
    ok(`${t.slug}: noindex`, pageHtml.includes('<meta name="robots" content="noindex, nofollow">'));
    ok(`${t.slug}: aviso de revisión presente`, pageHtml.includes('id="toolDisabledNotice"'));
    ok(`${t.slug}: config enabled=false`, pageHtml.includes('"enabled":false'));

    await page.goto(BASE + '/' + t.slug + '.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => ({
      noticeVisible: (() => { const el = document.getElementById('toolDisabledNotice'); return el && !el.hidden; })(),
      runDisabled: document.getElementById('runButton') ? document.getElementById('runButton').disabled : null,
      browseDisabled: document.getElementById('browseButton') ? document.getElementById('browseButton').disabled : null,
      dropDisabled: document.getElementById('dropZone') ? document.getElementById('dropZone').classList.contains('is-disabled') : null,
      cfgEnabled: (() => { const el = document.querySelector('#tool-page-config'); if (!el) return null; try { return JSON.parse(el.textContent).enabled; } catch (e) { return 'parse-error'; } })(),
    }));
    ok(`${t.toolId}: aviso visible`, state.noticeVisible === true);
    ok(`${t.toolId}: run button deshabilitado`, state.runDisabled === true);
    ok(`${t.toolId}: browse button deshabilitado`, state.browseDisabled === true);
    ok(`${t.toolId}: drop zone deshabilitada`, state.dropDisabled === true);
    ok(`${t.toolId}: config.enabled === false`, state.cfgEnabled === false);
    ok(`${t.toolId}: sin errores de consola`, consoleErrors.length === 0);

    await page.close();
  }

  await browser.close();
  console.log(`\n=== RESULTADO: ${failures === 0 ? 'APROBADO' : failures + ' FALLO(S)'} ===`);
  process.exit(failures ? 1 : 0);
})();
