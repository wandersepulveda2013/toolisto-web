/**
 * core/schema-versions.js — Centralized version registry for all schema axes.
 *
 * Each axis evolves independently. A higher number in one axis does NOT
 * force advancement in another. Import from here — never hardcode version
 * literals in business logic.
 */

export const OBJECT_SCHEMA_VERSION = 2;
export const DB_SCHEMA_VERSION = 3;
export const BUNDLE_SCHEMA_VERSION = 3;
export const STORAGE_ENVELOPE_VERSION = 2;
export const SESSION_SCHEMA_VERSION = 1;
export const DATA_MODEL_SCHEMA_VERSION = 1;
export const WORKFLOW_DEFINITION_VERSION = 1;
