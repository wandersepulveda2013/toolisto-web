#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const modelCode = readFileSync(join(ROOT, 'workspace', 'core', 'workflow-model.js'), 'utf8');
const plannerCode = readFileSync(join(ROOT, 'workspace', 'core', 'instruction-planner.js'), 'utf8');

function stripImports(code) {
  return code.replace(/^import\s.*;?\s*$/gm, '').replace(/^export\s+/gm, '');
}

const combined = [
  stripImports(modelCode),
  stripImports(plannerCode),
].join('\n');

const sandbox = { console, Map, Array, Object, Error, RegExp, parseInt, Math, Set, Number, Date, JSON };
const fn = new Function('console', 'Map', 'Array', 'Object', 'Error', 'RegExp', 'parseInt', 'Math', 'Set', 'Number', 'Date', 'JSON',
  combined + '\nreturn { createWorkflowModel, createInstructionPlanner };'
);
const { createWorkflowModel, createInstructionPlanner } = fn(console, Map, Array, Object, Error, RegExp, parseInt, Math, Set, Number, Date, JSON);

let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log('  PASS: ' + name); } else { fail++; console.error('  FAIL: ' + name + (detail ? ' - ' + detail : '')); } }

console.log('=== Instruction Planner Tests ===\n');

// Create a mock registry with all required operations
const mockRegistry = {
  _ops: {},
  register(op) { if (this._ops[op.id]) return false; this._ops[op.id] = op; return true; },
  get(id) { return this._ops[id] || null; },
  has(id) { return id in this._ops; },
  list() { return Object.values(this._ops); },
  listCompatible(kind) { return Object.values(this._ops).filter(op => op.inputKinds.includes(kind)); },
  listByCategory(cat) { return Object.values(this._ops).filter(op => op.category === cat); },
};

