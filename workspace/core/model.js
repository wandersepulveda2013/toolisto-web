import { DATA_MODEL_SCHEMA_VERSION } from './schema-versions.js';
import { parseLocaleNumber, inferNumericHints, classifyDate, inferDateFormat } from './locale-parser.js';
import { getTableRows, getTableHeaders } from './table-helpers.js';

const MODEL_VERSION = DATA_MODEL_SCHEMA_VERSION;

function modelCanonical(value) {
  return String(value || '')
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function modelSingular(value) {
  let result = modelCanonical(value);
  if (result.endsWith('ies')) result = result.slice(0, -3) + 'y';
  else if (result.endsWith('s') && !result.endsWith('ss')) result = result.slice(0, -1);
  return result;
}

function modelColumnValues(table, index) {
  return getTableRows(table)
    .map(row => row?.[index])
    .filter(value => value !== null && value !== undefined && String(value).trim() !== '')
    .map(value => String(value).trim());
}

function modelFieldType(table, index) {
  const values = modelColumnValues(table, index);
  if (!values.length) return 'texto';
  const hints = inferNumericHints(values);
  const numericCount = values.filter(v => parseLocaleNumber(v, hints) !== null).length;
  if (numericCount === values.length) return 'numero';
  const dateResult = inferDateFormat(values);
  if (dateResult.format !== 'text' && !dateResult.ambiguous && dateResult.confidence > 0.5) return 'fecha';
  return 'texto';
}

function modelIsKeyName(value) {
  const field = modelCanonical(value);
  return field === 'id' || field.endsWith('id') || field.endsWith('key') || field.endsWith('code');
}

function modelFieldMeta(table) {
  const headers = getTableHeaders(table);
  return headers.map((header, index) => {
    const name = String(header || 'Columna ' + (index + 1));
    const values = modelColumnValues(table, index);
    return {
      name,
      index,
      type: modelFieldType(table, index),
      isKey: modelIsKeyName(name),
      nullable: values.length < (table?.rows || []).length,
    };
  });
}

function modelNodePosition(index) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 28 + column * 286, y: 28 + row * 222 };
}

function normalizeDataModel(project, tables, saved) {
  const previous = saved?.model && typeof saved.model === 'object' ? saved.model : (saved || {});
  const oldNodes = Array.isArray(previous.nodes) ? previous.nodes : [];
  const oldRelationships = Array.isArray(previous.relationships) ? previous.relationships : [];
  const validTableIds = new Set((tables || []).map(table => table.id));
  const fieldsByTable = new Map((tables || []).map(table => [table.id, new Set(modelFieldMeta(table).map(field => field.name))]));
  const nodes = (tables || []).map((table, index) => {
    const old = oldNodes.find(node => node.tableId === table.id);
    const fallback = modelNodePosition(index);
    const x = Number(old?.x);
    const y = Number(old?.y);
    return {
      tableId: table.id,
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      collapsed: Boolean(old?.collapsed),
    };
  });
  const relationships = oldRelationships
    .filter(relation => validTableIds.has(relation.fromTableId) && validTableIds.has(relation.toTableId))
    .filter(relation => relation.fromTableId !== relation.toTableId)
    .filter(relation => fieldsByTable.get(relation.fromTableId)?.has(relation.fromField) && fieldsByTable.get(relation.toTableId)?.has(relation.toField))
    .map(relation => ({
      id: relation.id || 'rel-' + Math.random().toString(36).slice(2, 9),
      fromTableId: relation.fromTableId,
      fromField: relation.fromField,
      toTableId: relation.toTableId,
      toField: relation.toField,
      cardinality: ['1:1', '1:*', '*:*'].includes(relation.cardinality) ? relation.cardinality : '1:*',
      filterDirection: relation.filterDirection === 'both' ? 'both' : 'single',
      active: relation.active !== false,
      detected: Boolean(relation.detected),
    }));
  return {
    version: MODEL_VERSION,
    projectId: project?.id || previous.projectId || '',
    nodes,
    relationships,
    updatedAt: previous.updatedAt || Date.now(),
  };
}

function modelRelationshipKey(relation) {
  return [
    relation?.fromTableId,
    modelCanonical(relation?.fromField),
    relation?.toTableId,
    modelCanonical(relation?.toField),
  ].join('|');
}

