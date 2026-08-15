export function createOperationRegistry() {
  const ops = new Map();

  function validateDescriptor(op) {
    if (!op || typeof op !== 'object') return { valid: false, error: 'Descriptor must be an object' };
    const errors = [];
    if (!op.id || typeof op.id !== 'string') errors.push('id is required and must be a string');
    if (!op.name || typeof op.name !== 'string') errors.push('name is required and must be a string');
    if (!op.description || typeof op.description !== 'string') errors.push('description is required');
    if (!op.category || typeof op.category !== 'string') errors.push('category is required');
    if (!Array.isArray(op.inputKinds) || op.inputKinds.length === 0) errors.push('inputKinds must be a non-empty array');
    if (!op.outputKind || typeof op.outputKind !== 'string') errors.push('outputKind is required');
    if (typeof op.execute !== 'function') errors.push('execute must be a function');
    if (op.inputKinds) {
      for (const k of op.inputKinds) {
        if (!['image','pdf','text','data','document','file','blob','arraybuffer','canvas','capture','multiple'].includes(k)) {
          errors.push('Invalid inputKind: ' + k);
        }
      }
    }
    if (op.outputKind && !['image','pdf','text','data','document','file','blob','arraybuffer','canvas','capture','multiple'].includes(op.outputKind)) {
      errors.push('Invalid outputKind: ' + op.outputKind);
    }
    return { valid: errors.length === 0, error: errors.length ? errors.join('; ') : null, errors };
  }

  function register(op) {
    const v = validateDescriptor(op);
    if (!v.valid) {
      console.warn('[operation-registry] Invalid operation descriptor:', v.error);
      return false;
    }
    if (ops.has(op.id)) {
      console.warn('[operation-registry] Duplicate operation ID:', op.id);
      return false;
    }
    ops.set(op.id, Object.freeze({ ...op }));
    return true;
  }

  function unregister(id) {
    return ops.delete(id);
  }

  function get(id) {
    return ops.get(id) || null;
  }

  function has(id) {
    return ops.has(id);
  }

  function list() {
    return Array.from(ops.values());
  }

  function listCompatible(inputKind) {
    return Array.from(ops.values()).filter(op => op.inputKinds.includes(inputKind));
  }

  function listByCategory(category) {
    return Array.from(ops.values()).filter(op => op.category === category);
  }

  function validate(operationId, input, options) {
    const op = ops.get(operationId);
    if (!op) return { valid: false, error: 'Operation not registered: ' + operationId, warnings: [] };
    const errors = [];
    const warnings = [];
    if (input && !op.inputKinds.includes(input.kind)) {
      errors.push('Input kind "' + input.kind + '" not supported by ' + operationId + ' (expects: ' + op.inputKinds.join(', ') + ')');
    }
    if (options && op.optionSchema) {
      for (const [key, schema] of Object.entries(op.optionSchema)) {
        if (schema.required && (options[key] === undefined || options[key] === null || options[key] === '')) {
          errors.push('Option "' + key + '" is required for ' + operationId);
        }
      }
    }
    if (op.destructive && input?.destructiveConfirm !== true) {
      warnings.push('Operation ' + operationId + ' is destructive');
    }
    if (!op.supportsBatch && Array.isArray(input?.items) && input.items.length > 1) {
      errors.push('Operation ' + operationId + ' does not support batch processing');
    }
    if (op.requiresApi && typeof op.requiresApi === 'string') {
      const parts = op.requiresApi.split('.');
      let ctx = typeof window !== 'undefined' ? window : null;
      for (const p of parts) {
        if (!ctx) break;
        ctx = ctx[p];
      }
      if (!ctx) warnings.push('Required API "' + op.requiresApi + '" is not available');
    }
    return { valid: errors.length === 0, error: errors.length ? errors.join('; ') : null, errors, warnings };
  }

  function clear() {
    ops.clear();
  }

  function count() {
    return ops.size;
  }

  return { register, unregister, get, has, list, listCompatible, listByCategory, validate, clear, count };
}
