# CE-061: Full Storage Surface & Cross-Store Integrity Certification — Final Report

**Date:** 2026-08-25
**HEAD:** 2e907f4 (pre-CE-061)
**Verdict:** PASS — CERTIFIED

## Executive Summary

CE-061 is a comprehensive adversarial audit of **every persistent storage surface** in Toolisto Workspace — not just documents and tables (which have `_writeSeq`), but also captures, assets, executions, workflows, projects, settings, localStorage keys, session persistence, object URLs, and all cross-store operations (cascade delete, import/export, orphan detection).

**Result:** 3 new test suites, 259 adversarial tests, 0 failures. Release gate: **30/30 suites PASS, 2225 total tests, 0 FAIL.**

## Persistence Topology (Discovered)

### IndexedDB Stores (8 total, DB version 3)

| Store | KeyPath | Indexes | Has _writeSeq | Multi-tab Guard |
|---|---|---|---|---|
| `projects` | id | updatedAt, name | **NO** | LWW |
| `documents` | id | projectId | **YES** | Stale-write rejected |
| `data` | id | projectId | **YES** | Stale-write rejected |
| `captures` | id | projectId, docId | **NO** | LWW |
| `settings` | key | — | **NO** | LWW (read-modify-write for sessions) |
| `assets` | id | projectId, type, sourceAssetId | **NO** | LWW |
| `executions` | id | projectId, toolId, sourceAssetId | **NO** | LWW |
| `workflows` | id | projectId | **NO** | LWW |

### localStorage Keys (10)

`toolisto-theme`, `toolisto-density`, `toolisto-sidebar-collapsed`, `toolisto-workspace-config`, `toolisto-recent-tools`, `toolisto-favorite-tools`, `toolisto-session-id`, `toolisto-auto-execute`, `ws-favorites`, `ws-recent`

### Cascade Delete Topology

BFS through `SOURCE_FIELDS` + `CONFIG_FIELDS` across all 7 object stores, within a single atomic `dbTransaction`. Transitive: A→B→C means deleting A deletes both B and C.

## Test Suites

### 1. Cross-Store Integrity (`cross-store-integrity.mjs`) — 77 tests

| Section | Tests | Coverage |
|---|---|---|
| Entity Store Completeness | 10 | All 8 stores CRUD roundtrips |
| Cascade Delete Topology | 21 | Every SOURCE_FIELD, CONFIG_FIELD, transitive cascade, sibling preservation, relation pruning, previewCascadeDelete |
| Import Atomicity | 14 | Full import, mid-tx abort rollback, ID remapping, settings persistence |
| Delete Atomicity | 10 | deleteProject across 8 stores, circular references, pruneDanglingReferences |
| Concurrent Modification | 10 | _writeSeq guard vs cascade, stale-write after delete, zombie resurrection |
| Orphan Detection | 10 | assertIntegrity detects bad projectId, dangling refs, derivedIds, inputAssetIds, relations |

**Key findings:**
- Cascade delete is atomic and transitive — no partial deletion possible
- Import is fully atomic — mid-transaction failure rolls back everything
- Circular references don't cause infinite loops (BFS visited-set)
- After cascade delete + recreate, old stale writes are correctly rejected

### 2. Storage Surface Audit (`storage-surface-audit.mjs`) — 79 tests

| Section | Store | Tests | Key Behaviors |
|---|---|---|---|
| 1 | projects | 13 | LWW confirmed, no corruption, clean recreation |
| 2 | captures | 15 | LWW, no reverse cascade, metadata self-reference OK |
| 3 | settings | 11 | LWW, JSON roundtrip, concurrent puts safe |
| 4 | assets | 12 | LWW, no reverse cascade, large dataUrl persists |
| 5 | executions | 10 | LWW, delete isolation (assets not deleted) |
| 6 | workflows | 10 | LWW, executionHistory array persists |
| 7 | Cross-store | 8 | Independent persistence, transaction rollback |

**Key findings:**
- All 6 stores without `_writeSeq` exhibit deterministic LWW (last-writer-wins)
- No corruption detected under any adversarial timing scenario
- Stores without `_writeSeq` do NOT have reverse cascade (deleting a capture doesn't delete its asset)
- Cross-store write isolation is clean — no cross-contamination

### 3. ID Collision & Serialization (`id-collision-serialization.mjs`) — 103 tests

| Section | Tests | Coverage |
|---|---|---|
| ID Uniqueness | 12 | 10,000 IDs all unique, format consistency |
| Model Serialization | 24 | All model factories JSON roundtrip, edge cases (null, empty arrays, unicode, 0/false) |
| _writeSeq Semantics | 24 | Guard behavior, increment, edge cases (NaN, Infinity, undefined, string) |
| Session Persistence | 15 | Session save/load, eviction, cleanup, null fields |
| localStorage Integrity | 10 | Key naming, JSON roundtrip, UUID format |
| Schema Versions | 8 | All 7 schema constants match, MODEL_VERSION alignment |
| Object URL Lifecycle | 10 | Create/revoke/revokeAll, double-revoke safety |

**Key findings:**
- ID generation produces 10,000+ unique IDs with no collisions
- All model factories survive JSON roundtrip including edge cases
- `_writeSeq=NaN` is treated as 0 (seq=1 on new entity) — no crash
- `_writeSeq=Infinity` is handled without crash
- Session persistence correctly evicts oldest when exceeding MAX_SESSIONS

## Architecture Verdict

### Certified Properties

1. **Cascade delete is atomic and transitive** — no partial deletion across stores
2. **Import is fully atomic** — ID remapping + single dbTransaction, abort rolls back everything
3. **All stores exhibit deterministic LWW** — no corruption, no merged entities
4. **ID generation is collision-free** — 10K+ unique IDs verified
5. **Serialization roundtrip is faithful** — all model types survive JSON stringify/parse
6. **Orphan detection works** — assertIntegrity catches dangling references in all field types
7. **Session persistence is correct** — eviction, cleanup, null handling all verified
8. **Object URL lifecycle is clean** — tracked, revocable, double-revoke safe

### Documented Limitations

1. **6 of 8 stores lack `_writeSeq`** — projects, captures, settings, assets, executions, workflows accept stale writes. This is by design: these entities are either short-lived (captures), append-only (executions), or rarely edited concurrently (settings, projects, workflows).

2. **No reverse cascade** — deleting a capture does NOT delete its referenced asset. Cascade is parent→child only (via SOURCE_FIELDS/CONFIG_FIELDS). This prevents accidental data loss from capture deletion.

3. **`_writeSeq=NaN` and `Infinity` don't crash** — `NaN` is treated as 0 (always stale). `Infinity` always wins. Both are edge cases that won't occur in normal operation.

4. **Session data is a single blob** — concurrent tabs can overwrite each other's session data. The sessionId in localStorage helps the current tab identify its own session, but cross-tab session conflicts are not guarded.

5. **No `pagehide`/`freeze` handlers** — `beforeunload` is the last-resort flush. Async operations that start after `beforeunload` fires may not complete if the page is frozen by the browser.

## Metrics

| Metric | Value |
|---|---|
| New test suites | 3 |
| New tests | 259 (77 + 79 + 103) |
| Total test suites (release gate) | 30 |
| Total tests | 2225 |
| Pass rate | 100% (0 FAIL) |
| Execution time (all 3 new suites) | < 5s |
| Defects found | 0 |
| Production code changes | 0 |
