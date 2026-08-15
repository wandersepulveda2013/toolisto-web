import { createInstructionParser } from './instruction-parser.js';
import { createInstructionPlanner } from './instruction-planner.js';

export function createInstructionAssistant(registry, appHelpers) {
  const { h, svgIcon, toast, appStore, reportError, showWarning } = appHelpers;
  const parser = createInstructionParser();
  const planner = createInstructionPlanner(registry);

  let panelEl = null;
  let inputField = null;
  let resultArea = null;
  let suggestionBar = null;
  let createBtn = null;
  let clearBtn = null;
  let autoExecuteCheckbox = null;
  let history = [];
  let currentPlan = null;
  let onUseFlowCallback = null;
  let analyzing = false;
  let autoExecuteMode = false;
  let globalKeyHandler = null;

  const MAX_HISTORY = 10;

  const SUGGESTIONS = {
    image: [
      { label: 'Mejorar y convertir a WebP', text: 'Mejora estas imágenes y conviértelas a WebP.' },
      { label: 'Redimensionar a 1200 px', text: 'Redimensiona estas imágenes a 1200 px.' },
      { label: 'Extraer texto con OCR', text: 'Extrae el texto de estas imágenes.' },
      { label: 'Eliminar metadatos', text: 'Elimina los metadatos de estas imágenes.' },
    ],
    pdf: [
      { label: 'Convertir PDF en imágenes', text: 'Convierte estos PDF en imágenes.' },
      { label: 'Unir los PDF', text: 'Une todos los PDF seleccionados.' },
      { label: 'Rotar páginas 90°', text: 'Rota las páginas de estos PDF 90 grados.' },
    ],
    text: [
      { label: 'Convertir en tabla', text: 'Convierte este texto en una tabla.' },
      { label: 'Crear informe', text: 'Crea un informe con estos datos.' },
    ],
    default: [
      { label: 'Mejorar y redimensionar', text: 'Mejora estas imágenes y redimensiona a 1200 px.' },
      { label: 'OCR a tabla', text: 'Extrae el texto de estas imágenes y conviértelo en una tabla.' },
    ],
  };

  function render(container, inputFiles) {
    if (!panelEl) {
      panelEl = h('div', { className: 'ws-instruction-assistant', style: 'display:flex;flex-direction:column;gap:12px' });
    } else {
      panelEl.replaceChildren();
    }

    const header = h('div', { style: 'display:flex;align-items:center;gap:8px' },
      h('span', { style: 'font-weight:600;font-size:14px' }, 'Asistente de flujos'),
      h('span', { style: 'font-size:11px;color:var(--ws-text-tertiary)' }, 'Escribe qué quieres hacer')
    );
    panelEl.appendChild(header);

    const privacyNote = h('div', { style: 'font-size:11px;color:var(--ws-text-tertiary);padding:4px 8px;background:var(--ws-bg-secondary);border-radius:6px' },
      'Tus archivos y tus instrucciones se procesan localmente en tu navegador.'
    );
    panelEl.appendChild(privacyNote);

    inputField = h('textarea', {
      id: 'wf-assistant-input',
      placeholder: 'Ej: Mejora estas imágenes, redimensiónalas a 1200 px y conviértelas a WebP.',
      style: 'width:100%;min-height:72px;padding:8px;border:1px solid var(--ws-border);border-radius:6px;font-size:13px;font-family:var(--ws-font);resize:vertical;background:var(--ws-bg);color:var(--ws-text)',
      rows: 3,
      'aria-label': 'Describe el flujo que quieres crear',
      'aria-describedby': 'wf-assistant-desc',
    });

    const desc = h('span', { id: 'wf-assistant-desc', style: 'font-size:10px;color:var(--ws-text-tertiary)' }, 'Presiona Ctrl+Enter para crear el flujo.');

    const autoExRow = h('div', { style: 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ws-text-secondary);padding:2px 0' });
    autoExecuteCheckbox = h('input', { type: 'checkbox', id: 'wf-auto-execute', style: 'margin:0;flex-shrink:0' });
    autoExecuteCheckbox.checked = autoExecuteMode;
    autoExecuteCheckbox.addEventListener('change', () => {
      autoExecuteMode = autoExecuteCheckbox.checked;
      try { localStorage.setItem('toolisto-auto-execute', autoExecuteMode ? 'true' : 'false'); } catch(e) {}
    });
    autoExRow.appendChild(autoExecuteCheckbox);
    autoExRow.appendChild(h('label', { htmlFor: 'wf-auto-execute', style: 'cursor:pointer' }, 'Ejecutar automaticamente'));
    panelEl.appendChild(autoExRow);

    const btnRow = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
    createBtn = h('button', {
      id: 'wf-assistant-create',
      className: 'ws-btn ws-btn-primary',
      onClick: () => executePlan(inputFiles),
      'aria-label': 'Crear flujo desde instrucción',
    }, svgIcon('play') + ' Crear flujo');

    clearBtn = h('button', {
      id: 'wf-assistant-clear',
      className: 'ws-btn ws-btn-ghost',
      onClick: () => clearInput(),
      'aria-label': 'Limpiar instrucción',
    }, svgIcon('close') + ' Limpiar');

    inputField.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executePlan(inputFiles);
      }
    });

    inputField.addEventListener('input', () => {
      inputField.style.height = 'auto';
      inputField.style.height = Math.max(72, inputField.scrollHeight) + 'px';
    });

    globalKeyHandler = (e) => {
      if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.getAttribute('contenteditable') !== 'true') {
        e.preventDefault();
        if (inputField) inputField.focus();
      }
    };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('keydown', globalKeyHandler);
    }

    btnRow.appendChild(createBtn);
    btnRow.appendChild(clearBtn);
    panelEl.appendChild(inputField);
    panelEl.appendChild(desc);
    panelEl.appendChild(btnRow);

    suggestionBar = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' });
    updateSuggestions(inputFiles);
    panelEl.appendChild(suggestionBar);

    resultArea = h('div', {
      id: 'wf-assistant-result',
      style: 'display:none',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      role: 'region',
      'aria-label': 'Resultado del asistente',
    });
    panelEl.appendChild(resultArea);

    if (history.length > 0) {
      const historySection = h('div', { style: 'margin-top:4px' });
      historySection.appendChild(h('div', { style: 'font-size:12px;font-weight:600;margin-bottom:4px' }, 'Últimas instrucciones'));
      const historyList = h('div', { style: 'display:flex;flex-direction:column;gap:2px' });
      for (const entry of history.slice(-5).reverse()) {
        const item = h('button', {
          style: 'font-size:11px;padding:4px 8px;background:var(--ws-bg-secondary);border:1px solid var(--ws-border);border-radius:4px;cursor:pointer;text-align:left;color:var(--ws-text-secondary)',
          onClick: () => { if (inputField) inputField.value = entry; executePlan(inputFiles); },
        }, entry.substring(0, 60) + (entry.length > 60 ? '...' : ''));
        historyList.appendChild(item);
      }
      historySection.appendChild(historyList);
      panelEl.appendChild(historySection);
    }

    container.appendChild(panelEl);
  }

  function updateSuggestions(inputFiles) {
    if (!suggestionBar) return;
    suggestionBar.replaceChildren();
    suggestionBar.appendChild(h('span', { style: 'font-size:11px;color:var(--ws-text-tertiary);padding:2px 0' }, 'Sugerencias:'));

    let category = 'default';
    if (inputFiles && inputFiles.length > 0) {
      const types = inputFiles.map(f => (f.type || '').toLowerCase());
      if (types.some(t => t.startsWith('image/'))) category = 'image';
      else if (types.some(t => t === 'application/pdf')) category = 'pdf';
      else if (types.some(t => t === 'text/plain' || t === 'text/csv' || t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) category = 'text';
    }

    const suggestions = SUGGESTIONS[category] || SUGGESTIONS.default;
    for (const sug of suggestions) {
      const btn = h('button', {
        className: 'ws-btn ws-btn-ghost ws-btn-xs',
        style: 'font-size:11px',
        onClick: () => { if (inputField) inputField.value = sug.text; },
        'aria-label': 'Sugerencia: ' + sug.label,
      }, sug.label);
      suggestionBar.appendChild(btn);
    }
  }

  function setAnalyzingState(active) {
    analyzing = active;
    if (createBtn) createBtn.disabled = active;
    if (clearBtn) clearBtn.disabled = active;
    if (inputField) inputField.disabled = active;
  }

  function executePlan(inputFiles) {
    if (analyzing) return;
    if (!inputField) return;
    const text = inputField.value.trim();
    if (!text) {
      toast('Escribe una instrucción primero.', 'warning');
      return;
    }

    setAnalyzingState(true);
    if (resultArea) {
      resultArea.style.display = 'block';
      resultArea.replaceChildren(
        h('div', { style: 'font-size:12px;color:var(--ws-text-secondary);padding:8px' }, 'Analizando instrucción...')
      );
    }

    try {
      const parsed = parser.parse(text);
      const planResult = planner.plan(parsed, inputFiles);
      currentPlan = planResult;

      if (!history.includes(text)) {
        history.push(text);
        if (history.length > MAX_HISTORY) history.shift();
        if (panelEl && panelEl.parentNode) {
          render(panelEl.parentNode, inputFiles);
          if (inputField) inputField.value = text;
        }
      }

      renderPlan(planResult, parsed, inputFiles);

      // Auto-execute: if mode is enabled and plan is valid, skip manual confirmation
      const activeSteps = planResult.workflow ? planResult.workflow.getActiveSteps() : [];
      const hasBlockingAmbiguity = planResult.ambiguities && planResult.ambiguities.length > 0;
      if (autoExecuteMode && activeSteps.length > 0 && !hasBlockingAmbiguity && planResult.confidence.level !== 'low') {
        setAnalyzingState(false);
        confirmFlow(inputFiles);
        return;
      }

      // Persist state
      persistState(text, planResult);
    } catch (err) {
      if (reportError) {
        reportError(err, { category: 'unexpected', action: 'instruction-analysis' });
      } else {
        toast('Ocurrió un error al analizar la instrucción.', 'error');
      }
      if (resultArea) {
        resultArea.style.display = 'block';
        resultArea.replaceChildren(
          h('div', { style: 'padding:12px;border:1px solid var(--ws-error);border-radius:6px;background:var(--ws-bg-error, #fef2f2)' },
            h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:4px' }, 'Error al analizar'),
            h('div', { style: 'font-size:12px;color:var(--ws-text-secondary)' }, err.message || 'Error desconocido')
          )
        );
      }
    } finally {
      setAnalyzingState(false);
    }
  }

  function renderPlan(planResult, parsed, inputFiles) {
    if (!resultArea) return;
    resultArea.style.display = 'block';
    resultArea.replaceChildren();

    if (!planResult.valid && planResult.confidence.level === 'low' && !planResult.ambiguities) {
      const errorBox = h('div', { style: 'padding:12px;border:1px solid var(--ws-error);border-radius:6px;background:var(--ws-bg-error, #fef2f2)' },
        h('div', { style: 'font-weight:600;font-size:13px;margin-bottom:4px' }, 'No se pudo crear el flujo'),
        h('div', { style: 'font-size:12px;color:var(--ws-text-secondary)' }, parsed.warnings[0] || 'No se reconoció ninguna operación en esta instrucción.')
      );
      resultArea.appendChild(errorBox);
      return;
    }

    const activeSteps = planResult.workflow ? planResult.workflow.getActiveSteps() : [];

    const confidenceColors = { high: 'var(--ws-success,#16a34a)', medium: 'var(--ws-warning,#f59e0b)', low: 'var(--ws-error,#dc2626)' };
    const badge = h('span', {
      style: 'font-size:11px;padding:2px 8px;border-radius:10px;background:' + (confidenceColors[planResult.confidence.level] || '#888') + '20;color:' + (confidenceColors[planResult.confidence.level] || '#888') + ';font-weight:600'
    }, 'Confianza: ' + planResult.confidence.level.toUpperCase());

    const summary = h('div', { style: 'border:1px solid var(--ws-border);border-radius:8px;padding:12px;margin-top:8px' });
    summary.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' },
      h('span', { style: 'font-weight:600;font-size:13px' }, 'Flujo propuesto'),
      badge
    ));

    if (activeSteps.length > 0) {
      const stepsList = h('div', { style: 'display:flex;flex-direction:column;gap:4px' });
      activeSteps.forEach((step, i) => {
        const op = registry.get(step.operationId);
        const opName = op ? op.name : step.operationId;
        const opts = Object.entries(step.options).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
        const optsStr = opts.map(([k, v]) => k + ': ' + v).join(', ');
        stepsList.appendChild(h('div', { style: 'display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--ws-bg-secondary);border-radius:4px;font-size:12px' },
          h('span', { style: 'color:var(--ws-text-tertiary);min-width:18px;font-weight:600' }, String(i + 1) + '.'),
          h('span', { style: 'font-weight:500' }, opName),
          optsStr ? h('span', { style: 'color:var(--ws-text-tertiary);font-size:11px' }, '(' + optsStr + ')') : null,
        ));
      });
      summary.appendChild(stepsList);
    } else {
      summary.appendChild(h('div', { style: 'font-size:12px;color:var(--ws-text-tertiary);padding:8px;text-align:center' }, 'No se generaron pasos.'));
    }

    const info = h('div', { style: 'display:flex;gap:12px;margin-top:8px;font-size:11px;color:var(--ws-text-secondary)' });
    if (inputFiles) info.appendChild(h('span', null, inputFiles.length + ' archivo(s) seleccionado(s)'));
    if (activeSteps.length > 0) {
      const lastOp = registry.get(activeSteps[activeSteps.length - 1].operationId);
      if (lastOp) info.appendChild(h('span', null, 'Resultado esperado: ' + lastOp.outputKind));
    }
    summary.appendChild(info);

    // Ambiguities
    if (planResult.ambiguities && planResult.ambiguities.length > 0) {
      for (const amb of planResult.ambiguities) {
        const ambBox = h('div', { style: 'margin-top:8px;padding:8px;border:1px solid var(--ws-warning,#f59e0b);border-radius:6px;background:var(--ws-bg-warning,#fffbeb)' });
        ambBox.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:4px' }, amb.question));
        const optRow = h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' });
        for (const opt of amb.options) {
          const optBtn = h('button', {
            className: 'ws-btn ws-btn-xs ws-btn-secondary',
            style: 'font-size:11px',
            onClick: () => resolveAmbiguity(amb.id, opt.id, inputFiles),
            'aria-label': 'Seleccionar: ' + opt.label,
          }, opt.label);
          optRow.appendChild(optBtn);
        }
        ambBox.appendChild(optRow);
        summary.appendChild(ambBox);
      }
    }

    // Warnings
    const allWarnings = [...(planResult.warnings || []), ...(parsed.warnings || [])];
    if (allWarnings.length > 0) {
      const warnBox = h('div', { style: 'margin-top:8px;padding:8px;border:1px solid var(--ws-warning,#f59e0b);border-radius:6px;background:var(--ws-bg-warning,#fffbeb)' });
      warnBox.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:4px' }, 'Advertencias'));
      for (const w of allWarnings) {
        warnBox.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-secondary)' }, '• ' + w));
      }
      summary.appendChild(warnBox);
    }

    // Assumptions
    if (planResult.assumptions && planResult.assumptions.length > 0) {
      const asBox = h('div', { style: 'margin-top:8px;padding:8px;border:1px solid var(--ws-border);border-radius:6px;background:var(--ws-bg-secondary)' });
      asBox.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:4px' }, 'Suposiciones'));
      for (const a of planResult.assumptions) {
        asBox.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-secondary)' }, '• ' + a.message));
      }
      summary.appendChild(asBox);
    }

    // Unresolved
    if (planResult.unresolved && planResult.unresolved.length > 0) {
      const unBox = h('div', { style: 'margin-top:8px;padding:8px;border:1px solid var(--ws-error,#dc2626);border-radius:6px;background:var(--ws-bg-error,#fef2f2)' });
      unBox.appendChild(h('div', { style: 'font-weight:600;font-size:12px;margin-bottom:4px' }, 'No disponibles'));
      for (const u of planResult.unresolved) {
        unBox.appendChild(h('div', { style: 'font-size:11px;color:var(--ws-text-secondary)' }, '• ' + u.reason));
      }
      summary.appendChild(unBox);
    }

    resultArea.appendChild(summary);

    // Action buttons
    const actionRow = h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' });

    const hasBlockingAmbiguity = planResult.ambiguities && planResult.ambiguities.length > 0;

    if (activeSteps.length > 0 && !hasBlockingAmbiguity && planResult.confidence.level !== 'low') {
      const useBtn = h('button', {
        id: 'wf-assistant-use',
        className: 'ws-btn ws-btn-primary',
        onClick: () => confirmFlow(inputFiles),
        'aria-label': 'Usar este flujo',
      }, svgIcon('check') + ' Usar este flujo');
      actionRow.appendChild(useBtn);

      const editBtn = h('button', {
        id: 'wf-assistant-edit',
        className: 'ws-btn ws-btn-secondary',
        onClick: () => editSteps(inputFiles),
        'aria-label': 'Editar pasos manualmente',
      }, svgIcon('edit') + ' Editar pasos');
      actionRow.appendChild(editBtn);
    }

    // "Continuar solo con lo compatible" when there are unresolved items but some steps were created
    if (activeSteps.length > 0 && planResult.unresolved && planResult.unresolved.length > 0 && !hasBlockingAmbiguity) {
      const partialBtn = h('button', {
        className: 'ws-btn ws-btn-secondary',
        style: 'font-size:12px',
        onClick: () => confirmFlow(inputFiles),
        'aria-label': 'Continuar solo con las operaciones disponibles',
      }, svgIcon('forward') + ' Continuar solo con lo disponible');
      actionRow.appendChild(partialBtn);
    }

    const retryBtn = h('button', {
      className: 'ws-btn ws-btn-ghost',
      style: 'margin-left:auto',
      onClick: () => { if (inputField) { inputField.focus(); inputField.select(); } },
    }, svgIcon('redo') + ' Revisar instrucción');
    actionRow.appendChild(retryBtn);

    resultArea.appendChild(actionRow);
  }

  function resolveAmbiguity(ambId, optionId, inputFiles) {
    if (!inputField) return;
    const text = inputField.value.trim();
    if (!text) return;

    // Re-parse with resolved ambiguity
    const parsed = parser.parse(text);

    // Modify parsed intents based on resolution
    if (ambId === 'reduce-meaning') {
      if (optionId === 'dimensions') {
        // Keep resize if present, else add it
        if (!parsed.intents.find(i => i.action === 'resize')) {
          parsed.intents.push({ action: 'resize', target: 'image', options: { width: 800 } });
        }
      } else if (optionId === 'file-size') {
        if (!parsed.intents.find(i => i.action === 'compress')) {
          parsed.intents.push({ action: 'compress', target: 'image', options: {} });
        }
      }
    } else if (ambId === 'enhance-ambiguous') {
      // Already detected as enhance, just clear the ambiguity
    } else if (ambId === 'rotate-angle') {
      parsed.intents.forEach(i => { if (i.action === 'rotate') i.options.angle = parseInt(optionId); });
    } else if (ambId === 'convert-format') {
      if (optionId === 'webp') parsed.intents.forEach(i => { if (i.action === 'convert') i.options.format = 'image/webp'; });
      else if (optionId === 'jpeg') parsed.intents.forEach(i => { if (i.action === 'convert') i.options.format = 'image/jpeg'; });
      else if (optionId === 'png') parsed.intents.forEach(i => { if (i.action === 'convert') i.options.format = 'image/png'; });
    }

    parsed.ambiguities = [];
    const planResult = planner.plan(parsed, inputFiles);
    currentPlan = planResult;
    renderPlan(planResult, parsed, inputFiles);
    persistState(text, planResult);
  }

  function confirmFlow(inputFiles) {
    if (!currentPlan) return;
    if (onUseFlowCallback) {
      onUseFlowCallback(currentPlan, inputFiles);
    }
  }

  function editSteps(inputFiles) {
    if (!currentPlan) return;
    if (onUseFlowCallback) {
      onUseFlowCallback(currentPlan, inputFiles, true);
    }
  }

  function clearInput() {
    if (analyzing) return;
    if (inputField) inputField.value = '';
    if (resultArea) {
      resultArea.style.display = 'none';
      resultArea.replaceChildren();
    }
    currentPlan = null;
  }

  function onUseFlow(callback) {
    onUseFlowCallback = callback;
  }

  function getCurrentPlan() { return currentPlan; }
  function getAutoExecute() { return autoExecuteMode; }
  function setAutoExecute(val) { autoExecuteMode = val; if (autoExecuteCheckbox) autoExecuteCheckbox.checked = val; }
  function getHistory() { return history.slice(); }
  function setHistory(h) { history = Array.isArray(h) ? h.slice() : []; }
  function getParser() { return parser; }
  function getPlanner() { return planner; }

  function persistState(text, planResult) {
    try {
      if (appStore && appStore.set) {
        appStore.set({
          _assistantText: text,
          _assistantPlan: planResult ? {
            confidence: planResult.confidence,
            unresolved: (planResult.unresolved || []).length > 0 ? planResult.unresolved.map(u => ({ action: u.action, reason: u.reason })) : [],
          } : null,
        });
      }
    } catch (e) { /* ignore persist errors */ }
  }

  function restoreState(inputFiles) {
    try {
      if (appStore && appStore.get) {
        const savedText = appStore.get('_assistantText');
        if (savedText && inputField) {
          inputField.value = savedText;
        }
      }
    } catch (e) { /* ignore */ }
  }

  function destroy() {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    if (globalKeyHandler && typeof document !== 'undefined' && document.removeEventListener) {
      document.removeEventListener('keydown', globalKeyHandler);
    }
    panelEl = null;
    inputField = null;
    resultArea = null;
    suggestionBar = null;
    createBtn = null;
    clearBtn = null;
    currentPlan = null;
    onUseFlowCallback = null;
    globalKeyHandler = null;
    analyzing = false;
  }

  return {
    render, executePlan, clearInput, onUseFlow,
    getCurrentPlan, getAutoExecute, setAutoExecute, getHistory, setHistory, getParser, getPlanner,
    updateSuggestions, restoreState, destroy,
  };
}
