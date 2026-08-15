# PRODUCTION-READINESS-MISSION.md — Toolisto

> ETAPA de Production Readiness del sistema autónomo de OpenCode. Es una etapa, no el objetivo
> final: al crearse `workspace/PRODUCTION_READINESS_DONE` el runner NO se detiene: transiciona
> automáticamente al modo CONTINUOUS_EVOLUTION (`workspace/CONTINUOUS-EVOLUTION-MISSION.md`) y sigue.
> Updated: 2026-08-11
> Branch: feature/workspace-star-flow

## Objetivo

Llevar Toolisto a **Production Readiness**: un sitio estático local-first, gratuito y funcional
cuyas 167 herramientas producen resultados reales y verificables, sin errores de consola,
sin fuga de datos del usuario, con build y regresión limpios, y con documentación técnica al día.

Promesa del producto (AGENTS.md): "Convertir cualquier fotografía, archivo o documento
desorganizado en un resultado editable, calculable, visual y profesional sin salir del proyecto".

La misión se considera terminada **solo** cuando se crea `workspace/PRODUCTION_READINESS_DONE`
(ver criterios de DONE en este archivo). El DONE del ciclo anterior (`workspace/AUTONOMOUS_DONE.md`)
NO detiene esta misión.

## Prioridades generales (P0 > P1 > P2 > P3)

1. Funcionalidad real — cada herramienta produce un output real y verificable.
2. Fiabilidad — sin cuelgues, sin flujos rotos, regresión verde.
3. Seguridad — sin sanitización rota, sin comandos destructivos, sin claves.
4. Privacidad — local-first hermético: cero egress del contenido del usuario.
5. UX — flujos comprensibles, feedback claro, estados de error útiles.
6. Móvil — responsive en los viewports de la matriz (5 viewports) y en el workspace.
7. Rendimiento — lazy-load de dependencias pesadas (Tesseract, PDF, etc.), memoria estable.
8. Accesibilidad — contraste, ARIA, foco, texto alternativo, navegación por teclado.
9. SEO — sitemap, canonical, robots, OpenGraph, meta descripciones, indexado correcto.
10. Mantenimiento técnico — código muerto, arquitectura, build limpio, documentación.

## Objetivo conocido: pdfEncryptAdvanced

- [x] **COMPLETADO** (commit `fdec01d`, 2026-08-10): `pdfEncryptAdvanced` reconstruida con motor
      propio `js/security/pdf-encryptor.js` (security handler ISO 32000-1 §7.6: RC4-128 y AES-128),
      certificada con `tests/gate-e2e-pdf-encrypt.mjs` (35/35 PASS) contra pdf.js real, activada en
      `src/data/tools.json`, excluida de los gates legacy y documentada. Evidencia:
      `artifacts/deep-audit/toolisto/TLT-certify-pdf-encrypt-evidence.json`.
- Si en el futuro vuelve a quedar pendiente o se degrada, debe tratarse como P0.

## Qué hace una sesión nueva

1. Lee este MISSION, `PRODUCTION-READINESS-STATUS.md` y `PRODUCTION-READINESS-QUEUE.md`.
2. Revisa `AGENTS.md` (reglas permanentes) y el estado git real.
3. Selecciona la tarea ejecutable de mayor prioridad de la QUEUE (P0 > P1 > P2 > P3).
4. Ejecuta un ciclo atómico: AUDITAR → REPRODUCIR → IMPLEMENTAR → PROBAR → CORREGIR → REGRESIÓN → DOCUMENTAR → COMMIT.
5. Actualiza STATUS y QUEUE antes de terminar.
6. Nunca hace push. Nunca destruye trabajo. El usuario decide cuándo empujar al remoto.

## Criterios de DONE (para crear `workspace/PRODUCTION_READINESS_DONE`)

- No quedan tareas P0 ni P1 pendientes (todas DONE o justificadamente BLOCKED).
- No quedan P2 relevantes sin resolver.
- La regresión completa pasa (`node tests/run-all.mjs`), el build pasa (`npm run build`),
  el audit pasa (`npm test`).
- `git status` está limpio (sin cambios sin commitear al final del ciclo de cierre).
- STATUS y QUEUE reflejan el estado final; evidencia guardada en `artifacts/`.
- DONE se crea SOLO por cumplimiento real de los criterios, nunca por agotamiento de ciclos.
- Al crear DONE, el sistema **no se detiene**: el runner transiciona a CONTINUOUS_EVOLUTION
  y el siguiente ciclo ya opera con `workspace/CONTINUOUS-EVOLUTION-MISSION.md`.

## Límites técnicos documentados (no reabrir sin nueva información)

- OCR del fixture difícil: 76% chars / 43% words crudo con OEM 3; ninguna binarización/upscale
  probado supera la vía cruda (texto efectivo ~8px con ruido determinista). La extracción tabular
  normaliza el signo negativo (`1-30` → `-30`).
- `js/ocr/pdf-ocr-engine.js` (PDF searchable del sitio público) conserva su propio `ocrCanvas`
  con `EngineLoader`; queda fuera del refactor del workspace (limitación conocida).
- `enhanceScannedDocument` no tiene suite `gate-e2e` por nombre propio (cubierto indirectamente).
- Flake preexistente de visibilidad de navegación en `playwright-render.mjs` y
  `visual-audit-click-nav.mjs` (`element is not visible`), verificado ajeno a los cambios.
