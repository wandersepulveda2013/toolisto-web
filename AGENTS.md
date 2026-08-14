# Toolisto — Reglas permanentes para agentes autónomos

## Identidad del producto

Toolisto es un Workspace gratuito y local-first cuya promesa es:

"Convertir cualquier fotografía, archivo o documento desorganizado en un resultado editable, calculable, visual y profesional sin salir del proyecto".

Flujo estrella:
`archivo → escaneo → OCR → documento → tabla → gráfico → informe → PDF`

## Restricciones de Phase 3C

- No añadir herramientas durante Phase 3C.
- No añadir módulos.
- No ampliar Flow, Query, ni Dashboards.
- No rediseñar la interfaz.
- No modificar las 144 rutas existentes.
- No crear botones decorativos.
- No regenerar `workspace/workspace.js` con `scripts/build-workspace-js.mjs`.
- No usar mocks en el E2E principal.
- No eliminar pruebas fallidas.
- No bajar criterios para hacer pasar pruebas.
- No cambiar el texto esperado para ajustarlo al OCR incorrecto.
- No utilizar reintentos para ocultar inestabilidad.
- No aumentar timeouts globales.
- No declarar una fase terminada con pruebas fallidas.
- No describir una función parcial como completa.
- No instalar dependencias sin justificar necesidad, tamaño y carga.
- No introducir servicios de pago ni API keys.
- No duplicar imágenes grandes en IndexedDB.
- No almacenar URLs `blob:` como referencias persistentes.
- No usar emojis como iconos.
- No utilizar Times New Roman.
- Mantener la interfaz en español.

## Git

Prohibido:
- `git push`, `git merge`, `git rebase`, `git reset`, `git clean`
- eliminación de ramas, force checkout, force push
- cualquier comando destructivo equivalente

Permitido:
- `git status`, `git diff`, `git log`, `git show`
- `git add`, `git commit`
- creación de ramas de respaldo

## Definición de terminado

Una tarea solo está completa cuando:
1. La implementación existe.
2. La interfaz realmente la utiliza.
3. La persistencia funciona.
4. Las pruebas relevantes pasan.
5. Fue validada en navegador cuando corresponde.
6. No hay errores de consola no controlados.
7. La evidencia fue guardada.
8. Las limitaciones están documentadas.
9. Se creó un commit descriptivo.
10. Se actualizó el roadmap.

## Estado actual verificado

- Phase 3B: COMPLETA.
- Phase 3C: COMPLETA (fixture difícil medido honestamente; pipeline OCR mejora como TODO).
- E2E Star-Flow: 83/83.
- OCR Source Selection: 34/34.
- Phase 3A: 45/45.
- Phase 3B tests: 59/59.
- Phase 11: 106/106.
- Workspace structure: 156/156.
- Phase 3 integridad (3a/3b): 52/52.
- Phase 4a migraciones: 34/34.
- Phase 4b integridad referencial: 43/43.
- Phase 5 bundle trust (export/import): 49/49.
- Phase 6 prueba negativa de red: 51/51 (intercepta fetch/XHR/beacon/WebSocket; marcador secreto nunca sale por red; cero egress externo).
- Total: 712 pass, 0 fail, 712 tests.

El modelo OCR `spa.traineddata.gz` se sirve localmente (`vendor/tesseract/lang-data`) para tiempos E2E estables.
La extracción doc-to-table reconstruye columnas por ancla numérica y normaliza el signo negativo del OCR: 15/15 celdas en el Star-Flow.
`extractTextFromScan` ya NO hace upscale ≥800px: degradaba imágenes ruidosas (74%→47% chars en el fixture difícil) y producía el artefacto `1-30` en el limpio. Fixture limpio verificado al 100% chars / 100% words en el E2E integrado.
Desde 2026-08-03 el OCR usa OEM 3 (DEFAULT: LSTM + legacy, Tesseract elige el mejor por bloque) en `vendor/js/engine-loader.js`: mejora el fixture difícil a 76% chars / 43% words (desde 74%/39%) SIN degradar el limpio (sigue 100/100). La mejora de preprocesado para el difícil queda como límite documentado (el texto efectivo es ~8px con ruido determinista; ninguna binarización/upscale probado supera a la vía cruda con OEM 3).

## Sistema autónomo (OpenCode — Evolución Continua)

