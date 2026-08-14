import { createWorkflowModel } from './workflow-model.js';
import { createWorkflowEngine } from './workflow-engine.js';
import { releaseOcrEngine } from './ocr-engine.js';

// Convierte un texto plano (p. ej. la salida OCR de image.ocr o una exportación)
// en un documento Toolisto compuesto por bloques, con un id estable derivado del
// contenido para que readicionar el mismo resultado no duplique el documento.
function textResultToDocument(name, text) {
  const blocks = String(text).split('\n').map((line, i) => {
    const v = line.trim();
    if (/^###\s+/.test(v)) return { type: 'heading3', content: v.replace(/^###\s+/, ''), id: 'b-' + i };
    if (/^##\s+/.test(v)) return { type: 'heading2', content: v.replace(/^##\s+/, ''), id: 'b-' + i };
    if (/^#\s+/.test(v)) return { type: 'heading1', content: v.replace(/^#\s+/, ''), id: 'b-' + i };
    if (/^[-*]\s+/.test(v)) return { type: 'bullet-list', content: v.replace(/^[-*]\s+/, ''), id: 'b-' + i };
    return { type: 'paragraph', content: line, id: 'b-' + i };
  });
  let h = 0;
  const seed = (name || '') + '\u0000' + text;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return { id: 'flow-text-' + h.toString(36), name, title: name, type: 'document', blocks };
}

export function createWorkflowUI(registry, appHelpers) {
  const { h, svgIcon, appStore, toast, showModal, closeModal, pushHistory, createInstructionAssistant, reportError, showWarning, saveDoc, saveData, saveImageCapture, refreshProjectCounts, resolveCaptureImage } = appHelpers;
  let instructionAssistant = null;
  let autoExecute = false;
  let workflow = createWorkflowModel();
  let engine = null;
  let inputs = {};
  let inputFiles = [];
  let currentResults = null;
  let inputEl = null;
  let stepListEl = null;
  let planPreviewEl = null;
  let monitorEl = null;
  let resultsEl = null;
  let opSearchEl = null;
  let opListEl = null;
  let executeBtn = null;
  let addOpBtn = null;
  let cleanupBtn = null;
  let execStateEl = null;
  let activeCategory = 'all';
  let categoryButtons = [];

  function render(container) {
    container.replaceChildren();
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '16px';
    container.style.padding = '16px';
    container.style.height = '100%';
    container.style.overflow = 'auto';

    const header = h('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:4px' });
    header.appendChild(h('h2', { style: 'margin:0;font-size:16px' }, 'Constructor de flujos'));
    header.appendChild(h('span', { style: 'font-size:11px;color:var(--ws-text-secondary)', 'aria-live': 'polite' }, 'Selecciona archivos, anade operaciones y ejecuta'));
    container.appendChild(header);

    // Main layout: 2 columns
    const mainRow = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0' });

    // Left column: inputs + instruction assistant + steps
    const leftCol = h('div', { style: 'display:flex;flex-direction:column;gap:12px;overflow:hidden' });
    renderInputsSection(leftCol);
    renderInstructionAssistant(leftCol);
    renderStepsSection(leftCol);
    mainRow.appendChild(leftCol);

    // Right column: plan + monitor + results
    const rightCol = h('div', { style: 'display:flex;flex-direction:column;gap:12px;overflow:hidden' });
    renderPlanPreview(rightCol);
    renderMonitor(rightCol);
    renderResults(rightCol);
    mainRow.appendChild(rightCol);

    container.appendChild(mainRow);

    // Bottom bar
    const bottomBar = h('div', { style: 'display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--ws-border)' });
    executeBtn = h('button', {
      className: 'ws-btn ws-btn-primary', disabled: true,
      'aria-label': 'Ejecutar flujo', 'aria-disabled': 'true',
      onClick: () => executeFlow(),
    }, svgIcon('play', 14), ' Ejecutar flujo');
    bottomBar.appendChild(executeBtn);

    cleanupBtn = h('button', {
      className: 'ws-btn ws-btn-ghost',
      disabled: true,
      onClick: () => clearFlow(),
    }, ' Limpiar');
    bottomBar.appendChild(cleanupBtn);
    bottomBar.appendChild(h('span', { style: 'flex:1' }));

    execStateEl = h('span', { style: 'font-size:12px;color:var(--ws-text-secondary)', 'aria-live': 'polite' }, 'Listo');
    bottomBar.appendChild(execStateEl);
    container.appendChild(bottomBar);
  }

  function renderInputsSection(parent) {
    const section = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px' });
    section.appendChild(h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:8px' }, 'Archivos de entrada'));

    inputEl = h('div', { style: 'font-size:12px;color:var(--ws-text-secondary);margin-bottom:8px' }, 'Ningun archivo seleccionado');
    section.appendChild(inputEl);

    const fileInput = h('input', { type: 'file', multiple: true, style: 'display:none', id: 'wf-file-input' });
    fileInput.addEventListener('change', () => {
      const files = [...(fileInput.files || [])];
      if (files.length) addFiles(files);
      fileInput.value = '';
    });
    section.appendChild(fileInput);

    const btnRow = h('div', { style: 'display:flex;gap:4px' });
    btnRow.appendChild(h('button', {
      className: 'ws-btn ws-btn-sm ws-btn-secondary',
      onClick: () => { const fi = parent.querySelector('#wf-file-input') || fileInput; fi.click(); },
    }, svgIcon('plus', 12), ' Seleccionar archivos'));
    btnRow.appendChild(h('button', {
      className: 'ws-btn ws-btn-sm ws-btn-ghost',
      onClick: () => selectFromWorkspace(),
    }, svgIcon('folder', 12), ' Desde Workspace'));
    section.appendChild(btnRow);
    parent.appendChild(section);
  }

  function renderInstructionAssistant(parent) {
    if (!createInstructionAssistant) return;
    const section = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px' });
    section.appendChild(h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:8px' }, 'Asistente de flujos'));

    const assistantContainer = h('div');
    section.appendChild(assistantContainer);
    parent.appendChild(section);

    if (!instructionAssistant) {
      instructionAssistant = createInstructionAssistant(registry, appHelpers);
      instructionAssistant.onUseFlow((planResult, inputFiles, editMode) => {
        // Sync auto-execute mode from assistant checkbox
        autoExecute = instructionAssistant.getAutoExecute ? instructionAssistant.getAutoExecute() : false;
        usePlannedFlow(planResult, editMode);
        if (pushHistory) pushHistory({ action: editMode ? 'flow-edit-from-instruction' : 'flow-from-instruction', steps: planResult.workflow.getActiveSteps().length });
      });
      // Restore saved auto-execute preference
      try {
        const saved = localStorage.getItem('toolisto-auto-execute');
        if (saved === 'true' && instructionAssistant.setAutoExecute) {
          instructionAssistant.setAutoExecute(true);
          autoExecute = true;
        }
      } catch(e) {}
    }
    instructionAssistant.render(assistantContainer, getInputFileMeta());
    instructionAssistant.updateSuggestions(getInputFileMeta());
    // Restore persisted state
    if (instructionAssistant.restoreState) instructionAssistant.restoreState(getInputFileMeta());
  }

  function getInputFileMeta() {
    return Object.values(inputs).map(inp => ({
      name: inp.name,
      type: inp.type || '',
      kind: inp.kind || '',
    }));
  }

  function usePlannedFlow(planResult, editMode) {
    if (!planResult || !planResult.workflow) return;
    const activeSteps = planResult.workflow.getActiveSteps();
    if (activeSteps.length === 0) {
      toast('No hay pasos en el flujo planificado', 'warning');
      return;
    }
    const existingSteps = workflow.getSteps();
    for (const step of existingSteps) {
      workflow.removeStep(step.id);
    }
    // Re-add inputs from flow plan's inputs if available
    if (planResult.workflow.getInputs) {
      const planInputs = planResult.workflow.getInputs();
      if (planInputs && planInputs.length > 0 && Object.keys(inputs).length === 0) {
        workflow.setInputs(planInputs);
      }
    }
    for (const step of activeSteps) {
      const op = registry.get(step.operationId);
      if (op) {
        workflow.addStep(step.operationId, { ...step.options });
      }
    }
    renderStepList();
    updatePlan();
    updateExecuteBtn();
    const msg = 'Flujo generado desde instruccion: ' + activeSteps.length + ' paso(s)' + (editMode ? ' — editando pasos' : '');
    toast(msg, 'success');
    if (editMode) {
      const stepListEl = document.getElementById('ws-step-list');
      if (stepListEl) stepListEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    // Auto-execute if mode is enabled and there are inputs
    if (!editMode && autoExecute && Object.keys(inputs).length > 0) {
      // Wait a tick for the DOM to update, then execute
      setTimeout(() => executeFlow(), 100);
    }
  }

  function setAutoExecute(enabled) {
    autoExecute = enabled;
  }

  function renderStepsSection(parent) {
    const section = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px;flex:1;display:flex;flex-direction:column;overflow:hidden' });
    const headerRow = h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' });
    headerRow.appendChild(h('div', { style: 'font-weight:600;font-size:13px' }, 'Pasos del flujo'));
    addOpBtn = h('button', {
      className: 'ws-btn ws-btn-sm ws-btn-secondary',
      onClick: () => toggleOpSelector(),
    }, svgIcon('plus', 12), ' Anadir operacion');
    headerRow.appendChild(addOpBtn);
    section.appendChild(headerRow);

    // Op search/add panel
    opListEl = h('div', { style: 'display:none;border:1px solid var(--ws-border);border-radius:6px;padding:8px;margin-bottom:8px;max-height:200px;overflow-y:auto;background:var(--ws-bg)' });

    opSearchEl = h('input', {
      type: 'text', className: 'ws-form-input', placeholder: 'Buscar operacion...',
      'aria-label': 'Buscar operacion por nombre o descripcion',
      style: 'width:100%;margin-bottom:6px;font-size:12px',
      onInput: () => renderOpList(),
    });
    opListEl.appendChild(opSearchEl);

    const catFilter = h('div', { style: 'display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap', 'aria-label': 'Filtrar por categoria' });
    const categories = ['all', 'image', 'text', 'report', 'chart', 'pdf', 'output'];
    categoryButtons = [];
    for (const cat of categories) {
      const btn = h('button', {
        className: 'ws-btn ws-btn-xs' + (cat === activeCategory ? ' ws-btn-primary' : ' ws-btn-ghost'),
        style: 'font-size:10px;padding:2px 6px',
        'aria-pressed': cat === activeCategory ? 'true' : 'false',
        onClick: () => {
          activeCategory = cat;
          categoryButtons.forEach(({ category, button }) => {
            button.className = 'ws-btn ws-btn-xs ' + (category === activeCategory ? 'ws-btn-primary' : 'ws-btn-ghost');
            button.setAttribute('aria-pressed', category === activeCategory ? 'true' : 'false');
          });
          renderOpList();
        },
      }, { all: 'Todas', image: 'Imagen', text: 'Texto', report: 'Informe', chart: 'Grafico', pdf: 'PDF', output: 'Salida' }[cat] || cat);
      categoryButtons.push({ category: cat, button: btn });
      catFilter.appendChild(btn);
    }
    opListEl.appendChild(catFilter);

    const opResults = h('div', { id: 'wf-op-results' });
    opListEl.appendChild(opResults);
    section.appendChild(opListEl);

    stepListEl = h('div', {
      id: 'wf-step-list',
      style: 'flex:1;overflow-y:auto;min-height:100px',
    });
    stepListEl.appendChild(h('div', { style: 'font-size:12px;color:var(--ws-text-tertiary);padding:16px;text-align:center' }, 'Anade operaciones para comenzar'));
    section.appendChild(stepListEl);
    parent.appendChild(section);
  }

  function renderPlanPreview(parent) {
    const section = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px' });
    section.appendChild(h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:8px' }, 'Resumen del plan'));
    planPreviewEl = h('div', { style: 'font-size:12px;color:var(--ws-text-secondary);min-height:40px' }, 'Configura archivos y pasos para ver el resumen.');
    section.appendChild(planPreviewEl);
    parent.appendChild(section);
  }

  function renderMonitor(parent) {
    const section = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px;display:none' });
    section.id = 'wf-monitor-section';
    section.appendChild(h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:8px' }, 'Ejecucion'));
    monitorEl = h('div', { style: 'font-size:12px', role: 'log', 'aria-label': 'Progreso de la ejecucion', 'aria-live': 'polite' });
    section.appendChild(monitorEl);
    parent.appendChild(section);
  }

  function renderResults(parent) {
    const section = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px;display:none' });
    section.id = 'wf-results-section';
    section.appendChild(h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:8px' }, 'Resultados'));
    resultsEl = h('div', { style: 'font-size:12px' });
    section.appendChild(resultsEl);
    parent.appendChild(section);
  }

  function renderOpList() {
    const container = opListEl.querySelector('#wf-op-results');
    if (!container) return;
    container.replaceChildren();
    const q = (opSearchEl ? opSearchEl.value : '').toLowerCase().trim();
    let ops = registry.list().filter(isOperationCompatible);
    if (activeCategory !== 'all') ops = ops.filter(op => op.category === activeCategory);
    if (q) ops = ops.filter(op => op.name.toLowerCase().includes(q) || op.id.toLowerCase().includes(q) || op.description.toLowerCase().includes(q));
    if (ops.length === 0) {
      const hasInputs = Object.keys(inputs).length > 0;
      container.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-tertiary);padding:8px;text-align:center' }, hasInputs ? 'No hay operaciones compatibles con este paso' : 'Selecciona una entrada para ver operaciones compatibles'));
      return;
    }
    for (const op of ops) {
      const row = h('div', {
        style: 'display:flex;align-items:center;gap:6px;padding:6px 4px;border-radius:4px;cursor:pointer',
        role: 'button',
        tabindex: 0,
        'aria-label': 'Anadir operacion ' + op.name,
        onMouseEnter: (e) => e.currentTarget.style.background = 'var(--ws-bg-secondary)',
        onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
        onClick: () => { addOperation(op.id); hideOpSelector(); },
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addOperation(op.id); hideOpSelector(); }
        },
      });
      const iconMap = { image: 'camera', text: 'doc', report: 'file', chart: 'chart', pdf: 'file' };
      row.appendChild(h('span', { style: 'opacity:0.6;display:flex' }, svgIcon(iconMap[op.category] || 'tool', 14)));
      row.appendChild(h('div', { style: 'flex:1' },
        h('div', { style: 'font-size:12px;font-weight:500' }, op.name),
        h('div', { style: 'font-size:10px;color:var(--ws-text-tertiary)' }, op.description),
      ));
      container.appendChild(row);
    }
  }

  function isOperationCompatible(op) {
    const activeSteps = workflow.getActiveSteps();
    const inputKinds = activeSteps.length > 0
      ? [registry.get(activeSteps[activeSteps.length - 1].operationId)?.outputKind]
      : [...new Set(Object.values(inputs).map(input => input.kind).filter(Boolean))];
    if (inputKinds.length === 0) return true;
    return inputKinds.every(kind => op.inputKinds.includes(kind) || (op.inputKinds.includes('multiple') && inputKinds.length > 1));
  }

  function toggleOpSelector() {
    if (opListEl) {
      const shown = opListEl.style.display !== 'none';
      opListEl.style.display = shown ? 'none' : 'block';
      if (!shown) renderOpList();
    }
  }

  function hideOpSelector() {
    if (opListEl) opListEl.style.display = 'none';
  }

  function addOperation(opId) {
    const op = registry.get(opId);
    if (!op) { toast('Operacion no disponible', 'warning'); return; }
    const step = workflow.addStep(opId, defaultOptions(op));
    renderStepList();
    updatePlan();
    updateExecuteBtn();
    toast('Anadido: ' + op.name, 'success');
  }

  function defaultOptions(op) {
    const options = {};
    for (const [key, schema] of Object.entries(op.optionSchema || {})) {
      if (schema.default !== undefined) options[key] = schema.default;
    }
    return options;
  }

  function renderStepList() {
    if (!stepListEl) return;
    stepListEl.replaceChildren();
    const steps = workflow.getSteps();
    if (steps.length === 0) {
      stepListEl.appendChild(h('div', { style: 'font-size:12px;color:var(--ws-text-tertiary);padding:16px;text-align:center' }, 'Anade operaciones para comenzar'));
      return;
    }
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const op = registry.get(step.operationId);
      const row = h('div', {
        style: 'display:flex;align-items:center;gap:6px;padding:8px;border:1px solid var(--ws-border);border-radius:6px;margin-bottom:4px;background:' + (step.enabled ? 'var(--ws-bg)' : 'var(--ws-bg-secondary)') + ';opacity:' + (step.enabled ? '1' : '0.5'),
      });
      row.appendChild(h('span', { style: 'font-size:11px;color:var(--ws-text-tertiary);min-width:20px' }, String(i + 1)));
      row.appendChild(h('div', { style: 'flex:1' },
        h('div', { style: 'font-size:12px;font-weight:500' }, op ? op.name : '(operacion no disponible)'),
        h('div', { style: 'font-size:10px;color:var(--ws-text-tertiary)' }, op ? op.description : step.operationId),
      ));
      const toggleBtn = h('button', {
        className: 'ws-btn ws-btn-xs ws-btn-ghost',
        title: step.enabled ? 'Desactivar paso ' + (i + 1) : 'Activar paso ' + (i + 1),
        'aria-label': step.enabled ? 'Desactivar paso ' + (i + 1) : 'Activar paso ' + (i + 1),
        'aria-pressed': step.enabled ? 'true' : 'false',
        onClick: () => { if (step.enabled) workflow.disableStep(step.id); else workflow.enableStep(step.id); renderStepList(); updatePlan(); updateExecuteBtn(); },
      }, svgIcon(step.enabled ? 'check' : 'close', 12));
      row.appendChild(toggleBtn);

      if (i > 0) {
        row.appendChild(h('button', {
          className: 'ws-btn ws-btn-xs ws-btn-ghost',
          title: 'Subir paso ' + (i + 1), 'aria-label': 'Subir paso ' + (i + 1),
          onClick: () => { workflow.moveStep(step.id, i - 1); renderStepList(); updatePlan(); }
        }, svgIcon('back', 12)));
      }
      if (i < steps.length - 1) {
        row.appendChild(h('button', {
          className: 'ws-btn ws-btn-xs ws-btn-ghost',
          title: 'Bajar paso ' + (i + 1), 'aria-label': 'Bajar paso ' + (i + 1),
          onClick: () => { workflow.moveStep(step.id, i + 1); renderStepList(); updatePlan(); }
        }, svgIcon('redo', 12)));
      }
      row.appendChild(h('button', {
        className: 'ws-btn ws-btn-xs ws-btn-ghost', title: 'Eliminar paso ' + (i + 1),
        'aria-label': 'Eliminar paso ' + (i + 1),
        onClick: () => { workflow.removeStep(step.id); renderStepList(); updatePlan(); updateExecuteBtn(); }
      }, svgIcon('close', 12)));
      stepListEl.appendChild(row);
    }
  }

  function updatePlan() {
    if (!planPreviewEl) return;
    const steps = workflow.getActiveSteps();
    const inputCount = Object.keys(inputs).length;
    if (inputCount === 0 && steps.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'font-size:12px;color:var(--ws-text-tertiary);padding:8px 0';
      placeholder.textContent = 'Configura archivos y pasos para ver el resumen.';
      planPreviewEl.replaceChildren(placeholder);
      return;
    }
    const parts = [];
    if (inputCount > 0) parts.push(inputCount + ' archivo' + (inputCount !== 1 ? 's' : '') + ' seleccionado' + (inputCount !== 1 ? 's' : ''));
    if (steps.length > 0) parts.push(steps.length + ' paso' + (steps.length !== 1 ? 's' : '') + ' activo' + (steps.length !== 1 ? 's' : ''));
    const lines = [];
    if (inputCount > 0) lines.push(h('div', { style: 'font-size:11px;margin-bottom:4px;color:var(--ws-text-secondary)' }, parts.join(', ')));
    for (let i = 0; i < steps.length; i++) {
      const op = registry.get(steps[i].operationId);
      const name = op ? op.name : steps[i].operationId;
      lines.push(h('div', { style: 'display:flex;align-items:center;gap:4px;font-size:11px;padding:2px 0' },
        h('span', { style: 'color:var(--ws-text-tertiary);min-width:16px' }, String(i + 1) + '.'),
        h('span', null, name),
        op && op.destructive ? h('span', { style: 'color:var(--ws-warning);font-size:10px' }, ' (destructivo)') : null,
      ));
    }
    if (steps.length > 0) {
      const lastOp = registry.get(steps[steps.length - 1].operationId);
      if (lastOp) {
        lines.push(h('div', { style: 'font-size:10px;color:var(--ws-text-tertiary);margin-top:4px' }, 'Resultado: ' + lastOp.outputKind));
      }
    }
    const terminalSteps = steps.filter(step => registry.get(step.operationId)?.batchTerminal).length;
    const totalJobs = inputCount * (steps.length - terminalSteps) + terminalSteps;
    if (totalJobs > 0) {
      lines.push(h('div', { style: 'font-size:10px;color:var(--ws-text-tertiary)' }, totalJobs + ' trabajo' + (totalJobs !== 1 ? 's' : '') + ' estimado' + (totalJobs !== 1 ? 's' : '')));
    }
    planPreviewEl.replaceChildren();
    for (const l of lines) planPreviewEl.appendChild(l);
  }

  function updateExecuteBtn() {
    const steps = workflow.getActiveSteps();
    const hasInputs = Object.keys(inputs).length > 0;
    const ok = hasInputs && steps.length > 0;
    if (executeBtn) {
      executeBtn.disabled = !ok;
      executeBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
    }
    if (cleanupBtn) cleanupBtn.disabled = !hasInputs && steps.length === 0;
  }

  function addFiles(files) {
    for (const file of files) {
      const id = 'input-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      inputs[id] = { file, name: file.name, size: file.size, kind: guessKind(file), type: file.type };
      inputFiles.push(id);
    }
    workflow.setInputs(Object.keys(inputs));
    refreshInputDisplay();
    updatePlan();
    updateExecuteBtn();
    toast(files.length + ' archivo' + (files.length !== 1 ? 's' : '') + ' agregado' + (files.length !== 1 ? 's' : ''), 'success');
    if (instructionAssistant) instructionAssistant.updateSuggestions(getInputFileMeta());
  }

  function guessKind(file) {
    const t = (file.type || '').toLowerCase();
    if (t.startsWith('image/')) return 'image';
    if (t === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')) return 'pdf';
    if (t.startsWith('text/') || file.name?.toLowerCase().endsWith('.txt') || file.name?.toLowerCase().endsWith('.md') || file.name?.toLowerCase().endsWith('.csv')) return 'text';
    return 'file';
  }

  function refreshInputDisplay() {
    if (!inputEl) return;
    inputEl.replaceChildren();
    inputEl.appendChild(h('div', { style: 'font-size:11px;margin-bottom:4px' }, Object.keys(inputs).length + ' archivo' + (Object.keys(inputs).length !== 1 ? 's' : '')));
    for (const [id, inp] of Object.entries(inputs)) {
      const tag = h('span', { style: 'display:inline-block;font-size:10px;background:var(--ws-bg-secondary);padding:2px 6px;border-radius:4px;margin:2px' },
        inp.name + ' (' + inp.kind + (inp.size ? ', ' + formatSize(inp.size) : '') + ')',
      );
      inputEl.appendChild(tag);
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function selectFromWorkspace() {
    const docs = appStore.get('documents') || [];
    const tables = appStore.get('dataTables') || [];
    const captures = appStore.get('captures') || [];
    if (docs.length === 0 && tables.length === 0 && captures.length === 0) {
      toast('No hay documentos, tablas o capturas en el proyecto actual', 'info');
      return;
    }
    const items = [];
    for (const d of docs) {
      items.push({ id: 'doc-' + d.id, name: d.name + ' (documento)', kind: 'document' });
    }
    for (const t of tables) {
      items.push({ id: 'table-' + t.id, name: t.name + ' (tabla)', kind: 'data' });
    }
    for (const c of captures) {
      items.push({ id: 'capture-' + c.id, name: (c.name || 'Captura') + ' (captura)', kind: 'image' });
    }
    showModal({
      title: 'Seleccionar desde Workspace',
      body: [
        h('div', { style: 'max-height:300px;overflow-y:auto', role: 'listbox', 'aria-label': 'Elementos del proyecto' },
          ...items.map(item =>
            h('div', {
              role: 'option',
              tabindex: 0,
              'aria-selected': 'false',
              style: 'display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border-radius:4px',
              onMouseEnter: (e) => e.currentTarget.style.background = 'var(--ws-bg-secondary)',
              onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  addWorkspaceItems([item]);
                  closeModal();
                  toast('Agregado: ' + item.name, 'success');
                }
              },
              onClick: () => {
                addWorkspaceItems([item]);
                closeModal();
                toast('Agregado: ' + item.name, 'success');
              },
            }, svgIcon(item.kind === 'document' ? 'doc' : item.kind === 'image' ? 'camera' : 'table', 14),
              h('span', { style: 'font-size:12px' }, item.name),
            ),
          ),
        ),
      ],
      confirmText: 'Cerrar',
      onConfirm: () => closeModal(),
    });
  }

  function addWorkspaceItems(items) {
    let added = 0;
    for (const item of items || []) {
      if (!item || !['document', 'data', 'image'].includes(item.kind) || !item.id) continue;
      if (Object.values(inputs).some(input => input.workspaceRef === item.id)) continue;
      const id = 'input-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      inputs[id] = { name: item.name || 'Elemento del Workspace', kind: item.kind, workspaceRef: item.id };
      inputFiles.push(id);
      added++;
    }
    if (!added) return 0;
    workflow.setInputs(Object.keys(inputs));
    refreshInputDisplay();
    updatePlan();
    updateExecuteBtn();
    if (instructionAssistant) instructionAssistant.updateSuggestions(getInputFileMeta());
    return added;
  }

  async function executeFlow() {
    if (!executeBtn || executeBtn.disabled) return;
    const activeSteps = workflow.getActiveSteps();
    if (activeSteps.length === 0) { toast('No hay pasos activos', 'warning'); return; }
    if (Object.keys(inputs).length === 0) { toast('No hay archivos de entrada', 'warning'); return; }

    executeBtn.disabled = true;
    if (execStateEl) execStateEl.textContent = 'Validando...';

    // Build inputs map with actual file data for the engine
    const inputsForEngine = {};
    for (const [id, inp] of Object.entries(inputs)) {
      if (inp.file) {
        inputsForEngine[id] = { data: inp.file, name: inp.name, kind: inp.kind };
      } else if (inp.workspaceRef) {
        const wsId = inp.workspaceRef.replace(/^(doc-|table-|capture-)/, '');
        const docs = appStore.get('documents') || [];
        const tables = appStore.get('dataTables') || [];
        const doc = docs.find(d => d.id === wsId);
        const table = tables.find(t => t.id === wsId);
        if (doc) {
          inputsForEngine[id] = { data: doc, name: doc.name, kind: 'document' };
        } else if (table) {
          inputsForEngine[id] = { data: table, name: table.name, kind: 'data' };
        } else if (inp.workspaceRef.startsWith('capture-') && appHelpers.resolveCaptureImage) {
          // Una captura escaneada entra al flujo por referencia: el helper
          // inyectado resuelve el asset corregido y devuelve la imagen como
          // Blob (patrón CE-029) para poder encadenarla (p. ej. OCR).
          const image = await appHelpers.resolveCaptureImage(wsId);
          if (image && image.blob) {
            inputsForEngine[id] = { data: image.blob, name: image.name || inp.name, kind: 'image' };
          }
        }
      }
    }

    engine = createWorkflowEngine(registry, { maxConcurrency: 2 });

    // Show monitor
    const monitorSection = document.getElementById('wf-monitor-section');
    const resultsSection = document.getElementById('wf-results-section');
    if (monitorSection) monitorSection.style.display = 'block';
    if (resultsSection) resultsSection.style.display = 'none';

    // Subscribe to events
    engine.subscribe((event) => {
      updateMonitor(event, engine);
    });

    if (execStateEl) execStateEl.textContent = 'Ejecutando...';
    const result = await engine.run(workflow, inputsForEngine);

    if (execStateEl) execStateEl.textContent = result.state === 'completed' ? 'Completado' : result.state === 'completed_with_errors' ? 'Completado con errores' : result.state === 'cancelled' ? 'Cancelado' : 'Fallido';

    currentResults = result.results;
    if (resultsSection && result.results) {
      resultsSection.style.display = 'block';
      renderResultItems(result.results);
    }
    executeBtn.disabled = false;
  }

  function updateMonitor(event, eng) {
    if (!monitorEl) return;
    const snap = eng.getSnapshot();
    const parts = [];
    if (snap.completed > 0) parts.push(snap.completed + ' completados');
    if (snap.failed > 0) parts.push(snap.failed + ' fallidos');
    if (snap.cancelled > 0) parts.push(snap.cancelled + ' cancelados');
    if (event.type === 'step-start') {
      parts.push('Paso: ' + event.operationName);
    }
    if (event.type === 'progress' && event.percent !== undefined) {
      parts.push(Math.round(event.percent) + '%');
    }
    if (event.type === 'job-status' && event.status === 'failed') {
      parts.push('Error: ' + (event.error || 'desconocido'));
    }
    monitorEl.replaceChildren();
    const statusText = parts.length ? parts.join(' - ') : 'Procesando...';
    monitorEl.appendChild(h('div', { style: 'font-size:12px;padding:4px 0' }, statusText));

    // Cancel button
    const cancelAllBtn = h('button', {
      className: 'ws-btn ws-btn-sm ws-btn-ghost',
      style: 'margin-top:4px',
      onClick: () => { eng.cancel(); if (execStateEl) execStateEl.textContent = 'Cancelando...'; },
    }, svgIcon('close', 12), ' Cancelar ejecucion');
    monitorEl.appendChild(cancelAllBtn);
  }

  function renderResultItems(results) {
    if (!resultsEl) return;
    resultsEl.replaceChildren();

    const completed = Object.values(results).filter(r => r.status === 'completed');
    const failed = Object.values(results).filter(r => r.status === 'failed');

    if (completed.length === 0 && failed.length === 0) {
      resultsEl.appendChild(h('div', { style: 'font-size:12px;color:var(--ws-text-tertiary);padding:8px' }, 'Sin resultados'));
      return;
    }

    for (const r of completed) {
      const item = h('div', {
        style: 'display:flex;align-items:center;gap:6px;padding:6px;border:1px solid var(--ws-border);border-radius:4px;margin-bottom:4px',
      });
      item.appendChild(h('span', { style: 'color:var(--ws-success);font-size:11px' }, 'OK'));
      item.appendChild(h('span', { style: 'font-size:11px;flex:1' }, r.name || r.inputId || 'Resultado'));

      if (r.data && (r.data instanceof Blob || r.kind === 'image')) {
        const blob = r.data instanceof Blob ? r.data : (r.data.data instanceof Blob ? r.data.data : null);
        if (blob) {
          const url = URL.createObjectURL(blob);
          item.appendChild(h('button', {
            className: 'ws-btn ws-btn-xs ws-btn-secondary',
            onClick: () => {
              const a = h('a', { href: url, download: (r.name || 'output') });
              // Un enlace desconectado no inicia una descarga de forma fiable en
              // todos los navegadores. Se monta de forma efímera y no se guarda.
              document.body?.appendChild(a);
              a.click();
              a.remove?.();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            },
          }, 'Descargar'));
        }
      }
      if (r.kind === 'document' || r.kind === 'data' || r.kind === 'image' || r.kind === 'text') {
        item.appendChild(h('button', {
          className: 'ws-btn ws-btn-xs ws-btn-ghost',
          onClick: () => addResultToWorkspace(r),
        }, 'Anadir al Workspace'));
      }
      resultsEl.appendChild(item);
    }

    for (const r of failed) {
      const item = h('div', {
        style: 'display:flex;align-items:center;gap:6px;padding:6px;border:1px solid var(--ws-border);border-radius:4px;margin-bottom:4px;opacity:0.7',
      });
      item.appendChild(h('span', { style: 'color:var(--ws-error);font-size:11px' }, 'ERROR'));
      item.appendChild(h('span', { style: 'font-size:11px;flex:1' }, (r.name || r.inputId || 'Elemento') + ': ' + (r.error || 'Error desconocido')));
      resultsEl.appendChild(item);
    }

    if (failed.length > 0 && engine) {
      resultsEl.appendChild(h('button', {
        className: 'ws-btn ws-btn-sm ws-btn-secondary',
        style: 'margin-top:8px',
        onClick: () => retryFailed(),
      }, 'Reintentar ' + failed.length + ' fallido' + (failed.length !== 1 ? 's' : '')));
    }
  }

  async function addResultToWorkspace(result) {
    if (!result || !result.data) return;
    const project = appStore.get('currentProject');
    if (!project) { toast('No hay proyecto activo', 'warning'); return; }

    try {
      // El engine envuelve cada resultado como { data: <payload>, kind, name }
      // (workflow-engine.js). CE-047 leía result.data.blocks/headers directamente,
      // por lo que en un flujo real el payload quedaba dentro de result.data.data
      // y la persistencia se omitía en silencio. Se normaliza el payload aquí.
      const wrapped = result.data && result.data.data !== undefined && (result.data.kind !== undefined || result.data.name !== undefined);
      const payload = wrapped ? result.data.data : result.data;

      if (result.kind === 'document' && payload && payload.blocks) {
        const doc = payload;
        const docs = appStore.get('documents') || [];
        if (docs.some(d => d.id === doc.id)) { toast('El documento ya esta en el Workspace', 'info'); return; }
        if (saveDoc) await saveDoc(project.id, doc);
        appStore.set({ documents: [...docs, doc] });
        appStore.set({ currentDoc: doc });
        if (pushHistory) pushHistory({ action: 'workflow-result-add', docId: doc.id, result });
        if (refreshProjectCounts) await refreshProjectCounts(project.id);
        toast('Documento anadido al Workspace', 'success');
      } else if (result.kind === 'data' && payload && payload.headers && payload.rows) {
        const table = payload;
        const tables = appStore.get('dataTables') || [];
        if (tables.some(t => t.id === table.id)) { toast('La tabla ya esta en el Workspace', 'info'); return; }
        if (saveData) await saveData(project.id, table);
        appStore.set({ dataTables: [...tables, table] });
        if (pushHistory) pushHistory({ action: 'workflow-result-add', tableId: table.id, result });
        if (refreshProjectCounts) await refreshProjectCounts(project.id);
        toast('Tabla anadida al Workspace', 'success');
      } else if (result.kind === 'image' && payload instanceof Blob) {
        // Un resultado de imagen de flujo (rotate/resize/convert/escáner) solo se
        // podía descargar; se persiste ahora como captura del proyecto para poder
        // encadenarlo (p. ej. imagen -> OCR) sin duplicar el asset corregido.
        const name = result.data.name || result.name || 'Imagen del flujo';
        if (saveImageCapture) await saveImageCapture(project, payload, name);
        if (pushHistory) pushHistory({ action: 'workflow-result-add', name, result });
        if (refreshProjectCounts) await refreshProjectCounts(project.id);
        toast('Imagen anadida al Workspace', 'success');
      } else if (result.kind === 'text') {
        // Un resultado de texto de flujo (salida OCR de image.ocr o text.export)
        // solo se podía descargar; se persiste ahora como documento Toolisto para
        // poder encadenarlo (documento -> tabla -> informe -> PDF) en el proyecto.
        let text = null;
        if (typeof payload === 'string') text = payload;
        else if (payload instanceof Blob) text = await payload.text();
        else if (payload && typeof payload.text === 'string') text = payload.text;
        if (text == null || String(text).trim() === '') {
          toast('El resultado de texto no es utilizable', 'warning');
          return;
        }
        const docs = appStore.get('documents') || [];
        const name = result.data.name || result.name || 'Texto del flujo';
        const doc = textResultToDocument(name, text);
        if (docs.some(d => d.id === doc.id)) { toast('El texto ya esta en el Workspace', 'info'); return; }
        if (saveDoc) await saveDoc(project.id, doc);
        appStore.set({ documents: [...docs, doc] });
        appStore.set({ currentDoc: doc });
        if (pushHistory) pushHistory({ action: 'workflow-result-add', docId: doc.id, result });
        if (refreshProjectCounts) await refreshProjectCounts(project.id);
        toast('Documento anadido al Workspace', 'success');
      }
    } catch (e) {
      toast('Error al anadir resultado: ' + e.message, 'error');
    }
  }

  function retryFailed() {
    if (!engine) return;
    const monitorSection = document.getElementById('wf-monitor-section');
    if (monitorSection) monitorSection.style.display = 'block';
    const resultsSection = document.getElementById('wf-results-section');
    if (resultsSection) resultsSection.style.display = 'none';
    if (execStateEl) execStateEl.textContent = 'Reintentando...';
    engine.subscribe((event) => updateMonitor(event, engine));
    engine.retryFailed().then(r => {
      if (resultsSection && r.results) {
        resultsSection.style.display = 'block';
        renderResultItems(r.results);
      }
      if (execStateEl) execStateEl.textContent = r.state === 'completed' ? 'Completado' : 'Fallido';
    });
  }

  function clearFlow() {
    workflow = createWorkflowModel();
    inputs = {};
    inputFiles = [];
    currentResults = null;
    if (engine) { engine.destroy(); engine = null; }
    releaseOcrEngine();
    if (instructionAssistant) {
      instructionAssistant.clearInput();
      instructionAssistant.updateSuggestions(getInputFileMeta());
    }
    const monitorSection = document.getElementById('wf-monitor-section');
    const resultsSection = document.getElementById('wf-results-section');
    if (monitorSection) monitorSection.style.display = 'none';
    if (resultsSection) resultsSection.style.display = 'none';
    refreshInputDisplay();
    renderStepList();
    updatePlan();
    updateExecuteBtn();
    if (execStateEl) execStateEl.textContent = 'Listo';
  }

  function getWorkflowSnapshot() {
    return workflow.serializeWorkflow();
  }

  function setWorkflowFromSnapshot(snapshot) {
    if (!snapshot) return;
    workflow = createWorkflowModel();
    workflow.deserializeWorkflow(snapshot);
    renderStepList();
    updatePlan();
    updateExecuteBtn();
  }

  function hasWorkflow() {
    return workflow.getActiveSteps().length > 0 || Object.keys(inputs).length > 0;
  }

  return { render, clearFlow, getWorkflowSnapshot, setWorkflowFromSnapshot, hasWorkflow, addFiles, addWorkspaceItems, setAutoExecute, addResultToWorkspace };
}
