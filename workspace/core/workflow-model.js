export function createWorkflowModel() {
  let id = 'workflow-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  let name = 'Nuevo flujo';
  let version = 1;
  let createdAt = Date.now();
  let updatedAt = Date.now();
  let inputIds = [];
  let steps = [];
  let stepCounter = 0;

  function _touch() { updatedAt = Date.now(); }

  function _nextStepId() {
    stepCounter++;
    return 'step-' + stepCounter + '-' + Date.now().toString(36);
  }

  function setInputs(ids) {
    inputIds = Array.isArray(ids) ? ids.slice() : [];
    _touch();
  }

  function addStep(operationId, options, index) {
    const step = {
      id: _nextStepId(),
      operationId,
      options: options ? JSON.parse(JSON.stringify(options)) : {},
      enabled: true,
    };
    if (index !== undefined && index >= 0 && index < steps.length) {
      steps.splice(index, 0, step);
    } else {
      steps.push(step);
    }
    _touch();
    return step;
  }

  function removeStep(stepId) {
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return false;
    steps.splice(idx, 1);
    _touch();
    return true;
  }

  function moveStep(stepId, newIndex) {
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx === -1) return false;
    if (newIndex < 0 || newIndex >= steps.length) return false;
    const [step] = steps.splice(idx, 1);
    steps.splice(newIndex, 0, step);
    _touch();
    return true;
  }

  function updateStep(stepId, updates) {
    const step = steps.find(s => s.id === stepId);
    if (!step) return false;
    if (updates.operationId) step.operationId = updates.operationId;
    if (updates.options) step.options = JSON.parse(JSON.stringify(updates.options));
    if (updates.enabled !== undefined) step.enabled = !!updates.enabled;
    _touch();
    return true;
  }

  function enableStep(stepId) {
    return updateStep(stepId, { enabled: true });
  }

  function disableStep(stepId) {
    return updateStep(stepId, { enabled: false });
  }

  function cloneWorkflow() {
    const w = createWorkflowModel();
    w.setInputs(inputIds);
    for (const s of steps) {
      w.addStep(s.operationId, s.options);
    }
    w.setName(name + ' (copia)');
    return w;
  }

  function serializeWorkflow() {
    return {
      id,
      name,
      version,
      createdAt,
      updatedAt,
      inputIds: inputIds.slice(),
      steps: steps.map(s => ({
        id: s.id,
        operationId: s.operationId,
        options: JSON.parse(JSON.stringify(s.options)),
        enabled: s.enabled,
      })),
    };
  }

  function deserializeWorkflow(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.steps || !Array.isArray(data.steps)) return false;
    id = data.id || 'workflow-' + Date.now();
    name = data.name || 'Flujo recuperado';
    version = data.version || 1;
    createdAt = data.createdAt || Date.now();
    updatedAt = data.updatedAt || Date.now();
    inputIds = Array.isArray(data.inputIds) ? data.inputIds.slice() : [];
    steps = data.steps.map(s => ({
      id: s.id || _nextStepId(),
      operationId: s.operationId || '',
      options: (s.options && typeof s.options === 'object') ? JSON.parse(JSON.stringify(s.options)) : {},
      enabled: s.enabled !== false,
    }));
    stepCounter = Math.max(steps.length, stepCounter);
    _touch();
    return true;
  }

  function setName(n) { name = n; _touch(); }
  function setId(newId) { id = newId; _touch(); }
  function getId() { return id; }
  function getName() { return name; }
  function getVersion() { return version; }
  function getCreatedAt() { return createdAt; }
  function getUpdatedAt() { return updatedAt; }
  function getInputIds() { return inputIds.slice(); }
  function getSteps() { return steps.map(s => ({ ...s, options: JSON.parse(JSON.stringify(s.options)) })); }
  function getActiveSteps() { return steps.filter(s => s.enabled).map(s => ({ ...s, options: JSON.parse(JSON.stringify(s.options)) })); }
  function getStep(stepId) { const s = steps.find(x => x.id === stepId); return s ? { ...s, options: JSON.parse(JSON.stringify(s.options)) } : null; }
  function copy() { return cloneWorkflow(); }

  function validateWorkflow(registry) {
    const errors = [];
    const warnings = [];
    if (inputIds.length === 0) errors.push('No input files selected');
    const activeSteps = steps.filter(s => s.enabled);
    if (activeSteps.length === 0) errors.push('No active steps in workflow');
    for (const step of activeSteps) {
      if (!step.operationId) { errors.push('Step "' + step.id + '" has no operation'); continue; }
      if (!registry || !registry.has(step.operationId)) {
        errors.push('Operation "' + step.operationId + '" is not registered');
        continue;
      }
      const op = registry.get(step.operationId);
      if (op.requiresApi && typeof op.requiresApi === 'string') {
        const parts = op.requiresApi.split('.');
        let ctx = typeof window !== 'undefined' ? window : null;
        for (const p of parts) { if (!ctx) break; ctx = ctx[p]; }
        if (!ctx) warnings.push('Required API "' + op.requiresApi + '" not available for step "' + (op.name || step.operationId) + '"');
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  return {
    setInputs, addStep, removeStep, moveStep, updateStep, enableStep, disableStep,
    cloneWorkflow, serializeWorkflow, deserializeWorkflow,
    setName, setId, getName, getId, getVersion, getCreatedAt, getUpdatedAt,
    getInputIds, getSteps, getActiveSteps, getStep, copy,
    validateWorkflow,
  };
}