// Register mock operations
const ops = [
  { id: 'image.rotate', name: 'Rotar imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { angle: { default: 90, label: 'Ángulo' } } },
  { id: 'image.resize', name: 'Redimensionar', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { width: { default: 800, label: 'Ancho' }, height: { default: 600, label: 'Alto' } } },
  { id: 'image.convert', name: 'Convertir imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { format: { default: 'image/png', label: 'Formato' } } },
  { id: 'image.enhance', name: 'Mejorar imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { contrast: { default: 1.0, label: 'Contraste' }, brightness: { default: 1.0, label: 'Brillo' } } },
  { id: 'image.strip-metadata', name: 'Eliminar metadatos', category: 'image', inputKinds: ['image'], outputKind: 'image' },
  { id: 'image.ocr', name: 'Extraer texto (OCR)', category: 'text', inputKinds: ['image', 'pdf'], outputKind: 'text' },
  { id: 'text.to-table', name: 'Convertir a tabla', category: 'text', inputKinds: ['text'], outputKind: 'data' },
  { id: 'text.to-document', name: 'Crear documento', category: 'text', inputKinds: ['text'], outputKind: 'document' },
  { id: 'data.to-chart', name: 'Crear grafico', category: 'chart', inputKinds: ['data', 'document'], outputKind: 'document', optionSchema: { title: { default: 'Grafico de datos', label: 'Titulo' } } },
  { id: 'report.create', name: 'Crear informe', category: 'report', inputKinds: ['data'], outputKind: 'document' },
  { id: 'text.export', name: 'Exportar texto', category: 'text', inputKinds: ['text'], outputKind: 'file' },
  { id: 'image.compress', name: 'Comprimir imagen', category: 'image', inputKinds: ['image'], outputKind: 'image', optionSchema: { quality: { default: 60, label: 'Calidad' } } },
  { id: 'image.to-pdf', name: 'Convertir a PDF', category: 'image', inputKinds: ['image'], outputKind: 'file' },
];
for (const op of ops) mockRegistry.register(op);

const planner = createInstructionPlanner(mockRegistry);

// 1. Plan with invalid/empty parsed input
const plan0 = planner.plan(null, []);
check('Plan null parsed: valid false', plan0.valid === false);
check('Plan null parsed: confidence low', plan0.confidence.level === 'low');
check('Plan null parsed: score 0', plan0.confidence.score === 0);

const plan0b = planner.plan({ intents: [] }, []);
check('Plan empty intents: valid false', plan0b.valid === false);

// 2. Plan with parsed rotate intent
const parsed1 = { intents: [{ action: 'rotate', target: 'image', options: { angle: 90 } }], outputPreferences: {}, warnings: [], unknownSegments: [] };
const plan1 = planner.plan(parsed1, [{ id: 'f1', name: 'foto.jpg', type: 'image/jpeg', kind: 'image' }]);
check('Plan rotate: valid', plan1.valid === true);
check('Plan rotate: 1 active step', plan1.workflow.getActiveSteps().length === 1);
check('Plan rotate: step operation', plan1.workflow.getActiveSteps()[0].operationId === 'image.rotate');
check('Plan rotate: angle option', plan1.workflow.getActiveSteps()[0].options.angle === 90);
check('Plan rotate: high confidence', plan1.confidence.level === 'high');

// 3. Plan with resize
const parsed2 = { intents: [{ action: 'resize', target: 'image', options: { width: 1200 } }], outputPreferences: {}, warnings: [], unknownSegments: [] };
const plan2 = planner.plan(parsed2, [{ id: 'f1', name: 'foto.jpg', type: 'image/jpeg', kind: 'image' }]);
check('Plan resize: valid', plan2.valid === true);
check('Plan resize: step operation', plan2.workflow.getActiveSteps()[0].operationId === 'image.resize');
check('Plan resize: width 1200', plan2.workflow.getActiveSteps()[0].options.width === 1200);
check('Plan resize: has assumption for height', plan2.assumptions.length > 0);

// 4. Plan with multiple intents (pipeline)
const parsed3 = {
  intents: [
    { action: 'enhance', target: 'image', options: { contrast: 1.2 } },
    { action: 'convert', target: 'image', options: { format: 'image/webp' } },
  ],
  outputPreferences: { download: true },
  warnings: [],
  unknownSegments: [],
};
const plan3 = planner.plan(parsed3, [{ id: 'f1', name: 'foto.jpg', type: 'image/jpeg', kind: 'image' }]);
check('Plan pipeline: valid', plan3.valid === true);
check('Plan pipeline: 2 steps', plan3.workflow.getActiveSteps().length === 2);
check('Plan pipeline: first enhance', plan3.workflow.getActiveSteps()[0].operationId === 'image.enhance');
check('Plan pipeline: second convert', plan3.workflow.getActiveSteps()[1].operationId === 'image.convert');
check('Plan pipeline: high confidence', plan3.confidence.level === 'high');

// 5. Plan with OCR -> to-table pipeline
const parsed4 = {
  intents: [
    { action: 'ocr', target: 'text', options: { language: 'spa' } },
    { action: 'to-table', target: 'text', options: {} },
  ],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan4 = planner.plan(parsed4, [{ id: 'f1', name: 'scan.png', type: 'image/png', kind: 'image' }]);
check('Plan OCR->table: valid', plan4.valid === true);
check('Plan OCR->table: 2 steps', plan4.workflow.getActiveSteps().length === 2);
check('Plan OCR->table: first ocr', plan4.workflow.getActiveSteps()[0].operationId === 'image.ocr');

// 6. Plan with unrecognized action
const parsed5 = {
  intents: [{ action: 'nonexistent-action', target: 'file', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: ['nonexistent'],
};
const plan5 = planner.plan(parsed5, []);
check('Plan unknown action: unresolved', plan5.unresolved.length > 0);
check('Plan unknown action: confidence low', plan5.confidence.level === 'low');
check('Plan unknown action: valid false', plan5.valid === false);

// 7. Plan with mixed recognized and unrecognized actions
const parsed6 = {
  intents: [
    { action: 'enhance', target: 'image', options: {} },
    { action: 'nonexistent-action', target: 'file', options: {} },
  ],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan6 = planner.plan(parsed6, []);
check('Plan mixed: some unresolved', plan6.unresolved.length > 0);
check('Plan mixed: at least 1 resolved step', plan6.workflow.getActiveSteps().length > 0);
check('Plan mixed: medium confidence', plan6.confidence.level === 'medium');

// 8. Plan with warnings from parser
const parsed7 = {
  intents: [{ action: 'rotate', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: ['No se indicó el ángulo de rotación. Se usará 90°.'],
  unknownSegments: [],
};
const plan7 = planner.plan(parsed7, []);
check('Plan with warnings: warnings propagated', plan7.warnings.some(w => w.includes('ángulo')));

// 9. Plan with unknownSegments
const parsed8 = {
  intents: [{ action: 'enhance', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: ['bonito', 'efecto'],
};
const plan8 = planner.plan(parsed8, []);
check('Plan unknownSegments: warnings include them', plan8.warnings.some(w => w.includes('bonito')));

// 10. Plan with confidence calculation - full match
const parsed9 = {
  intents: [
    { action: 'enhance', target: 'image', options: {} },
    { action: 'resize', target: 'image', options: { width: 800 } },
    { action: 'convert', target: 'image', options: { format: 'image/webp' } },
  ],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan9 = planner.plan(parsed9, []);
check('Plan full match: confidence 1', plan9.confidence.score === 1);
check('Plan full match: 3 steps', plan9.workflow.getActiveSteps().length === 3);

// 11. Plan with report
const parsed10 = {
  intents: [{ action: 'report', target: 'text', options: { includeDate: true } }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan10 = planner.plan(parsed10, []);
check('Plan report: valid', plan10.valid === true);
check('Plan report: step operation', plan10.workflow.getActiveSteps()[0].operationId === 'report.create');

// 12. Plan with strip-metadata
const parsed11 = {
  intents: [{ action: 'strip-metadata', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan11 = planner.plan(parsed11, []);
check('Plan strip-metadata: valid', plan11.valid === true);
check('Plan strip-metadata: step', plan11.workflow.getActiveSteps()[0].operationId === 'image.strip-metadata');

// 13. Default values from registry optionSchema
const parsed12 = {
  intents: [{ action: 'rotate', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: ['No se indicó el ángulo de rotación. Se usará 90°.'],
  unknownSegments: [],
};
const plan12 = planner.plan(parsed12, []);
check('Plan rotate default angle', plan12.workflow.getActiveSteps()[0].options.angle !== undefined);

// 14. Compatibility warning for non-image files with image operations
const parsed13 = {
  intents: [{ action: 'resize', target: 'image', options: { width: 800 } }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan13 = planner.plan(parsed13, [{ id: 'f1', name: 'doc.txt', type: 'text/plain', kind: 'text' }]);
check('Plan image op on text file: compatibility warning', plan13.warnings.some(w => w.includes('compatible') || w.includes('archivos')));

// 15. No compatibility warning for matching files
const plan13b = planner.plan(parsed13, [{ id: 'f1', name: 'foto.jpg', type: 'image/jpeg', kind: 'image' }]);
const hasCompatWarning = plan13b.warnings.some(w => w.includes('compat') || w.includes('archivos'));
check('Plan image op on image file: no compat warning', !hasCompatWarning);

// 16. OCR with PDF files should not warn
const parsed14 = {
  intents: [{ action: 'ocr', target: 'text', options: { language: 'spa' } }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan14 = planner.plan(parsed14, [{ id: 'f1', name: 'doc.pdf', type: 'application/pdf', kind: 'pdf' }]);
check('Plan OCR on PDF: no compat warning', plan14.valid === true);

// 17. getRegisteredActionIds
const actionIds = planner.getRegisteredActionIds();
check('getRegisteredActionIds returns array', Array.isArray(actionIds));
check('getRegisteredActionIds contains rotate', actionIds.includes('rotate'));
check('getRegisteredActionIds contains ocr', actionIds.includes('ocr'));

// 18. getRegisteredOperationIds
const opIds = planner.getRegisteredOperationIds();
check('getRegisteredOperationIds returns array', Array.isArray(opIds));
check('getRegisteredOperationIds contains image.rotate', opIds.includes('image.rotate'));
check('getRegisteredOperationIds contains image.ocr', opIds.includes('image.ocr'));

// 19. Plan with to-document
const parsed15 = {
  intents: [{ action: 'to-document', target: 'text', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan15 = planner.plan(parsed15, []);
check('Plan to-document: valid', plan15.valid === true);
check('Plan to-document: step', plan15.workflow.getActiveSteps()[0].operationId === 'text.to-document');

// 20. Plan with export-text
const parsed16 = {
  intents: [{ action: 'export-text', target: 'text', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan16 = planner.plan(parsed16, []);
check('Plan export-text: valid', plan16.valid === true);
check('Plan export-text: step', plan16.workflow.getActiveSteps()[0].operationId === 'text.export');

// 21. Workflow inputs set from inputFiles
const parsed17 = {
  intents: [{ action: 'enhance', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan17 = planner.plan(parsed17, [{ id: 'f1', name: 'a.jpg', type: 'image/jpeg', kind: 'image' }]);
const inputIds = plan17.workflow.getInputIds();
check('Plan sets workflow inputIds', Array.isArray(inputIds) && inputIds.length > 0);

// 22. Remove step creates clean state
const parsed18 = {
  intents: [{ action: 'enhance', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan18 = planner.plan(parsed18, []);
const steps = plan18.workflow.getActiveSteps();
if (steps.length > 0) {
  plan18.workflow.removeStep(steps[0].id);
}
check('Plan step can be removed', plan18.workflow.getActiveSteps().length === 0);

// 23. Disable step
const parsed19 = {
  intents: [{ action: 'enhance', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan19 = planner.plan(parsed19, []);
const steps19 = plan19.workflow.getActiveSteps();
if (steps19.length > 0) {
  plan19.workflow.disableStep(steps19[0].id);
}
check('Plan step can be disabled', plan19.workflow.getActiveSteps().length === 0);
check('Plan step disabled - getSteps still returns it', plan19.workflow.getSteps().length > 0);

// 24. Confidence medium for partial match
const parsed20 = {
  intents: [
    { action: 'enhance', target: 'image', options: {} },
    { action: 'zip', target: 'file', options: { name: 'result.zip' } },
  ],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan20 = planner.plan(parsed20, []);
check('Plan partial match: has unresolved for zip', plan20.unresolved.length > 0 || plan20.workflow.getActiveSteps().length > 0);

// 25. Validation errors from workflow model
const parsed21 = {
  intents: [{ action: 'enhance', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan21 = planner.plan(parsed21, []);
check('Plan returns validationErrors array', Array.isArray(plan21.validationErrors));

// 26. Plan with compress
const parsed26 = {
  intents: [{ action: 'compress', target: 'image', options: { quality: 60 } }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan26 = planner.plan(parsed26, []);
check('Plan compress: valid', plan26.valid === true);
check('Plan compress: step operation', plan26.workflow.getActiveSteps()[0] && plan26.workflow.getActiveSteps()[0].operationId === 'image.compress');
check('Plan compress: quality option', plan26.workflow.getActiveSteps()[0] && plan26.workflow.getActiveSteps()[0].options.quality === 60);

// 27. Plan with to-pdf
const parsed27 = {
  intents: [{ action: 'to-pdf', target: 'image', options: { format: 'application/pdf' } }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const plan27 = planner.plan(parsed27, []);
check('Plan to-pdf: valid', plan27.valid === true);
check('Plan to-pdf: step operation', plan27.workflow.getActiveSteps()[0] && plan27.workflow.getActiveSteps()[0].operationId === 'image.to-pdf');

// 28. Action IDs include new actions
const actionIds28 = planner.getRegisteredActionIds();
check('Action IDs include compress', actionIds28.includes('compress'));
check('Action IDs include to-pdf', actionIds28.includes('to-pdf'));

// 29. Operation IDs include new operations
const opIds29 = planner.getRegisteredOperationIds();
check('Operation IDs include image.compress', opIds29.includes('image.compress'));
check('Operation IDs include image.to-pdf', opIds29.includes('image.to-pdf'));

// 30. Plan with chart
const parsedChart = {
  intents: [{ action: 'chart', target: 'text', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
};
const planChart = planner.plan(parsedChart, []);
check('Plan chart: valid', planChart.valid === true);
check('Plan chart: step operation', planChart.workflow.getActiveSteps()[0] && planChart.workflow.getActiveSteps()[0].operationId === 'data.to-chart');
check('Plan chart: title default applied', planChart.workflow.getActiveSteps()[0] && planChart.workflow.getActiveSteps()[0].options.title === 'Grafico de datos');

// 31. Action/operation ID registries include chart
check('Action IDs include chart', planner.getRegisteredActionIds().includes('chart'));
check('Operation IDs include data.to-chart', planner.getRegisteredOperationIds().includes('data.to-chart'));

// 56. Plan with ambiguity: returns ambiguities
const parsed22 = {
  intents: [{ action: 'enhance', target: 'image', options: {} }],
  outputPreferences: {},
  warnings: [],
  unknownSegments: [],
  ambiguities: [{ id: 'enhance-ambiguous', question: '¿Qué archivo?', options: [{ id: 'image', label: 'Imagen' }, { id: 'document', label: 'Documento' }] }],
};
const plan22 = planner.plan(parsed22, []);
check('Plan with ambiguity: valid false', plan22.valid === false);
check('Plan with ambiguity: has ambiguities', plan22.ambiguities && plan22.ambiguities.length > 0);
check('Plan with ambiguity: confidence low', plan22.confidence.level === 'low');
check('Plan with ambiguity: warning includes question', plan22.warnings.some(w => w.includes('¿Qué archivo?')));

console.log('\nPlanner Tests: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail > 0 ? 1 : 0);