function modelRelationshipTitle(relation, tables) {
  const from = (tables || []).find(table => table.id === relation?.fromTableId);
  const to = (tables || []).find(table => table.id === relation?.toTableId);
  return `${from?.name || 'Tabla'} · ${relation?.fromField || 'campo'} → ${to?.name || 'Tabla'} · ${relation?.toField || 'campo'}`;
}

function inferCardinality(pkValues, fkValues) {
  const pkSet = new Set(pkValues.map(v => String(v ?? '').trim()).filter(Boolean));
  const fkFiltered = fkValues.map(v => String(v ?? '').trim()).filter(Boolean);
  if (pkSet.size === 0 || fkFiltered.length === 0) return '1:*';
  const fkDistinct = new Set(fkFiltered);
  const hasDuplicates = fkDistinct.size < fkFiltered.length;
  const fkDistinctArray = [...fkDistinct];
  const allFkExistInPk = fkDistinctArray.every(v => pkSet.has(v));
  const allPkExistInFk = [...pkSet].every(v => fkDistinct.has(v));
  if (hasDuplicates) {
    if (allFkExistInPk) return '1:*';
    return '*:*';
  }
  if (!allFkExistInPk) return '*:*';
  if (allPkExistInFk && pkSet.size === fkDistinct.size) return '1:1';
  return '1:*';
}

function detectDataModelRelationships(tables, existing = []) {
  const relationships = [...existing];
  const known = new Set(relationships.map(modelRelationshipKey));
  const tableList = tables || [];
  tableList.forEach((left, leftIndex) => {
    tableList.slice(leftIndex + 1).forEach(right => {
      const leftName = modelSingular(left.name);
      const rightName = modelSingular(right.name);
      const leftFields = modelFieldMeta(left);
      const rightFields = modelFieldMeta(right);
      let candidate = null;
      leftFields.forEach(leftField => {
        rightFields.forEach(rightField => {
          if (candidate) return;
          const leftCanonical = modelCanonical(leftField.name);
          const rightCanonical = modelCanonical(rightField.name);
          const leftPointsToRight = leftCanonical === rightName + 'id' || leftCanonical === rightName + 'key';
          const rightPointsToLeft = rightCanonical === leftName + 'id' || rightCanonical === leftName + 'key';
          const sameKey = leftCanonical === rightCanonical && leftCanonical !== 'id' && modelIsKeyName(leftField.name) && modelIsKeyName(rightField.name);
          if (!leftPointsToRight && !rightPointsToLeft && !sameKey) return;
          if (rightPointsToLeft) {
            const primary = leftFields.find(field => modelCanonical(field.name) === 'id') || leftFields.find(field => field.isKey) || leftField;
            candidate = { fromTableId: left.id, fromField: primary.name, toTableId: right.id, toField: rightField.name };
          } else if (leftPointsToRight) {
            const primary = rightFields.find(field => modelCanonical(field.name) === 'id') || rightFields.find(field => field.isKey) || rightField;
            candidate = { fromTableId: right.id, fromField: primary.name, toTableId: left.id, toField: leftField.name };
          } else {
            candidate = { fromTableId: left.id, fromField: leftField.name, toTableId: right.id, toField: rightField.name };
          }
        });
      });
      if (!candidate) return;
      const fromTable = tables.find(t => t.id === candidate.fromTableId);
      const toTable = tables.find(t => t.id === candidate.toTableId);
      const fromColIndex = modelFieldMeta(fromTable).findIndex(f => f.name === candidate.fromField);
      const toColIndex = modelFieldMeta(toTable).findIndex(f => f.name === candidate.toField);
      const fromValues = fromColIndex >= 0 ? modelColumnValues(fromTable, fromColIndex) : [];
      const toValues = toColIndex >= 0 ? modelColumnValues(toTable, toColIndex) : [];
      const cardinality = inferCardinality(fromValues, toValues);
      const relationship = {
        id: 'rel-' + Math.random().toString(36).slice(2, 9),
        ...candidate,
        cardinality,
        filterDirection: 'single',
        active: true,
        detected: true,
      };
      const key = modelRelationshipKey(relationship);
      if (!known.has(key)) {
        known.add(key);
        relationships.push(relationship);
      }
    });
  });
  return relationships;
}

export {
  MODEL_VERSION,
  modelCanonical,
  modelFieldMeta,
  modelIsKeyName,
  normalizeDataModel,
  detectDataModelRelationships,
  inferCardinality,
  modelRelationshipKey,
  modelRelationshipTitle,
};
