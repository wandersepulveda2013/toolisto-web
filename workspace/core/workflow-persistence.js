/**
 * core/workflow-persistence.js — CRUD for saved workflows.
 *
 * Bridges the linear workflow-model.js with IndexedDB storage.
 * Each saved workflow is a record containing:
 *   id, projectId, name, description, definition, schemaVersion,
 *   createdAt, updatedAt, tags
 *
 * The `definition` field holds the serialized workflow-model snapshot.
 */

import { WORKFLOW_DEFINITION_VERSION } from './schema-versions.js';

export const WORKFLOW_SCHEMA_VERSION = WORKFLOW_DEFINITION_VERSION;

export function createWorkflowPersistence(storage, appStore) {
  function _currentProjectId() {
    const p = appStore.get('currentProject');
    return p ? p.id : null;
  }

  async function save(workflowModel, options = {}) {
    const projectId = options.projectId || _currentProjectId();
    if (!projectId) throw new Error('No hay proyecto activo');

    const snapshot = workflowModel.serializeWorkflow();
    const record = {
      type: 'workflow',
      projectId,
      name: options.name || workflowModel.getName(),
      description: options.description || '',
      definition: snapshot,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      tags: options.tags || [],
    };

    const saved = await storage.saveWorkflow(projectId, record);
    return saved;
  }

  async function load(workflowId) {
    return await storage.loadWorkflow(workflowId);
  }

  async function listByProject(projectId) {
    const pid = projectId || _currentProjectId();
    if (!pid) return [];
    return await storage.loadWorkflowsByProject(pid);
  }

  async function remove(workflowId) {
    return await storage.deleteWorkflow(workflowId);
  }

  async function duplicate(workflowId, options = {}) {
    const record = await storage.loadWorkflow(workflowId);
    if (!record) throw new Error('Workflow no encontrado');
    const newDef = JSON.parse(JSON.stringify(record.definition));
    newDef.id = 'workflow-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    newDef.createdAt = Date.now();
    newDef.updatedAt = Date.now();
    if (newDef.steps) {
      newDef.steps = newDef.steps.map(s => ({
        ...s,
        id: 'step-' + Math.random().toString(36).slice(2, 10),
      }));
    }
    const newRecord = {
      type: 'workflow',
      projectId: record.projectId,
      name: (options.name || record.name) + ' (copia)',
      description: record.description || '',
      definition: newDef,
      schemaVersion: record.schemaVersion || WORKFLOW_SCHEMA_VERSION,
      tags: record.tags ? record.tags.slice() : [],
    };
    return await storage.saveWorkflow(record.projectId, newRecord);
  }

  async function rename(workflowId, newName) {
    const record = await storage.loadWorkflow(workflowId);
    if (!record) throw new Error('Workflow no encontrado');
    record.name = newName;
    record.updatedAt = Date.now();
    await storage.saveWorkflow(record.projectId, record);
    return record;
  }

  async function updateDefinition(workflowId, workflowModel) {
    const record = await storage.loadWorkflow(workflowId);
    if (!record) throw new Error('Workflow no encontrado');
    record.definition = workflowModel.serializeWorkflow();
    record.updatedAt = Date.now();
    await storage.saveWorkflow(record.projectId, record);
    return record;
  }

  async function exportWorkflow(workflowId) {
    const record = await storage.loadWorkflow(workflowId);
    if (!record) throw new Error('Workflow no encontrado');
    return {
      type: 'toolisto-workflow',
      version: WORKFLOW_SCHEMA_VERSION,
      exportedAt: Date.now(),
      workflow: {
        name: record.name,
        description: record.description || '',
        definition: record.definition,
        tags: record.tags || [],
      },
    };
  }

  async function importWorkflow(bundle, options = {}) {
    if (!bundle || bundle.type !== 'toolisto-workflow') {
      throw new Error('Formato de archivo no válido: se esperaba un flujo .toolisto');
    }
    if (!bundle.workflow || !bundle.workflow.definition) {
      throw new Error('El archivo no contiene un flujo válido');
    }
    const def = bundle.workflow.definition;
    if (!def.steps || !Array.isArray(def.steps)) {
      throw new Error('El flujo no tiene pasos válidos');
    }
    const projectId = options.projectId || _currentProjectId();
    if (!projectId) throw new Error('No hay proyecto activo');
    const record = {
      type: 'workflow',
      projectId,
      name: options.name || bundle.workflow.name || 'Flujo importado',
      description: bundle.workflow.description || '',
      definition: def,
      schemaVersion: bundle.version || WORKFLOW_SCHEMA_VERSION,
      tags: bundle.workflow.tags || [],
    };
    return await storage.saveWorkflow(projectId, record);
  }

  async function logExecution(workflowId, result) {
    const record = await storage.loadWorkflow(workflowId);
    if (!record) return null;
    const projectId = record.projectId || _currentProjectId();
    if (!projectId) return null;
    const history = record.executionHistory || [];
    history.push({
      id: 'exec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      workflowId,
      completedAt: Date.now(),
      totalSteps: result?.total || 0,
      completed: result?.completed || 0,
      failed: result?.failed || 0,
      cancelled: result?.cancelled || 0,
      success: result?.failed === 0 && result?.cancelled === 0,
      resultSummary: result?.results ? Object.keys(result.results).length + ' outputs' : '',
    });
    if (history.length > 100) history.splice(0, history.length - 100);
    record.executionHistory = history;
    record.updatedAt = Date.now();
    await storage.saveWorkflow(projectId, record);
    return history[history.length - 1];
  }

  async function getExecutionHistory(workflowId) {
    const record = await storage.loadWorkflow(workflowId);
    if (!record) return [];
    return record.executionHistory || [];
  }

  return { save, load, listByProject, remove, duplicate, rename, updateDefinition, exportWorkflow, importWorkflow, logExecution, getExecutionHistory };
}
