import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const tools = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'tools.json'), 'utf8'));

const simplified = tools.map(t => ({
  id: t.id,
  toolId: t.toolId || t.id,
  slug: t.slug || t.id,
  name: t.name || '',
  title: t.title || '',
  description: t.description || '',
  summary: t.summary || '',
  category: t.category || '',
  icon: t.icon || '',
}));

const output = `export const TOOLS_DATA = ${JSON.stringify(simplified, null, 2)};\n`;
writeFileSync(join(ROOT, 'workspace', 'tools-data.js'), output);
console.log(`Generated tools-data.js with ${simplified.length} tools`);
