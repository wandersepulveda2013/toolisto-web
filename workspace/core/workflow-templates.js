/**
 * core/workflow-templates.js — Built-in workflow templates.
 *
 * Each template is a serialized workflow-model snapshot that can be loaded
 * into the workflow UI with one click.
 */

export const WORKFLOW_TEMPLATES = [
  {
    id: 'template-ocr-to-doc',
    name: 'OCR a documento',
    description: 'Extrae texto de una imagen y lo convierte en un documento editable.',
    category: 'Texto',
    steps: [
      { operationId: 'image.ocr', options: { language: 'spa' }, enabled: true },
      { operationId: 'text.to-document', options: {}, enabled: true },
    ],
  },
  {
    id: 'template-rotate-compress',
    name: 'Rotar y comprimir',
    description: 'Rota una imagen y la comprime para reducir tamano.',
    category: 'Imagen',
    steps: [
      { operationId: 'image.rotate', options: { angle: 90 }, enabled: true },
      { operationId: 'image.compress', options: { quality: 80 }, enabled: true },
    ],
  },
  {
    id: 'template-ocr-to-table',
    name: 'OCR a tabla',
    description: 'Extrae texto de una imagen y lo convierte en una tabla de datos.',
    category: 'Datos',
    steps: [
      { operationId: 'image.ocr', options: { language: 'spa' }, enabled: true },
      { operationId: 'text.to-table', options: {}, enabled: true },
    ],
  },
  {
    id: 'template-batch-resize',
    name: 'Redimensionar lote',
    description: 'Redimensiona multiples imagenes a un ancho fijo.',
    category: 'Imagen',
    steps: [
      { operationId: 'image.resize', options: { width: 800 }, enabled: true },
    ],
  },
  {
    id: 'template-ocr-compress',
    name: 'OCR y comprimir',
    description: 'Extrae texto y comprime la imagen original.',
    category: 'Mixto',
    steps: [
      { operationId: 'image.ocr', options: { language: 'spa' }, enabled: true },
      { operationId: 'image.compress', options: { quality: 70 }, enabled: true },
    ],
  },
];

export function getTemplateById(id) {
  return WORKFLOW_TEMPLATES.find(t => t.id === id) || null;
}

export function getTemplatesByCategory(category) {
  if (!category || category === 'all') return WORKFLOW_TEMPLATES.slice();
  return WORKFLOW_TEMPLATES.filter(t => t.category === category);
}