El sistema corre en **Evolución Continua** (etapa Production Readiness cerrada al aparecer
`workspace/PRODUCTION_READINESS_DONE`). El runner NO se detiene por backlog vacío ni por DONE:
al crearse DONE transiciona solo a CONTINUOUS_EVOLUTION y sigue. Solo un humano lo detiene
(`AUTONOMOUS_STOP`), o un límite de ciclos explícito, o un fallo grave de su propia infraestructura.
Archivos canónicos:

- `workspace/AUTONOMOUS-CONTEXT.md` — dispatcher de modo (PR vs CE).
- `workspace/CONTINUOUS-EVOLUTION-MISSION.md` / `-STATUS.md` / `-QUEUE.md` — misión permanente,
  memoria persistente y backlog (TODO/ACTIVE/BLOCKED/DONE/DISCOVERED/DEFERRED; P0>P1>P2>P3).
- `workspace/PRODUCTION-READINESS-MISSION.md` / `-STATUS.md` / `-QUEUE.md` — etapa previa (PR).
- `RUN-OPENCODE-AUTONOMOUS.ps1` — runner v2 (`-Unlimited`/`MaxCycles 0` = sin límite, backoff
  1/5/15/30 min, métricas por ciclo, transición PR→CE, logs en `artifacts/autonomous-logs/`).
- `STATUS-OPENCODE-AUTONOMOUS.ps1` / `STOP-OPENCODE-AUTONOMOUS.ps1` — estado (modo, uptime,
  productividad, regla de salud) y parada suave.
- `WATCHDOG-OPENCODE-AUTONOMOUS.ps1` / `INSTALL-OPENCODE-AUTO-START.ps1` — vigilancia de ciclos
  colgados y arranque automático opcional al iniciar sesión.
- `workspace/OPENCODE-AUTONOMOUS-GUIDE.md` — guía de uso.

Reglas del orquestador: un ciclo = una tarea atómica; sesión nueva de OpenCode por ciclo; memoria
solo en repo (MISSION/STATUS/QUEUE/git/evidencias); resultado mínimo por ciclo
(FEATURE/BUG_FIX/PERFORMANCE_IMPROVEMENT/UX_IMPROVEMENT/ARCHITECTURE_IMPROVEMENT/SECURITY_FIX/
MEANINGFUL_TEST_COVERAGE/DOCUMENTED_BLOCKER), anti-ciclo-vacío, anti-churn de evidencia y flake
limitado a ~3 intentos (BLOCKED_FLAKY). El antiguo `workspace/AUTONOMOUS_DONE.md` NO detiene nada.

### Anti-bucle (obligatorio para todos los ciclos)

- **Tarea ACTIVE estancada**: si una tarea lleva >= 2 ciclos ACTIVE sin cambio de HEAD y conserva
  el mismo fallo reproducible, el siguiente ciclo entra en modo RECOVERY de esa tarea: cambia de
  estrategia de diagnóstico, demuestra la causa raíz (navegador real cuando corresponda) y la cierra
  o degrada con plan concreto. Un ciclo con HEAD sin cambio y el mismo fallo NO cuenta como progreso.
- **Cambio de técnica**: si una técnica falla o rechaza permisos en un ciclo, el siguiente usa otra;
  no reintentar la misma ruta esperando otro resultado.
- **Scripts de diagnóstico**: exclusivamente en `_toolisto_autopilot/tmp/` dentro del repositorio.
  PROHIBIDO `%TEMP%`, `AppData\Local\Temp` y `external_directory` para debugging.
- **PowerShell en Windows**: solo comandos disponibles (Get-Content, Select-String, Select-Object,
  Get-ChildItem, Where-Object, Measure-Object); PROHIBIDO `rg`/`head`/`tail`/`grep`/`sed`/`awk`.

## Puerto del servidor

El servidor E2E usa `E2E_PORT` (por defecto 8082). Las suites Node usan puerto 8081.

## Evidencia determinista

Toda evidencia `TLT-*.json` escrita por un gate debe pasar por `tests/evidence-helper.mjs`
(`writeEvidence`): sin timestamps absolutos, sin puertos efímeros de loopback y con claves
ordenadas de forma estable. Regenerar una evidencia debe producir diff cero;
`tests/evidence-determinism.mjs` protege esta regla dentro de `node tests/run-all.mjs`.
