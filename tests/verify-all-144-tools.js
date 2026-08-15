const { chromium } = require('playwright');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const BASE = process.env.TEST_BASE || 'http://localhost:8080';
const DIST = join(__dirname, '..', 'dist');

const toolsJson = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'tools.json'), 'utf8'));
const appJs = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const procJs = readFileSync(join(__dirname, '..', 'tool-processors.js'), 'utf8');

let passed = 0;
let failed = 0;
let partial = 0;
const results = [];

function ok(label, condition) {
  if (condition) { passed++; return true; }
  else { failed++; return false; }
}

function partial_(label) { partial++; }

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const networkErrors = [];
  page.on('requestfailed', req => {
    networkErrors.push(`${req.url()} - ${req.failure().errorText}`);
  });

  // 1. Check homepage cards
  console.log('=== 1. HOMEPAGE CARDS ===');
  await page.goto(`${BASE}/toolisto`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const cardHrefs = await page.$$eval('.tool-card', els => els.map(el => el.getAttribute('href')).filter(Boolean));
  console.log(`  Cards found: ${cardHrefs.length}`);

  // 2. Check each tool
  console.log('\n=== 2. TOOL-BY-TOOL VERIFICATION ===\n');

  for (const tool of toolsJson) {
    const report = { id: tool.id, toolId: tool.toolId, slug: tool.slug, checks: {} };

    // 2a. Card exists on homepage (invertido para herramientas en revisión)
    report.checks.card = tool.enabled ? cardHrefs.includes(`./${tool.slug}`) : !cardHrefs.includes(`./${tool.slug}`);

    // 2b. Page exists
    const pagePath = join(DIST, `${tool.slug}.html`);
    report.checks.pageExists = existsSync(pagePath);

    // 2c. toolId in page config
    if (report.checks.pageExists) {
      const pageHtml = readFileSync(pagePath, 'utf8');
      report.checks.configPresent = pageHtml.includes(`"toolId":"${tool.toolId}"`);
      if (!tool.enabled) {
        report.checks.noindex = pageHtml.includes('<meta name="robots" content="noindex, nofollow">');
        report.checks.disabledConfig = pageHtml.includes('"enabled":false');
      }
    }

    // 2d. toolMeta or processor or switch-case
    const hasToolMeta = appJs.includes(`${tool.toolId}:`) || appJs.includes(`'${tool.toolId}':`);
    const hasProcessor = procJs.includes(`ToolProcessors.${tool.toolId}`) || procJs.includes(`ToolProcessors['${tool.toolId}']`);
    const hasSwitchCase = appJs.includes(`case '${tool.toolId}':`);
    report.checks.handler = hasToolMeta || hasProcessor || hasSwitchCase;

    // 2e. Load page and check for errors
    if (report.checks.pageExists) {
      const consoleErrorsBefore = consoleErrors.length;
      try {
        await page.goto(`${BASE}/${tool.slug}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(500);
        report.checks.pageLoads = true;
        report.checks.newConsoleErrors = consoleErrors.length - consoleErrorsBefore;
      } catch (e) {
        report.checks.pageLoads = false;
        report.checks.loadError = e.message;
      }
    }

    // Classify
    const allCritical = report.checks.card && report.checks.pageExists && report.checks.configPresent && report.checks.handler && report.checks.pageLoads;
    const hasErrors = report.checks.newConsoleErrors > 0;

    if (allCritical && !hasErrors) {
      report.status = 'OK';
      passed++;
    } else if (allCritical && hasErrors) {
      report.status = 'PARTIAL';
      partial_(`${tool.toolId}: page loads but has ${report.checks.newConsoleErrors} console errors`);
    } else {
      report.status = 'ERROR';
      failed++;
      const missing = Object.entries(report.checks).filter(([k, v]) => v === false).map(([k]) => k);
      console.error(`  ERROR: ${tool.toolId} - missing: ${missing.join(', ')}`);
    }

    results.push(report);
  }

  // Summary
  console.log('\n=== RESULTS ===');
  console.log(`  Total tools: ${toolsJson.length}`);
  console.log(`  OK: ${results.filter(r => r.status === 'OK').length}`);
  console.log(`  PARTIAL: ${results.filter(r => r.status === 'PARTIAL').length}`);
  console.log(`  ERROR: ${results.filter(r => r.status === 'ERROR').length}`);

  if (consoleErrors.length > 0) {
    console.log(`\n  Console errors during test: ${consoleErrors.length}`);
    const unique = [...new Set(consoleErrors)];
    unique.forEach(e => console.log(`    - ${e.slice(0, 120)}`));
  }
  if (networkErrors.length > 0) {
    console.log(`\n  Network errors: ${networkErrors.length}`);
    [...new Set(networkErrors)].forEach(e => console.log(`    - ${e.slice(0, 120)}`));
  }

  // List errors
  const errors = results.filter(r => r.status === 'ERROR');
  if (errors.length > 0) {
    console.log('\n=== ERRORS ===');
    errors.forEach(r => {
      const missing = Object.entries(r.checks).filter(([k, v]) => v === false).map(([k]) => k);
      console.log(`  ${r.toolId}: ${missing.join(', ')}`);
    });
  }

  const partials = results.filter(r => r.status === 'PARTIAL');
  if (partials.length > 0) {
    console.log('\n=== PARTIAL (page loads but has console errors) ===');
    partials.forEach(r => {
      console.log(`  ${r.toolId}: ${r.checks.newConsoleErrors} console errors`);
    });
  }

  await browser.close();

  console.log(`\n=== FINAL: ${failed === 0 ? 'APROBADO' : `${failed} ERROR(S)`} ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
