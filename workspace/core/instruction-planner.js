import { createWorkflowModel } from './workflow-model.js';

export function createInstructionPlanner(registry) {
  // Maps parser action names to registered operation IDs
  const ACTION_OPS = {
    'ocr': 'image.ocr',
    'enhance': 'image.enhance',
    'resize': 'image.resize',
    'rotate': 'image.rotate',
    'convert': 'image.convert',
    'strip-metadata': 'image.strip-metadata',
    'compress': 'image.compress',
    'to-table': 'text.to-table',
    'to-document': 'text.to-document',
    'report': 'report.create',
    'chart': 'data.to-chart',
    'export-text': 'text.export',
    'merge-pdf': 'pdf.merge',
    'pdf-to-images': 'pdf.to-images',
    'extract-pages': 'pdf.extract-pages',
    'rotate-pdf': 'pdf.rotate',
    'zip': 'output.zip',
    'add-to-workspace': 'output.add-to-workspace',
    'to-pdf': 'image.to-pdf',
  };

  function plan(parsed, inputFiles) {
    const assumptions = [];
    const warnings = [];
    const unresolved = [];
    const workflow = createWorkflowModel();

    if (!parsed || !parsed.intents || parsed.intents.length === 0) {
      return { workflow, confidence: { score: 0, level: 'low' }, assumptions, warnings, unresolved, valid: false };
    }

    // If there are blocking ambiguities, mark as invalid
    if (parsed.ambiguities && parsed.ambiguities.length > 0) {
      for (const amb of parsed.ambiguities) {
        warnings.push(amb.question + ' — selecciona una opción para continuar.');
      }
      return { workflow, confidence: { score: 0.3, level: 'low' }, assumptions, warnings, unresolved, valid: false, ambiguities: parsed.ambiguities };
    }

    // Set input files
    const fileIds = (inputFiles || []).map(f => f.id || f.name || f);
    workflow.setInputs(fileIds);

    let recognizedOps = 0;
    let unrecognizedActions = 0;

    for (const intent of parsed.intents) {
      const opId = ACTION_OPS[intent.action];

      if (!opId) {
        unrecognizedActions++;
        unresolved.push({ action: intent.action, reason: 'No hay operación registrada para esta acción' });
        continue;
      }

      if (!registry.has(opId)) {
        unrecognizedActions++;
        unresolved.push({ action: intent.action, reason: 'La operación "' + opId + '" no está registrada en el sistema', operationId: opId });
        continue;
      }

      const op = registry.get(opId);
      recognizedOps++;

      // Build options from intent, merging with defaults from op.optionSchema
      const options = { ...intent.options };

      // Apply defaults for missing options
      if (op.optionSchema) {
        for (const [key, schema] of Object.entries(op.optionSchema)) {
          if (options[key] === undefined && schema.default !== undefined) {
            options[key] = schema.default;
            if (intent.options[key] === undefined && parsed.intents.length > 0) {
              assumptions.push({ option: key, value: schema.default, message: 'Se usó el valor predeterminado para "' + (schema.label || key) + '": ' + schema.default });
            }
          }
        }
      }

      const step = workflow.addStep(opId, options);
      if (intent.action === 'ocr' && intent.options._extractFields && registry.has('text.invoice-fields')) {
        workflow.addStep('text.invoice-fields', {});
        assumptions.push({ option: '_extractFields', value: true, message: 'La mención de "factura" o "recibo" activa la extracción de campos: se añade el paso "Extraer campos de factura".' });
        recognizedOps++;
      }
      if (intent.options.width && !intent.options.height) {
        assumptions.push({ option: 'height', value: 'auto', message: 'Solo se indicó el ancho. Se usará 800 px de alto manteniendo la proporción.' });
      }
    }

    // Confidence calculation
    const totalIntents = parsed.intents.length;
    const score = totalIntents > 0 ? recognizedOps / (recognizedOps + unrecognizedActions) : 0;
    let level = 'low';
    if (score >= 0.8 && unrecognizedActions === 0 && parsed.warnings.length === 0) level = 'high';
    else if (score >= 0.5) level = 'medium';

    const activeSteps = workflow.getActiveSteps();

    // Validate workflow
    const validation = workflow.validateWorkflow(registry);

    // Add parser warnings
    for (const w of parsed.warnings || []) {
      warnings.push(w);
    }

    // Add unknown words
    if (parsed.unknownSegments && parsed.unknownSegments.length > 0) {
      warnings.push('No se entendieron algunas palabras: ' + parsed.unknownSegments.join(', '));
    }

    // Check file compatibility
    if (inputFiles && inputFiles.length > 0 && activeSteps.length > 0) {
      const firstOp = registry.get(activeSteps[0].operationId);
      if (firstOp) {
        const fileTypes = inputFiles.map(f => (f.type || '').toLowerCase());
        const hasImage = fileTypes.some(t => t.startsWith('image/'));
        const hasPdf = fileTypes.some(t => t === 'application/pdf');
        if (firstOp.inputKinds.includes('image') && !hasImage && !hasPdf) {
          warnings.push('Los archivos seleccionados no parecen compatibles con las operaciones de imagen.');
        }
      }
    }

    const hasErrors = (validation.errors || []).filter(e => !e.includes('No input files') && !e.includes('No active steps')).length > 0;
    return {
      workflow,
      confidence: { score: Math.round(score * 100) / 100, level },
      assumptions,
      warnings,
      unresolved,
      ambiguities: parsed.ambiguities || [],
      valid: !hasErrors && unrecognizedActions < totalIntents,
      validationErrors: validation.errors || [],
    };
  }

  function getRegisteredActionIds() {
    return Object.keys(ACTION_OPS);
  }

  function getRegisteredOperationIds() {
    return Object.values(ACTION_OPS);
  }

  return { plan, getRegisteredActionIds, getRegisteredOperationIds, ACTION_OPS };
}
