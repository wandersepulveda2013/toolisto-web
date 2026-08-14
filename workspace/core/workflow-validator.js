export function createWorkflowValidator(registry) {
  function validateWorkflow(workflow, inputsMap) {
    const errors = [];
    const warnings = [];
    const resolvedSteps = [];

    if (!workflow) {
      return { valid: false, errors: ['No workflow provided'], warnings: [], resolvedSteps: [], estimatedWork: {} };
    }

    const inputIds = workflow.getInputIds ? workflow.getInputIds() : (workflow.inputIds || []);
    if (!inputIds || inputIds.length === 0) {
      errors.push('No input files selected');
    }

    const steps = workflow.getActiveSteps ? workflow.getActiveSteps() : (workflow.steps || []).filter(s => s.enabled !== false);
    if (steps.length === 0) {
      errors.push('No active steps in workflow');
    }

    let prevOutputKind = null;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const op = registry ? registry.get(step.operationId) : null;

      if (!step.operationId) {
        errors.push('Step ' + (i + 1) + ' has no operation selected');
        resolvedSteps.push({ step, error: 'No operation' });
        continue;
      }

      if (!op) {
        errors.push('Step ' + (i + 1) + ': operation "' + step.operationId + '" is not registered');
        resolvedSteps.push({ step, error: 'Not registered', operationId: step.operationId });
        continue;
      }

      if (i === 0 && inputIds.length > 0 && inputsMap) {
        for (const inputId of inputIds) {
          const input = inputsMap[inputId];
          if (input && !op.inputKinds.includes(input.kind)) {
            errors.push('Step 1 ("' + op.name + '"): input "' + (input.name || inputId) + '" is type "' + input.kind + '" but operation expects: ' + op.inputKinds.join(', '));
          }
        }
      }

      if (i > 0 && prevOutputKind && op.inputKinds && !op.inputKinds.includes(prevOutputKind)) {
        errors.push('Step ' + (i + 1) + ' ("' + op.name + '"): expected input ' + op.inputKinds.join(', ') + ' but previous step outputs "' + prevOutputKind + '"');
      }

      if (step.options && op.optionSchema) {
        for (const [key, schema] of Object.entries(op.optionSchema)) {
          if (schema.required && (step.options[key] === undefined || step.options[key] === null || step.options[key] === '')) {
            errors.push('Step ' + (i + 1) + ' ("' + op.name + '"): option "' + key + '" is required');
          }
        }
      }

      if (op.destructive) {
        warnings.push('Step ' + (i + 1) + ' ("' + op.name + '"): destructive operation');
      }

      if (op.supportsBatch === false && inputIds.length > 1) {
        errors.push('Step ' + (i + 1) + ' ("' + op.name + '"): does not support batch processing (' + inputIds.length + ' inputs)');
      }

      if (op.requiresApi && typeof op.requiresApi === 'string') {
        const parts = op.requiresApi.split('.');
        let ctx = typeof window !== 'undefined' ? window : null;
        for (const p of parts) { if (!ctx) break; ctx = ctx[p]; }
        if (!ctx) warnings.push('Step ' + (i + 1) + ' ("' + op.name + '"): required API "' + op.requiresApi + '" is not available');
      }

      prevOutputKind = op.outputKind;
      resolvedSteps.push({ step, operation: op });
    }

    let totalJobs = inputIds.length * resolvedSteps.length;
    let heavyMemory = resolvedSteps.some(r => r.operation && r.operation.category === 'image');
    let multipleOutput = resolvedSteps.some(r => r.operation && r.operation.outputKind === 'multiple');

    const estimatedWork = {
      totalJobs,
      inputCount: inputIds.length,
      stepCount: resolvedSteps.length,
      heavyMemory,
      multipleOutput,
      outputKind: resolvedSteps.length > 0 && resolvedSteps[resolvedSteps.length - 1]?.operation?.outputKind || 'unknown',
    };

    return { valid: errors.length === 0, errors, warnings, resolvedSteps, estimatedWork };
  }

  return { validateWorkflow };
}
