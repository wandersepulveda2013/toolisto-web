# AUDITORÍA FORENSE DEL TRABAJO REALIZADO EN TOOLISTO

**Fecha de auditoría:** 2026-08-06
**Rama:** `feature/workspace-star-flow`
**HEAD auditado:** `5837d39` (feat(site): certifica las 9 herramientas de audio/video con harness 47/47)
**Método:** read-only. Sin modificaciones de código, sin commits, sin operaciones git destructivas. Todas las conclusiones se verificaron contra el HEAD actual con comandos ejecutados en esta sesión.

---

## FASE 1 — ESTADO DEL REPOSITORIO

### Ejecución registrada (comandos reales de esta sesión)

| Comando | Resultado |
|---|---|
| `git branch --show-current` | `feature/workspace-star-flow` |
| `git log --oneline --decorate -30` | HEAD `5837d39` — último commit: "feat(site): certifica las 9 herramientas de audio/video con harness 47/47" |
| `git status` | 16 archivos modificados sin stage + 3 untracked (ver tabla) |
| `git diff --cached` | vacío (nada en el index) |
| `git branch --all` | ramas locales `feature/workspace-star-flow` (actual), `feature/homepage-redesign`, `feature/rebuild-image-tools`, `feature/toolisto-workspace-v1`, `feature/workspace-adaptive-studio`, `fix/complete-batch3-functional-tools`, `master`, `recovery/toolisto-144-metadata`, `rescue/batch3-state`, más 9 ramas `backup/*` y 4 remotes |
| `git tag` | 4 tags de backup (ninguno de release semántico) |
| `node --version` / `npm --version` | v24.18.0 / 11.16.0 |
| `npm install` | OK, 0 vulnerabilidades (aviso `allow-scripts` para tesseract.js, no bloqueante) |
| `npm run build` | Build completo, **179 páginas en dist/**, validación OK |
| `npm test` (audit-count) | **APROBADO** (166 habilitadas / 1 en revisión, 167 páginas, 184 HTML, 121 procesadores, 39 handlers, 153 toolMeta, cobertura total) |
| `npm run test:batch1/2/3` | APROBADO (3/3) |
| `npm run test:workspace` | **PASS solo con server.js en :8080** (production-validation no es hermético); sin server FALLA |
| `node tests/run-all.mjs` | **15/18** en la pasada de esta sesión: Word Family, EPUB Family, PDF+Misc fallaron en secuencia; las tres pasan **standalone** (67/70/62 PASS, 0 FAIL). Es flakiness de carga secuencial, no regresión de código. |
| `node scripts/test-workspace-release.mjs` | **RELEASE GATE OK** (workspace-test 156/156, P3A 45/45, P3B 59/59, P11 106/106, OCR source 34/34, Star-Flow 83/83) — ejecutado en esta misma sesión tras los cambios OCR-PDF |

### Cambios sin commit (al momento de la auditoría)

| Archivo | Tipo | Qué contiene |
|---|---|---|
| `app.js` | M | +25: toolMeta/htmlByTool/optionAliases/validateToolFiles para las 4 herramientas OCR-PDF |
| `tool-processors.js` | M | +8: `imageToSearchablePdf` (embed canvas→JPEG + fix `imgEl`→`img.src`) y helpers |
| `js/ocr/pdf-ocr-engine.js` | M | +1: `slice(0)` para ArrayBuffer detachado por pdfjs |
| `src/data/tools.json` | M | +14: 4 herramientas OCR-PDF habilitadas |
| `index.html` | M | +24: páginas/tarjetas de las 4 herramientas |
| `tests/run-all.mjs` | M | +1: registra la suite OCR-PDF |
| `tests/gate-e2e-ocr-pdf-tools.mjs` | U | suite nueva 34/34 |
| `ROADMAP_200_TOOLS.md` | M | estado actualizado 166/1 |
| `MATRIZ_CERTIFICACION_*.csv` | M | 4 filas OCR-PDF → certified |
| 5× `TLT-certify-*.json` | M | evidencia regenerada de las pasadas de hoy |
| `artifacts/phase3c-validation/*` | M | evidencia Star-Flow/OCR regenerada |
| `artifacts/deep-audit/release-gate/release-gate-5837d39c.json` | U | manifest del release gate |

**Conclusión Fase 1:** Se trabajó en la rama correcta (`feature/workspace-star-flow`, la única rama con todos los fixes 3C/3D/3E según AGENTS.md). No hay commits de cierre falso evidentes en el `git log`: los 6 últimos commits de certificación (Word 67/67, EPUB 70/70, PDF+misc 62/62, AV 47/47) corresponden a harnesses funcionales que se pueden re-ejecutar y que **verifiqué yo mismo** en esta sesión (todos PASS standalone). `dist/` está gitignored y se regenera con el build (no hay divergencia source→dist rastreable en git; la sync workspace está verificada: `verify-workspace-sync.mjs` → SYNC OK).

---

## FASE 2 — RECONSTRUCCIÓN DEL ENCARGO ORIGINAL

### Documentos que el encargo pedía localizar

| Documento | Existe | Ubicación |
|---|---|---|
| `AGENTS.md` | ✅ | raíz |
| `opencode.json` | ✅ | raíz |
| `.opencode/agents/` | ✅ | `toolisto-autonomous.md` |
| `.opencode/commands/` | ✅ | `toolisto-cycle.md` |
| `workspace/AUTONOMOUS-ROADMAP.md` | ✅ | workspace/ |
| `workspace/AUTONOMOUS-STATUS.md` | ✅ | workspace/ (9 ciclos registrados) |
| `ROADMAP_200_TOOLS.md` | ✅ | raíz |
| `src/data/tools.json` | ✅ | 167 herramientas |
| `workspace/workspace.js` | ✅ | **6.822 líneas** (el roadmap dice 6834; diferencia menor) |
| `workspace/core/` | ✅ | **27 módulos** (bundle, db, storage, integrity, migrations, ocr-engine, workflow-*, etc.) |
| `MATRIZ_CERTIFICACION_HERRAMIENTAS_TOOLISTO.csv` | ✅ | `artifacts/deep-audit/toolisto/` (167 filas) |
| `tests/` `artifacts/` `dist/` `screenshots/` | ✅ | presentes |
| `PROMPT_OPENCODE_TOOLISTO.md` | ❌ **NO EXISTE** | no en ningún sitio del repo |
| `INSTRUCCIONES_OPENCODE.md` | ❌ **NO EXISTE** | idem |
| `INSTRUCCIONES_OPENCODE(1).md` | ❌ **NO EXISTE** | idem |
| `AUDITORIA_INTEGRAL_TOOLISTO_WORKSPACE.md` | ❌ **NO EXISTE** | idem |
| `MATRIZ_HALLAZGOS_TOOLISTO.csv` | ❌ **NO EXISTE** | la matriz de hallazgos real es `artifacts/deep-audit/paso3-p0-hallazgos.csv` (43 P0) |
| `PLAN_PRUEBAS_USUARIO_TOOLISTO.csv` | ❌ **NO EXISTE** | idem |
| `production-certification.json` | ❌ **NO EXISTE** | idem |
| `production-browser-fixtures.json` | ❌ **NO EXISTE** | idem |
| `production-browser-certification.js` | ❌ **NO EXISTE** | idem |
| `tools.json` (raíz) | ❌ **NO EXISTE** | solo existe `src/data/tools.json` (source canónico) |

> **Hallazgo estructural:** 9 de los 20 documentos que el encargo asumía como fuentes **no existen**. El trabajo de certificación se documenta en `ROADMAP_200_TOOLS.md`, la matriz de certificación y los `TLT-certify-*.json`, no en los archivos listados por el encargo.

### Tabla requisito → estado

| Fuente | Requisito | Prio | Criterio de aceptación (declarado) | Estado según documento | Estado real comprobado |
|---|---|---|---|---|---|
| ROADMAP_200_TOOLS.md | Expandir a 200 herramientas funcionales en navegador | — | herramientas activas solo si cumplen 12 puntos | 167 implementadas / 166 habilitadas | 167 en tools.json; **166 habilitadas real** (verificado) |
| ROADMAP_200_TOOLS.md | Certificación funcional por harness | P0 | harness con fixture real + descarga + reapertura + validación semántica | "166 certificadas y habilitadas" | **Solo 85 herramientas tienen harness E2E funcional** en `TLT-certify-*.json`; las otras 81 habilitadas se sustentan en checks estructurales. La frase "166 certificadas" es **inexacta** (habilitadas ≠ certificadas funcionalmente) |
| AGENTS.md / AUTONOMOUS-ROADMAP | Phase 3C completada con honestidad (fixture difícil medido) | P0 | medición sin umbral reducido | COMPLETA | Verificado: fixture difícil 76%/43% con OEM 3, fixture limpio 100/100 en E2E |
| AUTONOMOUS-ROADMAP | Pasos 3a/3b/4a/4b/5/6 (integridad, migraciones, bundle trust, prueba negativa de red) | P0 | suites + evidencia | COMPLETOS | Suites 52/52, 34/34, 43/43, 49/49, 51/51 existen y la evidencia está committeada; release gate OK |
| ROADMAP / matriz | Desactivar herramientas no certificadas | P0 | `enabled:false` con noindex | 1 en revisión (`pdfEncryptAdvanced`) | **Verificado** en tools.json; su página es noindex |

**Contradicciones detectadas entre documentos:**
1. **ROADMAP_200_TOOLS.md dice "166 certificadas y habilitadas" y declara la matriz como "fuente única de verdad", pero la matriz marca solo 138 herramientas "Publicar ahora=Sí"** (115 certified + 23 publish) y 29 "No". **28 herramientas** están habilitadas en `tools.json` y marcadas `No/disabled` en la matriz (toda la familia PDF 20 + 8 de imágenes): la matriz quedó desactualizada respecto a la certificación real. (Mismatch verificado con script en esta sesión: 28 discrepancias, 0 filas huérfanas.)
2. El AGENTS.md describe el flujo estrella y fases como completas; el estado real coincide, pero las afirmaciones "166 certificadas" y la matriz desactualizada son inconsistentes entre sí.
3. `workspace/AUTONOMOUS-STATUS.md` dice workspace.js ~6834 líneas; real 6822. Diferencia menor/no significativa.

---

## FASE 3 — INVENTARIO EXACTO DE LO REALIZADO

### Cambios principales relacionados con la certificación (commits recientes)

| Commit | Cambio | Intención | Conectado | Probado | Funcional | Estado real |
|---|---|---|---|---|---|---|
| `5837d39` | 9 herramientas AV + harness 47/47 | Certificación AV | ✅ (app.js, tool-processors, engine-loader, tools.json, index) | ✅ 47/47 | ✅ real (FFmpeg wasm, magic bytes, duration) | COMPLETO |
| `a8faf5a` | 8 herramientas PDF+misc 62/62 | Certificación PDF+misc | ✅ | ✅ 62/62 | ✅ real | COMPLETO |
| `05a433f` | 7 herramientas EPUB 70/70 | Certificación EPUB | ✅ | ✅ 70/70 | ✅ real | COMPLETO |
| `ba4e4cc` | 20 herramientas Word 67/67 | Certificación Word | ✅ | ✅ 67/67 | ✅ real | COMPLETO |
| `9257b00` | alinea seo-audit a convención `.html` | SEO | ✅ | ✅ 1989 checks 0 errores | estructural | COMPLETO |
| `06a06d7` | limpiar-firma, borrar-objetos, flujo-imágenes 21/21 | Editor visual | ✅ | ✅ 21/21 | ✅ real (píxeles) | COMPLETO |
| `8169e56` | 5 PDF interactivas 95/95 | PDF | ✅ | ✅ 95/95 | ✅ real | COMPLETO |
| `377bbdb` / `62e466b` | lotes PDF texto/maqueta 69/69, 46/46 | PDF | ✅ | ✅ | ✅ real | COMPLETO |
| `c063fc4` | 6 imágenes canvas 93/93 | Imágenes | ✅ | ✅ | ✅ real | COMPLETO |
| `06a11a7` | fix diálogo resultado vacío colorPicker/imageCompare | Bug real | ✅ | ✅ | ✅ real | COMPLETO |
| `5a579c2` | 14 Excel/CSV/JSON/XML 222/222 | Datos | ✅ | ✅ | ✅ real | COMPLETO |
| `ee8a222` | 23 herramientas fuera de matriz 240/240 | Certificación | ✅ | parcial | parcial | COMPLETO con alcance parcial |
| `15e279b` | seguridad y honestidad P0 (TLT-002/003/005/009/041/089/105/107) | Seguridad | ✅ | ✅ | parcial | COMPLETO documentado |
| `a5e01b7` | extracción OCR a core/ocr-engine.js | Refactor | ✅ | ✅ 712 tests | ✅ | COMPLETO |
| `d2dc7dc` | OEM 3 pipeline OCR | OCR difícil | ✅ | ✅ medición | ✅ | COMPLETO |
| `010e822` | prueba negativa de red (Paso 6) | Local-first | ✅ | ✅ 51/51 | ✅ | COMPLETO |
| `9d60b11` | bundle trust export/import (Paso 5) | Integridad | ✅ | ✅ 49/49 | ✅ | COMPLETO |
| `c15f697` | integridad referencial/cascada (Paso 4b) | Integridad | ✅ | ✅ 43/43 | ✅ | COMPLETO |
| `b9215c4` | migraciones IDB v1/v2/v3 (Paso 4a) | Persistencia | ✅ | ✅ 34/34 | ✅ | COMPLETO |
| `295a931` | bloqueo PDF manual + auditoría post-generación (Paso 3b) | Integridad | ✅ | ✅ 52/52 | ✅ | COMPLETO |
| `40a9ba5` | confianza OCR por celda + revisión (Paso 3a) | OCR | ✅ | ✅ | ✅ | COMPLETO |

### Cambios sin commit (OCR-PDF, auditados como en curso)
4 herramientas OCR-PDF con suite `tests/gate-e2e-ocr-pdf-tools.mjs` (34/34) y fix real (`imgEl`→`img.src` en `tool-processors.js:5257`, ArrayBuffer detach en `pdf-ocr-engine.js`). **Sin commit aún.** Las pruebas pasan; el commit y la actualización del roadmap quedan pendientes.

### Observaciones de inventario
- **Código muerto/duplicado:** `scripts/build-workspace-js.mjs` quedó intencionalmente como guard que aborta (documentado); no es código activo de build. No se detectó código muerto adicional en el alcance revisado.
- **Source vs dist:** `dist/` es gitignored y se regenera; `verify-workspace-sync.mjs` → SYNC OK. `npm run build` regenera 179 páginas y pasa validación.
- **Dependencias:** solo 4 devDependencies (`playwright`, `tesseract.js`, `@ffmpeg/*`) — coherente con el modelo local-first sin backend.

---

## FASE 4 — REVISIÓN DE TODOS LOS HALLAZGOS

**Aviso metodológico:** La `MATRIZ_HALLAZGOS_TOOLISTO.csv` solicitada **no existe**. La matriz de hallazgos real es `artifacts/deep-audit/paso3-p0-hallazgos.csv` (inventario P0 del Paso 3, citado en AGENTS.md y AUTONOMOUS-ROADMAP). Sobre ella se auditan los 43 hallazgos.

### Conteos de la matriz real (verificados con parser en esta sesión)
- **Total de filas:** 43 (todas P0).
- **Estados en el CSV:** Abierto 18, Resuelto 21, Parcial 4.
- **Concordancia:** el AGENTS.md y el AUTONOMOUS-ROADMAP declaran "21 Resuelto, 4 Parcial, 18 Abierto" → **coincide exactamente** con el CSV. No hay discrepancia de conteos en este inventario.
- **Discrepancia detectada:** el informe narrativo del AGENTS.md lista WSP-021/053 (sanitización "auditada"), WSP-059 ("locale explícito"), WDX-004 ("métricas exactas por token") como **Parciales** — coincide. Pero describe WSP-041 como parte de 3a resuelto ("parsing parseLocaleNumber... celdas inventadas 0 en el E2E") mientras el OCR crudo sigue produciendo `1-30`; la resolución es **a nivel de extracción tabular, no OCR** → reclasifico WSP-041 como PARCIAL.

### Estado real auditado por hallazgo (CSV completo en `AUDITORIA_FORENSE_HALLAZGOS.csv`)

Resumen de la reclasificación auditada (43 filas):

| Estado real auditado | Cantidad | Ejemplos |
|---|---|---|
| RESUELTO Y VERIFICADO | 20 | WSP-002/003 (build+sync), WSP-012 (cascada), WSP-013/014/015 (import atómico/manifiesto/límites), WSP-023/UXW-067/WDX-010 (red hermética), WSP-042/043/070 (revisión OCR), WSP-097/098, WDX-001/003/005/006/007, UXW-023 |
| PARCIAL | 6 | WSP-021/053 (innerHTML: suite pasa pero es estructural), WSP-041 (negativo normalizado en extracción, no en OCR), WSP-059, WDX-004, WSP-111/112 (Query/Dashboards/Flow "DEMO/limitado") |
| NO IMPLEMENTADO | 17 | WSP-001 (monolito: workspace.js sigue con 6.822 líneas), WSP-022 (auditoría SVG), WSP-079, WSP-096 (comprobaciones de existencia), UXW-001/011/021/022/031/039/054/061, WDX-008/009 |

**Hallazgos clave del inventario P0 contra HEAD:**
- **WSP-001 (monolito excesivo)** — **NO IMPLEMENTADO.** Se extrajeron 27 módulos a `workspace/core/`, pero `workspace/workspace.js` sigue siendo un monolito de **6.822 líneas** que concentra navegación, renderizado, OCR, documentos, tablas, diseño y coordinación. La extracción es parcial: los módulos core están separados, la shell no.
- **WSP-041/WDX-004/WSP-059/UXW-023 (negativos OCR)** — **PARCIAL.** El OCR crudo sigue leyendo `-30` como `1-30`; la normalización `normalizeOcrNumber` ocurre en `convertDocToTable` (extracción), no en el motor. La mitigación está verificada (Star-Flow 15/15 celdas), el defecto raíz del OCR no.
- **WSP-021/WSP-053 (innerHTML)** — **PARCIAL/estructural.** La suite `workspace-test` (156/156) pasa, pero valida estructura y sanitización por DOMParser, no hay modelo de bloques.
- **UXW-022 (tabla acepta celdas ausentes/inventadas)** — mitigado por el flujo de revisión OCR (modal con confianza + bloqueo de derivados). El estado en CSV es Abierto; la mitigación de 3a existe y está probada → lo mantengo NO IMPLEMENTADO (el hallazgo original no tiene corrección directa, solo mitigación) y lo explico en la fila.

---

## FASE 5 — CERTIFICACIÓN DE TODAS LAS HERRAMIENTAS

**Conteo real reconciliado:**
- `src/data/tools.json`: **167 herramientas** (no 133 ni 134). El roadmap cita 167 → coincide.
- Habilitadas: **166** (`enabled:true`); en revisión: **1** (`pdfEncryptAdvanced`, página noindex con aviso — verificado).
- Matriz de certificación: 167 filas, 0 filas huérfanas (todas mapean a tools.json), 28 filas desactualizadas (ver Fase 2).
- Páginas generadas: 179 HTML en dist/ (167 herramientas + 12 fijas/categorías) — audit-count verifica las 167 páginas.

**Certificación funcional real (verificado por harnesses con fixture real + descarga + reapertura + validación semántica):**

| Harness | Herramientas | Resultado |
|---|---|---|
| `verify-pdf-family` | 22 PDFLib | 95/95 |
| `verify-image-family` | 12 visual | 93/93 |
| `gate-e2e-image-tools` | 3 editor visual | 21/21 |
| `gate-e2e-word-tools` | 20 Word | 67/67 |
| `gate-e2e-epub-tools` | 7 EPUB | 70/70 |
| `gate-e2e-pdf-misc-tools` | 8 PDF/misc | 62/62 |
| `gate-e2e-av-tools` | 9 AV | 47/47 |
| `gate-e2e-ocr-pdf-tools` | 4 OCR-PDF | 34/34 |
| `verify-115-tools` | 29 rebuild (form-first) | 222/222 |
| `verify-23-tools` | 23 fuera de matriz | 240/240 |

**Unión de herramientas con harness funcional real: 85 de 166 habilitadas.** Las otras **81 habilitadas** se sustentan en:
- `verify-all-144` (existencia/presencia — estructural),
- `audit-count` (existencia/cards/páginas/robots — estructural),
- `batch1/2/3`, `comprehensive`, `qa`, `homepage-audit`, `seo-*` (estructurales).

**Conclusión honesta:** "166 habilitadas" ✅ (verdadero y verificable). "166 certificadas" ⚠️ **NO VERIFICADO**: solo 85 herramientas tienen certificación funcional E2E con fixture real, descarga, reapertura y validación semántica. Las 81 restantes están publicadas con cobertura estructural, lo que corresponde al estado **"PUBLICADA SIN CERTIFICACIÓN FUNCIONAL"** para esas 81. El CSV `AUDITORIA_FORENSE_HERRAMIENTAS.csv` (167 filas) clasifica cada herramienta con este criterio.

---

## FASE 6 — AUDITORÍA DE PRUEBAS

CSV completo: `AUDITORIA_FORENSE_PRUEBAS.csv` (40 suites). Comandos ejecutados en esta sesión (sin modificarlos):

| Comando | Resultado |
|---|---|
| `npm install` | OK, 0 vuln |
| `npm run build` | 179 páginas, validación OK |
| `npm test` | APROBADO |
| `npm run test:batch1` | APROBADO |
| `npm run test:batch2` | APROBADO |
| `npm run test:batch3` | APROBADO |
| `npm run test:workspace` | PASS con server.js; FALLA sin server |
| `node tests/run-all.mjs` | 15/18 (flakes secuenciales, pasan standalone) |
| `node scripts/test-workspace-release.mjs` | RELEASE GATE OK |
| `node tests/gate-e2e-word-tools.mjs` | 67/67 |
| `node tests/gate-e2e-epub-tools.mjs` | 70/70 |
| `node tests/gate-e2e-pdf-misc-tools.mjs` | 62/62 |

### Clasificación de suites
- **FUNCIONAL REAL E2E** (navegador + fixture real + descarga + reapertura + semántica): los 9 harnesses `gate-e2e-*` / `verify-*-family`, `phase3c-star-flow`, `workspace-stability`, `phase6-network-negative`.
- **INTEGRACIÓN** (IndexedDB real, sin navegador): `phase3-integrity`, `phase4-migrations`, `phase4-integrity`, `phase5-bundle-trust`, `session-recovery`, `deep-regression`, `workflow-*`.
- **UNIT**: `history-manager`, `workspace-storage`, `error-manager`, `tabular`, `workflow-*`, `operation-registry`, etc.
- **ESTRUCTURAL / sintaxis / existencia**: `audit-count`, `verify-all-144`, `batch1/2/3`, `comprehensive`, `qa`, `homepage-audit`, `seo-*`, `alias-restrictions`, `slug-audit`, `workspace-test`, `phase11-audit`, `phase3a/3b`.

### Problemas detectados en las pruebas
1. **`verify-23-tools` y `verify-all-144`** mezclan checks de presencia con algunos funcionales; no reabren el resultado de forma sistemática → "certificación" parcial.
2. **`production-validation.mjs` no es hermético**: hardcodea `http://localhost:8080` y necesita `server.js` externo. Falla sin server (dependencia de entorno, no regresión).
3. **`run-all.mjs` presenta flakes bajo carga secuencial**: Word/EPUB/PDF+Misc fallaron en secuencia pero pasan standalone (67/70/62). No hay reintentos para ocultarlos (correcto), pero el agregador es inestable.
4. **No hay pruebas que reabran resultados para las 81 herramientas sin harness**: ese vacío no está declarado en ningún documento.
5. Los `TLT-certify-*.json` guardan `tools`, `fixes`, `checks`, `passed/failed` — buenos artefactos, pero solo existen para los 85 tools con harness.

---

## FASE 7 — WORKSPACE

Verificación expresa contra HEAD (comandos de esta sesión + evidence committeado):

| Verificación | Resultado | Evidencia |
|---|---|---|
| **OCR conserva negativos** | ⚠️ PARCIAL: el OCR crudo emite `1-30`; `convertDocToTable` lo normaliza a `-30` (mitigación en extracción) | Star-Flow 83/83, 15/15 celdas; `core/ocr-engine.js` 52 líneas |
| **Tabla con valores inventados/ausentes** | Mitigado por revisión OCR: celdas con confianza <85 se resaltan y bloquean derivados; flujo de revisión `draft/reviewed/verified` | `phase3-integrity-test.mjs` 52/52 |
| **Gráfico refleja datos aprobados** | ✅ bloqueado hasta que la tabla esté revisada (`createChartFromTable`) | phase3-integrity |
| **PDF refleja gráfico/tabla** | ✅ bloqueo de export con fuente incierta + auditoría post-generación `pdf-validation` | phase3-integrity |
| **Recuperación de sesión** | ✅ IndexedDB (5 sesiones), dialogo de recuperación, autosave 5s, beforeunload | `session-recovery` 24/24 |
| **Export/import `.toolisto` conserva relaciones** | ✅ manifiesto schemaVersion 3, checksums SHA-256, import atómico, remapeo completo | `phase5-bundle-trust` 49/49 |
| **Source ↔ dist** | ✅ `verify-workspace-sync.mjs` SYNC OK; `dist/` gitignored y generado | comando ejecutado |
| **Tests usan navegador real y producto construido** | ✅ Star-Flow y harnesses sirven `dist/` real con Playwright; suites Node usan IndexedDB real | ejecutado |
| **Local-first hermético** | ✅ prueba negativa de red 51/51 (marcador nunca sale; intercepta fetch/XHR/beacon/WS; Google Fonts eliminadas) | `phase6-network-negative-evidence.json` |

**Arquitectura:** `workspace.js` 6.822 líneas (shell + renderizado + OCR + documentos + tablas + diseño) + 27 módulos `core/` + ~20 módulos `workflow-*`/`instruction-*`. La separación por dominios es **parcial**: los módulos core existen y son usados, pero la shell sigue siendo monolítica (WSP-001 abierto).

---

## FASE 8 — TRABAJO QUE PARECE COMPLETADO, PERO NO ESTÁ DEMOSTRADO

# TRABAJO QUE PARECE COMPLETADO, PERO NO ESTÁ DEMOSTRADO

1. **"166 herramientas certificadas" (ROADMAP_200_TOOLS.md líneas 8-12).** Las 166 están *habilitadas* (verificado), pero solo **85** tienen certificación funcional E2E real. Las 81 restantes están publicadas con cobertura estructural (existencia de página/procesador). La palabra "certificadas" no está respaldada para esas 81.
2. **Matriz de certificación como "fuente única de verdad".** La matriz tiene **28 filas desactualizadas** (marca `No/disabled` herramientas que hoy están `enabled:true` en tools.json y certificadas por harness). El documento que la declara fuente de verdad contradice la realidad que describe.
3. **WSP-041/WDX-004 "resueltos" (negativos OCR).** La lectura `1-30` persiste en el OCR; solo se normaliza en la extracción tabular. Es mitigación, no resolución del hallazgo raíz.
4. **WSP-021/WSP-053 "innerHTML auditado".** La suite `workspace-test` (156/156) pasa, pero es estructural; el "modelo de bloques" exigido por la corrección no existe.
5. **`verify-23-tools` "240/240" y `verify-all-144` "144/144".** Mezclan checks de presencia con funcionales y no reabren resultados de forma sistemática; no demuestran certificación funcional plena.
6. **`production-certification.json` / `production-browser-certification.js`** — citados por el encargo como existentes; **no existen**. No hay un artefacto único de "certificación de producción" más allá de los `TLT-certify-*.json` por familia.
7. **`build exitoso` ≠ `producto funcional`:** el build de 179 páginas pasa, pero no demuestra que las 166 herramientas procesen archivos reales (véase punto 1).
8. **`descarga` ≠ `archivo válido`:** los harnesses de las 85 sí validan magic bytes/reapertura; las demás no tienen ese check.
9. **`run-all 18/18`:** en esta sesión dio 15/18 por flakes secuenciales; la afirmación "0 fallos" del agregador es dependiente del estado de carga. (Los suites pasan standalone.)

---

## FASE 9 — QUÉ FALTA

### P0 pendientes (de inventario + auditoría)

| ID | Descripción | Archivos | Causa | Corrección | Prueba de aceptación | Dependencia | Riesgo |
|---|---|---|---|---|---|---|---|
| WSP-001 | Monolito `workspace.js` 6.822 líneas | `workspace/workspace.js`, `workspace/core/*` | shell no descompuesta | Extraer shell/navegación/renderizado por dominios | suite de estructura + regresión completa | arquitectónica | Alto (refactor grande) |
| WSP-041/WDX-004 | OCR crudo pierde signo `-30`→`1-30` | `core/ocr-engine.js`, preprocesado | límite del motor sobre ~8px ruidosos | mejora de preprocesado OCR documentada como límite | medición difícil >76% chars | investigación OCR | Medio |
| WSP-022 | Auditoría SVG/atributos complejos en gráficos | tests + renderizador gráficos | alcance | test de XSS SVG importado | test de seguridad | — | Medio |
| WSP-096/WDX-008/WDX-009 | Comprobaciones de existencia en vez de funcionales | tests | metodología | sustituir por pruebas funcionales (reabrir resultado) | cobertura por tool | time | Alto |
| WSP-111/WSP-112 | Query/Dashboards/Flow "DEMO/limitado" | workspace | alcance de producto | definir y completar o documentar como límite | roadmap | decisión de producto | Alto |
| UXW-001/011/021/022/031/039/054/061 | Coherencia UX, celdas inventadas, innerHTML, pruebas estructurales | UI/workspace/tests | alcance | ver PLAN para detalle | — | — | Medio |

### P1/P2 pendientes
- `protectPdf`, `unlockPdf`, `flattenPdf`, `extractTextPdf`, `extractImagesPdf`, `fillFormPdf`, `annotatePdf`, `redactPdf`, `bookmarkPdf` (Fase 1 roadmap) y las 4 herramientas PPTX (requieren librería `pptx` con autorización): **no implementadas** en tools.json (ni siquiera existen como páginas). El roadmap las marca "Pendiente".

### Clasificación por dependencia
- **Con dependencias actuales (hacer ahora):** actualizar la matriz de certificación (28 filas), añadir harnesses funcionales a las 81 herramientas sin ellos, hacer `production-validation` hermético, estabilizar `run-all`, sustituir checks de existencia por funcionales, extraer shell del workspace.
- **Requiere otra librería:** PPTX (autorización), modelo de bloques para innerHTML (decisión de diseño).
- **Requiere backend:** ninguno (producto local-first).
- **Requiere navegador real:** la certificación funcional de las 81 herramientas.
- **Requiere decisión de producto:** Query/Dashboards/Flow (DEMO vs completo), alcance del modelo de bloques.
- **Debe permanecer desactivado:** `pdfEncryptAdvanced` hasta tener motor (o documentar límite).

---

## FASE 10 — RECOMENDACIÓN PARA CODEX

Ver `PLAN_REAL_PENDIENTE_CODEX.md` (entregable adjunto) con 10 lotes pequeños y verificables.

---

## ANEXO — Datos brutos de la sesión

- `git status --short`: 16 M + 3 ?? (sin stage).
- `git diff --stat`: 16 archivos, +295/−243.
- Matriz CSV: 167 filas, 138 "Publicar ahora=Sí", 29 "No", 28 discrepancias vs tools.json.
- tools.json: 167 total, 166 enabled, 1 disabled (`pdfEncryptAdvanced`).
- Harness coverage: 85/166 con harness E2E funcional.
- Hallazgos P0: 43 totales (21 Resuelto/4 Parcial/18 Abierto según CSV); reclasificación auditada 20/6/17 (ver CSV).
- workspace.js: 6.822 líneas; `core/`: 27 módulos.
- Release gate: OK (manifest `release-gate-5837d39c1f22e1bc246f9f7ff5dfae46087fe701.json`).
- Node v24.18.0, npm 11.16.0.
