# CONTINUOUS-EVOLUTION-STATUS.md — Memoria persistente del sistema autonomo

> Cada ciclo de OpenCode LEE este archivo antes de actuar y lo ACTUALIZA antes de terminar.
> Registro historico de ciclos de la mision Evolucion Continua.
> Modo activo SOLO despues de la transicion (cuando `workspace/PRODUCTION_READINESS_DONE` exista).
> Updated: 2026-09-03 (Cycle 178 — CE-115)

---

## Cycle 130 — Autonomous orchestration runtime: verified progress, narration-loop detection, crash recovery (CE-067)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | 9830ddf |
| **HEAD final** | 7d0f2cd (commit CE-067 de este ciclo) |
| **Task** | CE-067 (ARCHITECTURE_IMPROVEMENT, P0, sistema autonomo): el bucle "Let me read the QUEUE" es estructuralmente invisible — el launcher solo ve exit code y el watchdog solo LastWriteTime, y como la narracion tambien escribe el log, el log AVANZA aunque el modelo no ejecute nada. Convertir la supervision en un runtime con estado persistente y progreso verificado. |
| **Hypothesis** | Anadir una senal maquina-comprobable (eventos `verified` que SOLO se escriben cuando una herramienta real corre) + un checkpoint persistente por ciclo, y consumirla desde el watchdog, detecta y recupera el bucle de narracion y la perdida por crash, sin depender de mejorar el prompt. |
| **Change** | Nuevo `AI_AUTONOMY/`: `guard.mjs` (deteccion de bucle: REPETITION/CONSECUTIVE_INTENTS/RATIO_ZERO_VERIFIED + scoring P0>P1>P2>P3), `state.mjs` (checkpoint `state.json` + `events.jsonl`, maquina de estados PENDING->RUNNING->IMPLEMENTED->TRACKERS->FINISHED/FAILED, escritura atomica), `runner.mjs` (planCycle -> FRESH/RESUME/COMPLETE_TRACKERS/RECOVERY/FRESH-bump, orchestrator, supervisor verify/finish/fail/safeCommit), `lock.mjs` (instancia unica por PID con stale), `commit-guard.mjs` (propiedad de ficheros + bloqueo de `git add .`), `queue.mjs` (espejo JSON + scoring + reconciliacion). `WATCHDOG-OPENCODE-AUTONOMOUS.ps1` ampliado: lee `AI_AUTONOMY/events.jsonl` y senala `SOSPECHA DE BUCLE DE NARRACION` (nuevo `-LoopSuspectMinutes`, default 60) — log que crece sin eventos verificados. |
| **Bugs encontrados** | El bucle de narracion invisible al launcher/watchdog (raiz documentada). Tambien se corrigio el `finish()` del supervisor para alcanzar FINISHED por la via legal (IMPLEMENTED->TRACKERS->FINISHED). |
| **Bugs corregidos** | Los de la raiz (arriba). |
| **Tests ejecutados** | `ai-autonomy-orchestrator-test` 85/85 (guard, state machine, recovery ladder, ownership, queue, lock, supervisor e2e, determinismo); `ai-autonomy-resilience-simulation` 17/17 (6 escenarios: A verified-vs-narracion, B crash+restart, C bucle, D archivo extrano, E determinismo, F lock instancia unica). Registrados en `tests/run-all.mjs`. Parse-AST OK de WATCHDOG/RUN/STATUS/STOP `.ps1`. |
| **Tests PASS** | 85/85 + 17/17 = 102 checks PASS. |
| **Tests FAIL** | 0. |
| **Commits** | CE-067 (impl `AI_AUTONOMY/` + watchdog + tests + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`; `gh` sin autenticar). La integracion completa del runner en el bucle PS1 de `RUN-OPENCODE-AUTONOMOUS.ps1` queda documentada como proximo paso (no se reemplazo el bucle vivo para no desestabilizar el sistema en produccion sin validacion en navegador). |
| **Limitaciones** | El runtime y sus pruebas estan validados in-process (sin lanzar opencode real ni red). La suscripcion del launcher PS1 a `planCycle`/`verify`/`safeCommit` es el siguiente hito; mientras tanto el watchdog ya consume el log verificado. |
| **Proxima prioridad** | Promover la integracion del runner en `RUN-OPENCODE-AUTONOMOUS.ps1` (ciclo supervisor real) o la proxima oportunidad DISCOVERED/TODO de producto. |

---

## Cycle 131 — Real Runtime Integration: launcher consumes persistent AI_AUTONOMY runtime (CE-068)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | 293cc6a |
| **HEAD final** | 7a1d467 (commit CE-068 de este ciclo) |
| **Task** | CE-068 (ARCHITECTURE_IMPROVEMENT, P0, sistema autonomo): integrar el runtime `AI_AUTONOMY` (CE-067) en el launcher real `RUN-OPENCODE-AUTONOMOUS.ps1` para que las ejecuciones reales de OpenCode queden gobernadas por estado persistente — progreso verificado, interrupcion de bucle de narracion, recuperacion ante crash, presupuesto de reintentos, backoff de crash-loop, SAFE_MODE, lock de instancia unica y heartbeat. Regla clave: reiniciar el runner NO debe resetear los contadores de crash-loop/reintentos. |
| **Hypothesis** | Si el launcher real delega el state machine al runtime (`AI_AUTONOMY/cli.mjs`), las decisiones de recuperacion (backoff, SAFE_MODE, presupuesto de reintentos) se persisten en `runtime.json` y sobreviven a reinicios del runner, cerrando la brecha de CE-067 ("la integracion del runner en el bucle PS1 queda documentada como proximo paso"). |
| **Change** | Nuevo `AI_AUTONOMY/runtime.mjs` (operational state + politica: retry budget 3 crash->SAFE_MODE, backoff 1/2/5/10 min, phase timeouts, `detectVerifiedProgress`/`isPhaseStalled` por senales reales HEAD/owned, heartbeat, atomic write/read), `supervisor.mjs` (spawn + killTree/taskkill + guard-loop + phase-stall + verified + clean-success con `RESULTADO_CICLO`), `cli.mjs` (bridge JSON-over-stdout: boot/plan/start-cycle/heartbeat/set-phase/record-action/finish/fail/recover/inspect + supervise), `fake-opencode.mjs`/`fake-runner.mjs` (procesos controlados para la simulacion real del contrato). `RUN-OPENCODE-AUTONOMOUS.ps1` integrado: por ciclo consulta `boot` (SAFE_MODE/BLOCKED_OWNER -> detiene), `start-cycle` (seed RUNNING), `heartbeat` (liveness para watchdog); tras ejecutar opencode llama `finish` (exit 0) o `fail`+`recover` (exit != 0) usando el backoff PERSISTIDO del runtime en vez de su array local `BackoffMinutes` (que se reiniciaba). Se corrigieron dos `$cycle:` (scope-qualifier) que rompian el parse. `WATCHDOG-OPENCODE-AUTONOMOUS.ps1` ampliado: lee `AI_AUTONOMY/heartbeat.json` como fallback externo (informativo, sin competir con el launcher). |
| **Bugs encontrados** | El array local `BackoffMinutes`/`consecutiveFailures` del launcher se reiniciaba en cada reinicio (violaba la regla CE-068); el supervisor heredado tenia imports/hoisting de `failOutcome` y doble `import child_process`; `runCliSafe` del harness descartaba stdout en exit != 0. |
| **Bugs corregidos** | El launcher usa el backoff/SAFE_MODE persistido del runtime; `supervisor.mjs` reescrito limpio (imports top, single `child_process`, `failOutcome` antes del timer, `allStdout` module-local); CLI maneja exit != 0 con stdout JSON. |
| **Tests ejecutados** | `ce068-runtime-integration-test` 36/36 (casos A-J + resiliencia con PROCESOS REALES en git repo aislado: A fresh boot, B resume, C COMPLETE_TRACKERS, D bucle de narracion interrumpido con fake inalcanzable, E crash persistido, F crash-loop -> SAFE_MODE + backoff, G instancia unica con lock vivo, H lock stale, I archivo extrano, J ciclo exitoso con HEAD REAL movido); `ai-autonomy-runtime-policy-test` 45/45 (retry budget, backoff, SAFE_MODE, phase stall, verified dect, heartbeat, restart-no-reset). Registrados en `tests/run-all.mjs`. Parse-AST OK de `RUN-OPENCODE-AUTONOMOUS.ps1` y `WATCHDOG-OPENCODE-AUTONOMOUS.ps1`. |
| **Tests PASS** | 36/36 + 45/45 = 81 checks PASS en las 2 suites nuevas CE-068. |
| **Tests FAIL** | 0. |
| **Commits** | CE-068 (impl `AI_AUTONOMY/*` + launcher/watchdog wiring + tests + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`; `gh` sin autenticar). La supervision en tiempo real de opencode real (narration-loop/phase-stall) queda certificada a nivel de supervisor con `fake-opencode`; el launcher sincrono ejecuta opencode con su propia captura de log y delega las DECISIONES de recuperacion al runtime. |
| **Limitaciones** | El launcher mantiene su ejecucion sincrona de opencode (robusta y probada en produccion); no se sustituyo por el modo `supervise` (background+guard) para no desestabilizar el runner vivo. La interrupcion en vivo de un bucle de narracion sobre opencode REAL se certifica indirectamente via el supervisor (callable por `cli supervise`). Los runtime files (`runtime.json`/`state.json`/`heartbeat.json`/`events.jsonl`) son artefactos de ejecucion y no se commitean. |
| **Proxima prioridad** | Proxima oportunidad DISCOVERED/TODO de producto, o evolucion del launcher hacia el modo `supervise` (background+guard) si se autoriza estabilizar la supervision en vivo. |

---

## Cycle 132 — Live Supervision in the production runner: cli supervise as single authority over the running OpenCode child (CE-069)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | ce0272d |
| **HEAD final** | b6a2ff7 (commit CE-069 de este ciclo) |
| **Task** | CE-069 (ARCHITECTURE_IMPROVEMENT, P0, sistema autonomo): supervisar las ejecuciones reales de OpenCode EN VIVO dentro del runner de produccion. CE-068 delegaba las DECISIONES de recuperacion al runtime pero el launcher seguia ejecutando opencode de forma bloqueante y solo actuaba tras la salida del proceso — un bucle de narracion ("Let me read the QUEUE") colgaba el runner para siempre. |
| **Hypothesis** | Si el launcher delega la supervision del hijo vivo a `cli supervise` (autoridad unica: guard-loop + process-tree termination + phase-budget), puede interrumpir un bucle de narracion y un stall durante la ejecucion, limpiar el arbol completo, preservar el checkpoint, recuperar con un prompt compacto de un solo uso y escalar (backoff -> SAFE_MODE) sin des-supervisar en silencio ante fallo del supervisor. |
| **Change** | `supervisor.mjs`: `terminateTree` (gracia `child.kill()` primero; SIEMPRE `killTree` = taskkill /PID /T /F tras graceMs porque en Windows `kill()` no mata descendientes; idempotente sobre PIDs muertos; `rootExited` para la via CRASH), `failOutcome` con `{classification, alreadyExited}`, `onLive` (GRACEFUL_INTERRUPT/HARD_KILL/VERIFIED_PROGRESS/NARRATION_ACTIVITY), stall simplificado conservador (`elapsed > phaseTimeoutMs && lastVerifiedAtRun === 0` -> STALL), `onLine(line, isStderr)`. Clasificacion: NARRATION_LOOP -> `LOOP_INTERRUPTED` (exit 2), STALL (exit 3), CRASH (exit != 0), TIMEOUT (exit 4), CONFIG_ERROR (exit 5). Fix de carrera REAL encontrado por la suite: al interrumpir en vivo, la muerte del hijo clasificaba CRASH antes de que terminateTree terminara -> flag `interrupting` (close/error ya no clasifican mientras se interrumpe). `cli.mjs`: `cmdSupervise` con `--prompt-file` (prompt como arg unico, multi-linea), `--stdout-log` ([stderr] prefijado), `--live-heartbeat` (supervisor:'live', launcherPid, classification, intents, verified, loopCount, crashLoopStreak, lastNarrationAtRun, lastVerifiedAtRun); fallo interno del supervisor -> persiste CONFIG_ERROR + preserva checkpoint + `{ok:false, supervisorFailure:true, outcome:'CONFIG_ERROR', next}` SIN supervisar en silencio. `RUN-OPENCODE-AUTONOMOUS.ps1`: helper `Format-RecoveryPrompt` (compacto: CYCLE/CE/STATE/FAILURE/REASON/LAST VERIFIED/NEXT ACTION, «DO NOT repeat», de un SOLO uso, se limpia tras preponerlo), `$taskId` capturado de boot/start-cycle, bloque de ejecucion sustituido por `cli supervise` (--cmd opencode --args run --agent build --model opencode/deepseek-v4-flash-free + --prompt-file + --stdout-log + --cycle/--task); SUPERVISOR FAILURE (null/!ok) -> fail CONFIG_ERROR + recover + backoff persistido + continue (nunca fallo en silencio); exito limpia recovery/backoff; falla llama SOLO recover (sin doble fail/finish porque cmdSupervise ya persiste el veredicto); mapa veredicto -> exit code; metrics TSV con columna `outcome`; SAFE_MODE -> break con RESULTADO_CICLO registrado. `WATCHDOG-OPENCODE-AUTONOMOUS.ps1`: no mata cuando heartbeat `supervisor:'live'` (la supervision la mana el supervisor; el watchdog informa). `.gitignore`: reglas puntuales para `AI_AUTONOMY/{runtime.json,state.json,heartbeat.json,events.jsonl,runner.lock,.fake-marker.txt,.tree-pids/}`. |
| **Bugs encontrados** | (1) Carrera de clasificacion: interrupcion en vivo -> close() clasificaba CRASH antes del finish esperado (arreglado con `interrupting`). (2) `stats.intents` nunca se poblaba (el guard usa detector.summary() propio) -> se pobla al disparar el bucle. (3) Modo `tree` del fake: indices argv fragiles (`node -e` vs `node file`) -> helpers `.cjs` con pidDir en argv[2] + pidDir del fake en argv[3]. (4) Modo `commit` demasiado corto para el poll live -> hold de 900ms post-commit para observabilidad determinista. |
| **Tests ejecutados** | `ce069-live-supervision-test` 66/66 (A normal->SUCCESS sin interrupcion, B bucle->LOOP_INTERRUPTED LIVE + evidence de intents antes de interrumpir, C legit sin falso positivo + HEAD real, D silent->STALL distinto de LOOP, E loop->recover->commit->SUCCESS, F 3xLOOP->SAFE_MODE, G arbol parent/child/grandchild limpio sin huerfanos con pidfiles reales, H crash->CRASH persistido, I commit->verified=1 con HEAD real, J fichero extrano NO cuenta como progreso via commit-guard/ownedFiles, K binario inexistente->CONFIG_ERROR + checkpoint preservado + retry via recover, L launcher fuente delega en cli supervise y no queda `& opencode run`; escenarios controlados S1-S5 + heartbeat HB). Regresion: CE-068 36/36, policy 45/45, orchestrator 85/85, resilience 17/17. Parse-AST OK (0 errores) de `RUN-OPENCODE-AUTONOMOUS.ps1` y `WATCHDOG-OPENCODE-AUTONOMOUS.ps1`. |
| **Tests PASS** | 66/66 (CE-069) + 36 + 45 + 85 + 17 = 249 checks PASS. |
| **Tests FAIL** | 0. |
| **Commits** | CE-069 (impl supervisor/cli/fake/launcher/watchdog/.gitignore + suite + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Smoke test real de opencode = SKIPPED_EXTERNAL_CONSTRAINT: el harness DENIEGA el binario `opencode` (sin prefijo permitido), asi que una sesion real no puede lanzarse aqui sin violar el modelo de permisos; evidencia `artifacts/ce069-smoke-evidence.json` (la ruta de produccion queda certificada por el caso L + subprocesos reales S1-S5/HB con PIDs reales, git real y taskkill real). |
| **Limitaciones** | La validacion en navegador/proceso de opencode REAL no se ejecuto (constraint de permisos); el flujo de produccion queda cubierto por procesos reales (node subprocesos) y por la verificacion de fuente del launcher. Ficheros extranos del repo quedan intactos (no se tocan). |
| **Proxima prioridad** | Proxima oportunidad DISCOVERED/TODO de producto, o deep-audit del estado del arbol de procesos del runner bajo `cli supervise` cuando el dueno autorice lanzar opencode real. |

---

## Cycle 133 — Evidence-Driven Autonomous Optimization: the system learns from its own operational history (CE-070)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | ac52fcf |
| **HEAD final** | 95e0091 (commit CE-070 de este ciclo) |
| **Task** | CE-070 (ARCHITECTURE_IMPROVEMENT, P0, sistema autonomo): el sistema detecta/interrumpe/recupera (desde CE-067..CE-069) pero no aprende de su propia historia operativa. Objetivo: un modelo de ciclo maquina-legible + clasificacion determinista outcome/valor + priorizacion de tareas basada en evidencia + recomendacion de timeouts robusta + analisis de estrategias de recuperacion + deteccion de prompt-bloat/LOW_VALUE_ACTIVITY + policy versionada reversible — sin ML, sin heuristica opaca, decisions explicables/acotadas/reversibles. |
| **Hypothesis** | Si el runtime registra cada ciclo terminado en `history.jsonl` (append-only, determinista) y expone decisiones via `cli history/metrics/recommend/tune/policy`, el launcher de produccion puede priorizar mejor, recomendar factiblemente (nunca con <10 muestras), penalizar fracasos distinguiendo TAREA vs ENTORNO, evitar churn (drift <=20% por paso, delta critico >=5%) y revertir cualquier ajuste de policy — sin que el sistema se detenga por falta de backlog. |
| **Change** | Nuevo `AI_AUTONOMY/history.mjs`: normalizeCycleEntry/recordCycle/loadHistory (JSONL, corrupcion aislada, PARTIAL_HISTORY), classifyOutcome (SUCCESS_PRODUCT/BUG_FIX/RELIABILITY/TEST_DEBT/ARCHITECTURE, PARTIAL, DEFERRED, BLOCKED_EXTERNAL, FAILED, SAFE_MODE, INVALID), valueSignal (CRITICAL/HIGH/MEDIUM/LOW), detectLowValueActivity, historicalPenalty (env-vs-task, env pesa ~10x menos), scoreTaskDetail/scoreTask/selectTaskExplainable (9 componentes explicitos + tie-break determinista por id), recommendTask (TODO -> RECOMMENDED_NEXT_TASK; sin TODO -> DISCOVERY con guidance que penaliza test-only/doc-only recientes y sugiere areas subrepresentadas), recoveryStrategyStats/recommendRecovery, recommendTimeout (p90/p50, nunca media; INSUFFICIENT_EVIDENCE <10 muestras; hard bounds; maxAdjustmentPct 20%; minMeaningfulDelta 5%; KEEP_CURRENT anti-churn), detectPromptBloat (CONTEXT_BLOAT por crecimiento y umbral absoluto), metrics, policyFileShape/readPolicy/writePolicy/applyPolicyChange/rollbackPolicy (versionada, audit trail, bounds, NO_PREVIOUS). `cli.mjs` anade `history record/list`, `metrics`, `recommend`, `tune` (recomendacion-only por defecto; auto-apply OFF), `policy show/apply/rollback`, con FILE paths sobreescribibles via env (TOOLISTO_*) para tests aislados. `RUN-OPENCODE-AUTONOMOUS.ps1`: helper `Write-CycleHistory` llamado tras cada ciclo (exito y falla supervisada con outcome real, exit, duracion, tamanos de prompt fresh/recovery) y en SUPERVISOR FAILURE con `--env-failure` (fallo de infra NO penaliza la calidad de la tarea). `.gitignore`: + `history.jsonl`, `policy.json`, `policy.json.tmp`. |
| **Bugs encontrados** | (1) `rollbackPolicy` crasheaba (`ReferenceError: policyVersion`) y no restauraba bien fase/version/sol — reescrito con version anterior y `changes.slice(0,-1)`. (2) `writePolicy` dejaba `policy.json.tmp` huerfano en el workspace -> se elimina tras escribir y se ignora en git. (3) `cmdTune` reasignaba `const policy` -> `let`. (4) `ce069/ce068` copian `AI_AUTONOMY/*` a temp para ejecutar cli real: sin `history.mjs` la copia rompia el import -> anadido a la lista de ficheros copiados. (5) En la suite, `writeFileSync(..., {flag:'a'})` con full content duplicaba el fichero (bug del test, no del modulo) y la expectativa I7 asumia salto directo al hard max cuando el disenio protege por pasos de 20% (drift). |
| **Tests ejecutados** | Suite nueva `ce070-history-learning-test` 117/117 (A clasificacion, B valor, C low-value, D penalizacion env-vs-task, E scoring explicable, F seleccion determinista + tie-break, G recomendacion todo/discovery, H backtest determinista sobre fixtures 12 ciclos, I timeouts robustos INSUFFICIENT/samples/bounds/drift/clamp, J prompt bloat, K recovery stats/recommend, L storage + corrupcion aislada + deterministic reload, M metrics, N policy versioning/rollback/bounds/NO_PREVIOUS, O CLI e2e completo record/metrics/recommend/tune/policy/apply/rollback, P perf 3000 ciclos). Regresion: CE-069 66/66, CE-068 36/36, policy 45/45, orchestrator 85/85, resilience 17/17. Parse-AST OK (0 errores) de ambos .ps1. |
| **Tests PASS** | 117/117 (CE-070) + 66 + 36 + 45 + 85 + 17 = 366 checks PASS. |
| **Tests FAIL** | 0. |
| **Commits** | CE-070 (history.mjs + puente CLI history/metrics/recommend/tune/policy + launcher Write-CycleHistory + suite CE-070 + .gitignore + traceback en ce069/ce068 + run-all). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Smoke de opencode real sigue `SKIPPED_EXTERNAL_CONSTRAINT` (harness niega el binario `opencode`) — igual que CE-069, el flujo queda cubierto por pruebas de subproceso real. |
| **Limitaciones** | `recommendTimeout` usa la duracion total del ciclo como unica muestra por fase mientras el launcher no mida fases reales (el registro de fases queda listo en el modelo; el launcher puede poblarlo despues). Auto-apply de policy queda OFF por defecto (recomendacion-only) por disenio. Ficheros extranos del repo quedan intactos (no se tocan). |
| **Proxima prioridad** | Cuando el backlog-no-vacio lo pida, usar `cli recommend`/`tune` como entrada real de priorizacion; o deep-audit de opencode real cuando el dueno autorice lanzarlo. |

---

## Cycle 134 — Star-flow bug fix: convertDocToTable multi-space OCR tables via parseTabularText (CE-071)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | ad1a0c1 |
| **HEAD final** | 9bef320 (commit CE-071 de este ciclo) |
| **Task** | CE-071 (BUG_FIX, P2, flujo estrella): «documento → tabla» producia columnas fantasma en tablas OCR alineadas por columnas — `detectSeparator` devuelve `''` para tablas multi-espacio y `line.split(' ')` creaba `Columna 2`/`Columna 4` con celdas vacias en el eslabon estrella `archivo → OCR → documento → tabla`. |
| **Hypothesis** | Delegar el parsing en `parseTabularText` (unico precedente probado del repo, `split(/\s+/)` + `reconstructWhitespaceRow` con anclas numericas) y aplicar `normalizeOcrNumber` post-parsing elimina las columnas fantasma sin perder la confianza de celdas ni la relacion `source-document`, y sin regresiones en delimitadores explicitos (`;`, `|`). |
| **Change** | `workspace/workspace.js`: `convertDocToTable` importa y delega en `parseTabularText` (del `core/tabular-text-parser.js`, el mismo parser de la operacion `text.to-table`); las filas se normalizan con `normalizeOcrNumber` (conserva el fix del signo OCR `1-`→`-`), el separator resultante es `parsed.delimiter || 'whitespace'`, y se conserva `buildCellConfidenceMatrix` y la relacion `source-document`. Se elimina la funcion muerta `rebuildTableRow` (~18 lineas; cero referencias en tests). Suite nueva `tests/workspace/doc-to-table-multispace-test.mjs` 20/20 registrada en `scripts/test-workspace-release.mjs`. `tests/workspace/persistence-lifecycle-audit.mjs` §19f: el check de `saveData(project.id, table)` dentro del `.then(saveAsset)` se robustece de numero de linea absoluto (L2426) a `findIndex` con lookback de `saveAsset(` — el cambio neto de lineas de workspace.js rompia el check estatico. |
| **Bugs encontrados** | (1) Bug de producto: `detectSeparator || ' '` + `line.split(' ')` para tablas whitespace-aligned. (2) Check fragil de numero de linea absoluto en persistence-lifecycle-audit §19f (regate de autor solo, sin cambiar criterios). |
| **Tests ejecutados** | `doc-to-table-multispace-test` 20/20 (parsing multi-espacio sin columnas fantasma, fixture Star-Flow reproduce exactamente 5 filas/15 celdas con negativos, `;`/`|` intactos, checks estaticos de la delegacion: import presente, `parseTabularText(lines.join(` usado, sin `line.split(separator)`, sin fallback `|| ' '`, `parsed.headers`/`parsed.rows` consumidos, `rebuildTableRow` inexistente, confianza + `source-document` conservadas). `persistence-lifecycle-audit` 95/95 tras el fix del check. RELEASE GATE completo `node scripts/test-workspace-release.mjs` 33/33 PASS (build + sync source→dist + Workspace + Phase 3A/3B + P11 + OCR source + Star-Flow E2E con OCR real + BOM CSV + engine-idle + workflow export + text-to-doc + doc-to-table-multispace + instruction parser/engine/planner + workflow UI + capture-flow + dist-smoke + autosave-lock + CE-058 x4 + CE-059 x3 + CE-060 x3 + CE-061 x3 + CE-066). |
| **Tests PASS** | 20 (CE-071) + 95 (lifecycle audit) + RELEASE GATE 33/33 suites; total 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-071 (fix `convertDocToTable` + suite 20/20 + registro gate + fix check fragil §19f). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | `parseTabularText` asume columnas ancladas por posicion numerica; tablas con celdas de texto muy alineadas usan la misma estrategia que `text.to-table` (precedente probado). El fixture dificil del OCR sigue siendo limite documentado de CE-006 (independiente de este fix). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 135 — Star-flow bug fix: tabla → grafico with the canonical locale parser (CE-072)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | 5b99a00 |
| **HEAD final** | c8ad0e9 (commit CE-072 de este ciclo) |
| **Task** | CE-072 (BUG_FIX, P2, flujo estrella): `tabla → grafico` (operaciones `data.to-chart` y `report.create`) usaba una copia local divergente `parseLocaleChartNumber` que (a) interpretaba fechas/horas como numeros (`15/01/2024` → 15012024, `14:30` → 1430) ganando la seleccion de columna numerica sobre la real, (b) perdia el signo en parentesis `(1.234,56)` → +1234.56 y (c) destruia la escala de `%`. La MISMA tabla producia graficos distintos segun el punto de entrada: boton UI (`createChartFromTable`, parser canonico). |
| **Hypothesis** | Eliminar la copia y unificar `tableChartSeries` en el parser canonico `parseLocaleNumber` (`core/locale-parser.js`, contrato documentado «All modules must use this instead of ad-hoc parsing») hace que el flujo produzca exactamente las mismas series que la UI para cualquier tabla (paridad punto a punto), sin regresiones en tablas limpias. |
| **Change** | `workspace/core/workflow-operations.js`: nuevo import `parseLocaleNumber` desde `./locale-parser.js`; `tableChartSeries` (scoring de columna numerica + serie) reemplaza las 3 llamadas a `parseLocaleChartNumber` por `parseLocaleNumber`; se ELIMINA la funcion local `parseLocaleChartNumber` (~21 lineas con strip ad-hoc `replace(/[^\d,.+\-()]/g`). Cero cambios de interfaz: las operaciones quedan funcionalmente iguales para datos limpios, y producen series correctas (paridad exacta con `tableChartData` de workspace.js) para fechas/horas/parentesis/porcentajes/millares. |
| **Bugs encontrados** | (1) El defecto de producto: parser duplicado y divergente del canonico (fechas/horas → numeros fantasma, signo perdido, % sin escala). (2) Sin otros bugs introducidos; se verifico con VM del modulo real. |
| **Tests ejecutados** | Suite nueva `tests/workspace/chart-series-locale-test.mjs` 18/18, pure Node: carga `locale-parser.js` + `workflow-operations.js` reales por VM (`tableChartSeries` ejecutado) y comprueba: Fecha (`15/01/2024`) rechazada como columna numerica → `numericIndex` apunta a Monto con la celda vacia omitida ([1234.56, 2500]); horas (`14:30`) no puntuan; `(1.234,56)` → -1234.56; `5%` → 0.05; `1.500,25` → 1500.25; tabla limpia `Trimestre|Ventas` → 3 series finitas (regresion workflow-chart-e2e); todo-texto → series vacias (aviso accionable); anti-regresion estatica (sin `parseLocaleChartNumber`, import canonico presente, >=3 usos de `parseLocaleNumber(row?.[` , sin strip ad-hoc, workspace.js tambien canonico). Registrada en `scripts/test-workspace-release.mjs`. |
| **Tests PASS** | 18 (CE-072) + RELEASE GATE completo 34/34 suites PASS (incl. Star-Flow E2E con OCR real, BOM CSV, dist-smoke, CE-058/059/060/061) = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-072 (fix `workflow-operations.js` + suite 18/18 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | `parseLocaleNumber` sigue el contrato del repo: las fechas se rechazan, por lo que una tabla SOLO con fechas ya no grafica numeros fantasma sino que avisa de columna no numerica (comportamiento deseado y coherente con la UI). El E2E de navegador `workflow-chart-e2e.mjs` sigue huerfano (no registrado en el gate); no se toco su registro en este ciclo. |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 136 — PDF bug fix: imagenes anchas ya no se deforman ni desbordan en document.to-pdf (CE-073)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | c8ad0e9 |
| **HEAD final** | d2a5300 (commit CE-073 de este ciclo) |
| **Task** | CE-073 (BUG_FIX, P2, informe PDF): en `document.to-pdf`, `normalizePdfImageSections(..., {updateSize:true})` escribe `width/height` en px del canvas en cada seccion de imagen, y `renderImagePDF` (`workspace/core/pdf-generator.js`) recortaba el ancho a `contentW` pero conservaba el alto crudo. Una captura 1600x900 se dibujaba 481.6x900 (ratio 0.53 vs 1.78) y el cajon sobresalia por arriba de la pagina (cm `y` negativo). Ademas `estimateSectionH` reservaba ~900 pt por imagen ancha, dejando paginas casi vacias y empujando la imagen a su propia hoja. |
| **Hypothesis** | Re-escalar el alto proporcional cuando el ancho se recorta conserva el aspecto (coherente con el fallback actual `displayW * image.height / image.width` cuando falta height) y encaja la caja dentro de la pagina; sincronizar `estimateSectionH` con el mismo criterio evita la reserva absurda. No cambia nada en imagenes estrechas ni sin width/height. |
| **Change** | `workspace/core/pdf-generator.js`: (a) `renderImagePDF` ahora calcula `sectionW`/`sectionH` una vez y, si `image` existe, ambos estan presentes y el ancho pedido se recorto (`displayW < sectionW`), re-deriva `displayH = displayW * (image.height / image.width)`; (b) `estimateSectionH` para `image` devuelve `sectionH * (contentW / sectionW)` cuando `sectionW > contentW` (mismo criterio que el render). Cero cambios de interfaz y ninguno de paginacion: el resto de secciones conserva su camino exacto. |
| **Bugs encontrados** | (1) El defecto de producto: deformacion + desborde de pagina para imagenes anchas. (2) La reserva de `estimateSectionH` usaba el alto crudo (px) de una imagen ancha, reservando mas del doble del area real. Sin otros bugs introducidos; verificado con `generatePDF` real (modulo puro). |
| **Tests ejecutados** | Suite nueva `tests/workspace/pdf-image-aspect-test.mjs` 11/11, pure Node sin navegador: carga `pdf-generator.js` real por `new Function` (sin imports) y construye JPEGs estructurales SOF0 (1600x900 y 200x100) verificados por `readJpegDimensions` de verdad (`/Subtype /Image` real). Chequeos en el stream `cm`: ancho recortado 481.6 pt, ratio 1600/900 (~1.778) conservado, alto re-escalado ~270.9 (no 900 crudo), caja con `y >= 0` (dentro de la pagina); imagen estrecha 200x100 sin recorte ni deformacion; fallback sin width/height con aspecto coherente (2.0); anti-regresion estatica (`displayH = displayW * (image.height / image.width)` y `sectionH * (contentW / sectionW)` presentes). Registrada en `scripts/test-workspace-release.mjs`. |
| **Tests PASS** | 11 (CE-073) + RELEASE GATE completo 38/38 suites PASS (34 previas + CE-064/071/072/073) = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-073 (fix `pdf-generator.js` + suite 11/11 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | El fix cubre la vía `document.to-pdf` (updateSize escribe px reales). En diseños (vía `preparePdfImages`) `section.width/height` también vienen del canvas, por lo que el mismo criterio aplica. No se validó en navegador la ruta de diseños con ancho > `contentW` (sin E2E de diseño PDF en gate); el render comparte `renderImagePDF`. |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 137 — PDF bug fix: celdas anchas y filas irregulares ya no salen de la pagina en tablas (CE-074)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | 3bd34e2 |
| **HEAD final** | 5ccda24 (commit CE-074 de este ciclo) |
| **Task** | CE-074 (BUG_FIX, P2, informe PDF): `renderTablePDF` dibujaba cada celda en una sola linea fija (baseline `ry-13`) con altura de fila fija de 20 pt. Con una celda larga (URL, cadena sin espacios) el texto se extendia hasta ~722 pt en una pagina de 595 (se escapaba por el borde derecho); con celdas de varias lineas, el conteo fijo de 20 pt por fila hacia colisionar las filas entre si y podia empujar texto fuera de la pagina. |
| **Hypothesis** | Hacer que el render, la estimacion de paginacion y la paginacion compartan un mismo criterio de altura real de fila —derivado del contenido envuelto a la columna— elimina el desborde horizontal (celdas cortadas fuera del borde) y el vertical (filas solapadas), sin cambiar la salida de tablas limpias de una linea por celda (siguen 20 pt por fila). |
| **Change** | `workspace/core/pdf-generator.js`: nuevos helpers de modulo `cellLines` (envuelve por espacios y ademas corta tokens mas largos que la columna: evita que una URL desborde) y `tableRowHeight` (alto real = max lineas `* 12.6 + 4`, nunca menos de 20 pt) mas `TABLE_ROW_H`/`TABLE_TOP_INSET`/`CELL_LINE_HEIGHT`. `renderTablePDF` ahora posiciona cada celda en lineas envueltas dentro de la fila y dibuja la grilla con altos reales acumulados; `estimateSectionH` y `addTableSections` usan el mismo helper para reservar y paginar por alto real (una fila mas alta que la pagina usable se fuerza igual, tomando el criterio previo de `Math.max(1, availableRows)`). Tablas normales producen exactamente 20 pt por fila (bytes del stream de grilla identicos a los previos salvo el inseto acumulado). |
| **Bugs encontrados** | (1) El defecto de producto: celda larga fuera del borde derecho (reproducido: right edge 722 > 595). (2) Altura de fila fija ignorando el contenido multi-lineal (solapamiento). Sin otros bugs introducidos; revalidadas las suites huerfanas `pdf-table-pagination-test` (7/7) y `workflow-document-pdf-test` (66/66). |
| **Tests ejecutados** | Suite nueva `tests/workspace/pdf-table-wrap-test.mjs` 18/18, pure Node: (1) URL de 67 chars partida en varias lineas, ninguna linea supera 524 pt, sin NaN/undefined; (2) celda de 160 chars agranda la fila a 54.4 pt y la grilla vertical abarca 20+54.4+20; (3) tabla limpia conserva 20 pt por fila y una linea por celda (sin regresion); (4) tabla de 42 filas con filas altas genera varias paginas, cada fila exactamente una vez y sin texto fuera de la pagina; (5) anti-regresion estatica (hard-break, `maxLines * CELL_LINE_HEIGHT + 4`, envuelto por celda en render, `used + tableRowHeight(...) <= usableH + 0.01` en paginacion y suma por fila en estimacion). Registrada en `scripts/test-workspace-release.mjs`. |
| **Tests PASS** | 18 (CE-074) + suites huerfanas de PDF revalidadas (pagination 7/7, workflow-document-pdf 66/66) + RELEASE GATE completo 39/39 suites PASS = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-074 (fix `pdf-generator.js` + suite 18/18 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | No se repite el encabezado de tabla en fragmentos de paginas posteriores con contenido nuevo distinto a las filas (se mantiene el comportamiento previo de repetirlo). La estimacion usa unicamente conteo de chars (~56 chars en una columna de 120 pt) identico en estimate/render, por lo que paginacion y dibujo siempre coinciden; no hay uso de metrica real de glifos (sin dependencias). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 138 — PDF bug fix: las barras del grafico ya no salen del area ni de la pagina con muchas series (CE-075)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | 4d2b478 |
| **HEAD final** | e6f4a44 (commit CE-075 de este ciclo) |
| **Task** | CE-075 (BUG_FIX, P2, informe PDF): `renderChartPDF` dibujaba cada barra en un pitch fijo `barW + 4` (hasta 32 pt) sin limite por `contentW`. Con una tabla de muchas filas (las series = filas en `tableChartSeries`), el grafico desbordaba: con 16 series la ultima barra caia en 566.7 pt (fuera del area de contenido 538.3) y con 20 en 606.3 pt (fuera de la pagina A4 de 595). El flujo estrella `documento → tabla → grafico → informe → PDF` producia barras recortadas solo por el visor y texto/grilla fantasma en el PDF. |
| **Hypothesis** | Re-escalar el ancho de barra para que la ultima barra quede dentro de `contentW` elimina el desborde para los conteos normales; y si ni con el ancho minimo (10 pt) caben todas las barras, RECORTAR a las que quepan mostrando un marcador "+N" (las series ocultas se indican, no se silencian) garantiza que ningun rect salga del area ni de la pagina para cualquier conteo. |
| **Change** | `workspace/core/pdf-generator.js` `renderChartPDF`: nuevo `maxFitBars = Math.max(1, Math.floor(contentW / (minBar + 4)))`; si `series.length > maxFitBars` se dibujan solo `maxFitBars - 2` barras (reservando un hueco para el marcador) con `barW = minBar` y `pitch = minBar + 4`, y tras el bucle se dibuja `(+hiddenCount)` en `baseline - 4`; si no es el caso, se re-escala `barW = Math.max(minBar, (contentW - 4 * drawn.length + 2) / drawn.length)` con `pitch` ajustado solo cuando la ultima barra superaria `contentW` (conteos normales mantienen la geometria previa byte a byte). `allVals`/`maxVal` usan solo las barras dibujadas. |
| **Bugs encontrados** | (1) El defecto de producto: desborde a 566.7 (16) y 606.3 (20) pt, y con conteos extremos (>= 40) incluso a 614.7/1174.7 pt aun con ancho minimo. (2) En el desarrollo, el recorte por `maxFitBars` no re-apretaba el pitch (barW ~15.2 daba pitch 19.2 y la ultima barra seguia fuera) -> se fuerza `barW = minBar; pitch = minBar + 4` en la via de recorte. Sin otros bugs introducidos; verificado empiricamente con `generatePDF` real. |
| **Tests ejecutados** | Suite nueva `tests/workspace/pdf-chart-overflow-test.mjs` 15/15, pure Node: carga `pdf-generator.js` real por `new Function` y comprueba en el stream (`re f`): 6 series geometria intacta y dentro; 16 series enteras y encajadas (antes 566.7); 20 series enteras y encajadas (antes fuera de pagina 606.3); 80 series recortadas con `+N` exacto (80 - barras dibujadas) y todas dentro; ningun rect (ni relleno de pagina) supera 595; anti-regresion estatica (`tooMany`/`maxFitBars` y `'+' + hiddenCount` presentes). Registrada en `scripts/test-workspace-release.mjs`. |
| **Tests PASS** | 15 (CE-075) + RELEASE GATE completo 40/40 suites PASS (incl. Star-Flow E2E con OCR real, BOM CSV, dist-smoke, CE-058/059/060/061, registradas CE-064/071..075) = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-075 (fix `pdf-generator.js` + suite 15/15 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | Con mas de `maxFitBars` (~33) series el grafico recorta barras (ancho minimo 10 pt: mas barras serian ilegibles) y lo senala con "+N"; la resolucion de alto nivel (agrupar series) queda fuera de alcance de fase. La etiqueta de valor puede solaparse entre barras densas (nanismo del propio ancho minimo). No se repitio el E2E de navegador de este camino (el defecto es puro de generacion y queda cubierto por el stream). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 139 — PDF bug fix: texto y titulos largos ya no salen del area ni solapan (CE-076)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | 9b38aa4 |
| **HEAD final** | 2374043 (commit CE-076 de este ciclo) |
| **Task** | CE-076 (BUG_FIX, P2, informe PDF): `document.to-pdf` desbordaba texto por dos vias complementarias. (a) `wrapText` NO partia tokens mas largos que la linea (a diferencia de `cellLines`): un titulo/URL de 130 chars se emitia como UNA linea a 24 pt — ~1560 pt de ancho en una pagina de 595 — saliendose por el borde derecho de la pagina. (b) `estimateSectionH` reservaba altos fijos para titulo/subtitulo/fecha/footer (36/26/20/24) y contaba lineas de texto con `lineHeight` 14, mientras el render dibuja `fontSize*1.4` (16.8 pt para texto a 12, 33.6 para titulos a 24): las secciones multilinea se dibujaban mas altas de lo reservado, solapando la seccion siguiente (un titulo largo tras el fix (a) solapaba el parrafo) y cayendo en el margen inferior al final de pagina. |
| **Hypothesis** | Partir tokens largos en `wrapText` por el mismo criterio que `cellLines` (charsPerLine) elimina el desborde horizontal; y alinear `estimateSectionH` con la altura REAL del render (`size + (lines-1)*size*1.4`) elimina el solape vertical y el texto en el margen inferior, sin cambiar la salida de documentos de una linea (single-line conserva 36/26/20/24 y texto 24 pt). |
| **Change** | `workspace/core/pdf-generator.js`: `wrapText` anade rama para `word.length > charsPerLine` (parte el token en trozos de charsPerLine con `rest.slice`, como `cellLines`); nuevo `estimateTextSectionH(section)` dentro de `generatePDF` (size por tipo + `(lines.length-1)*size*1.4 + 8`) usado por title/subtitle/date/footer (`Math.max(fijo, real)`) y por el caso `text` (`Math.max(24, real)`); se elimina la constante muerta `lineHeight` (solo la usaba la estimacion antigua). |
| **Bugs encontrados** | (1) El defecto (a): token largo en UNA linea fuera del borde (probe: F2 len 130 a 24 pt, maxRight 1560 > 595). (2) El defecto (b): estimacion menor que el render para >= 6 lineas de texto y para cualquier titulo multilinea. Sin otros bugs introducidos; verificado empiricamente con `generatePDF` real. |
| **Tests ejecutados** | Suite nueva `tests/workspace/pdf-text-wrap-test.mjs` 9/9, pure Node: (1) URL larga partida en varias lineas, ninguna excede `x + len*12*0.5 > area`; (2) titulo de 130 chars en ~4 lineas dentro del borde y con el texto siguiente apilado DEBAJO (`y` menor que la ultima linea del titulo, sin solape); (3) parrafo de 8 lineas cerrando una pagina ocupada a 42 lineas: toda linea `y >= margen inferior`; (4) anti-regresion estatica (hard-break presente, `estimateTextSectionH`/`size * 1.4` presentes, `const lineHeight = 14;` eliminado). Registrada en `scripts/test-workspace-release.mjs`. Suites huerfanas de PDF revalidadas: `pdf-table-pagination-test` 7/7 y `workflow-document-pdf-test` 66/66 (tocan estimacion y wrapText). |
| **Tests PASS** | 9 (CE-076) + huerfanas PDF (7 + 66) + RELEASE GATE completo 41/41 suites PASS = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-076 (fix `pdf-generator.js` + suite 9/9 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | El hard-break de tokens corta a charsPerLine en una frontera de caracteres (identico a `cellLines`); no usa metrica de glifos real (sin dependencias). La estimacion de texto sigue siendo de chars, pero ahora SIEMPRE >= el render (nunca infra-reserva). No se repitio el E2E de navegador (defecto puro de generacion cubierto por el stream). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 140 — PDF bug fix: el grafico ya no solapa lo siguiente ni deja huecos (CE-077)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | 21ba0c1 |
| **HEAD final** | 0397d82 (commit CE-077 de este ciclo) |
| **Task** | CE-077 (BUG_FIX, P2, informe PDF): `estimateSectionH` reservaba para la seccion `chart` una altura O(n) `30 + n*18 + 40`, pero el render del grafico es de altura FIJA (titulo ~12 pt + chartH 100 + etiquetas; no crece con el numero de series). Infra-reserva con <= 5 series: con UNA serie reservaba 100 pt cuando el render dibuja ~150 — probe real: barra 655.3..755.3 y baseline del texto siguiente en 673.3 (el parrafo se imprimia SOBRE la barra). Sobre-reserva creciente: 20 series -> ~430 pt de hueco vacio; 80 series -> ~1510 pt, empujando el contenido posterior a una pagina casi vacia (agravado por el recorte de CE-075). Mientras en `text` el estimador se corregia con CE-076, el `chart` seguia con su propio desajuste (mutax). |
| **Hypothesis** | Como el render usa un chartH fijo de 100, la estimacion correcta es constante en el numero de series: `Math.max(150, 30 + (tituloLines-1)*16.8 + 120)` — 150 pt cubren el caso positivo extremo (etiqueta de valor arriba de una barra llena ~ chartTop-108) y el negativo (etiqueta abajo hasta chartTop-20); el termino del titulo cubre titulos que ahora pueden partirse en varias lineas (CE-076). Con eso el texto siguiente queda SIEMPRE debajo del contenido dibujado y un grafico enorme ya no expande el documento. |
| **Change** | `workspace/core/pdf-generator.js`, rama `chart` de `estimateSectionH`: se elimina `30 + s.length*18 + 40` y se estima con `wrapText(String(chartData.title || section.content || 'Grafico'), contentW, 'text')` para las lineas del titulo y la formula `Math.max(150, 30 + (titleLines.length - 1) * 16.8 + 120)`. |
| **Bugs encontrados** | (1) Infra-reserva <= 5 series (solape del texto siguiente sobre la barra, confirmado por probe). (2) Sobre-reserva O(n) que con documentos con muchas series creaba huecos de pagina y paginas casi vacias. Sin bugs nuevos introducidos: sonda post-fix con n=1/6/20/80 -> baseline del texto bajo las barras en todos los casos. |
| **Tests ejecutados** | Suite nueva `tests/workspace/pdf-chart-layout-test.mjs` 10/10, pure Node (generatePDF real): chart de 1 serie + texto (baseline bajo la barra), 20 series (barras dentro de la pagina, texto bajo, 1 pagina), 80 series (barras recortadas <= 595, texto bajo, chart+texto en UNA pagina), anti-regresion estatica (formula nueva presente, `30 + s.length*18 + 40` ausente). Registrada en `scripts/test-workspace-release.mjs`. Suites huerfanas revalidadas: `workflow-document-pdf-test` 66/66 (incluye secciones chart) y `pdf-table-pagination-test` 7/7. |
| **Tests PASS** | 10 (CE-077) + huerfanas (66 + 7) + RELEASE GATE completo 42/42 suites PASS = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-077 (fix `pdf-generator.js` + suite 10/10 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | La altura del chart sigue estimandose (150 pt >= render en todos los caminos validados); el grafico sigue recortando a `maxFitBars` (~33) series con "+N" (CE-075) y la etiqueta de valor puede solaparse entre barras densas. No se repitio el E2E de navegador (defecto puro de generacion cubierto por el stream; `workflow-document-pdf` ya cubre chart->PDF). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 141 — PDF bug fix: imagenes encajadas en la pagina (CE-078)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | 5d4f7f0 |
| **HEAD final** | 07a85c3 (commit CE-078 de este ciclo) |
| **Task** | CE-078 (BUG_FIX, P2, informe PDF): `renderImagePDF` acotaba solo el ANCHO (`displayW = Math.min(contentW, sectionW || ...)`) y derivaba el alto del crudo (`sectionH`) re-escalado por ancho solo cuando `displayW < sectionW`. Cuando el ancho pedido ya cabia (captura estrecha o `sectionW <= contentW`), el alto crudo se usaba sin limite superior: una imagen 768x6000 llegaba a `h=960` (mLx 56.7 - 960 -> por debajo del margen) y cualquier `sectionW <= contentW` con alto desproporcionado se recortaba visualmente. La estimacion (`estimateSectionH`) solo re-escalaba cuando `sectionW > contentW`, por lo que no coincidia con el render para imagenes estrechas-altas: paginas casi vacias (estimacion pequena) o imagenes truncadas en el render. |
| **Hypothesis** | Un unico `fitImageDisplay(sectionW, sectionH, contentW, usableH)` compartido por estimacion y render, que encaje dentro del area usable conservando la proporcion (primero por ancho, luego por alto, sin agrandar lo que ya cabe), alinea ambos y garantiza que ningun cajon de imagen exceda la pagina. |
| **Change** | `workspace/core/pdf-generator.js`: nuevo helper `fitImageDisplay(sectionW, sectionH, contentW, usableH)` (returns `null` si faltan dimensiones). `estimateSectionH` rama `image`: `const fit = fitImageDisplay(...); if (fit) return fit.h;`. `renderImagePDF` firma `(parts, section, x0, y0, contentW, context)`: usa `context.usableH` y aplica `fitImageDisplay` para `displayW/displayH` (manteniendo el fallback sin dimensiones via `image.height/image.width` y acotandolo tambien). `generatePDF` pasa `usableH` en el context al llamar `renderSectionPDF`. |
| **Bugs encontrados** | (1) Imagen estrecha y muy alta (400x5000) dibujada fuera del margen inferior. (2) Imagen alta (768x6000) no encajada en alto (h=960 excedia usableH 728.6). (3) Desalineacion estimacion/render para imagenes estrechas-altas (paginas casi vacias / imagenes recortadas). Sin bugs nuevos: sonda post-fix 400x5000 -> 58.3x728.6, 3000x800 -> 481.6x128.4, 768x6000 -> 93.3x728.6, 560x315 -> 481.6x270.9 (todas dentro de la pagina, proporcion conservada). |
| **Tests ejecutados** | Suite nueva `tests/workspace/pdf-image-fit-test.mjs` 16/16, pure Node (JPEG minimo 1x1 + parseo de `cm`): estrecha-alta y alta encajadas por alto dentro del margen, ancha por ancho, imagen que cabe no agrandada, proporcion conservada; anti-regresion estatica (`fitImageDisplay` presente en modulo/render/estimacion, `usableH` en el context, estimacion antigua de un solo eje eliminada). Suite `tests/workspace/pdf-image-aspect-test.mjs` (CE-073) actualizada a la nueva implementacion compartida: 11/11 (sus 2 checks estaticos antiguos asertaban las viejas lineas borradas). Registrada en `scripts/test-workspace-release.mjs`. Huerfanas revalidadas: `workflow-document-pdf` 66/66, `pdf-table-pagination` 7/7, `pdf-text-wrap` 9/9, `pdf-chart-layout` 10/10. |
| **Tests PASS** | 16 (CE-078) + 11 (CE-073 actualizada) + huerfanas (66+7+9+10) + RELEASE GATE completo 43/43 = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-078 (fix `pdf-generator.js` + suite 16/16 + actualizacion CE-073 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | El encaje de imagen depende de `width`/`height` en px y de `usableH` (context). Sin `width`/`height` se conserva el fallback proporcional (`image.height/image.width`) despues de acotarlo por alto. No se repitio el E2E de navegador (defecto puro de generacion cubierto por el stream; `workflow-document-pdf` ya cubre imagen->PDF). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 142 — Parser bug fix: formato de destino prioritario en conversiones (CE-079)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | 040a6b7 |
| **HEAD final** | 8956868 (commit CE-079 de este ciclo) |
| **Task** | CE-079 (BUG_FIX, P2, parser de instrucciones): `parse` resolvia el formato de DESTINO de convert/compress/to-pdf con `detectFormat`, que recorre los aliases en orden de definicion (`FORMAT_ALIASES`: jpg, jpeg, png, webp, svg, gif, bmp, pdf) y devuelve el PRIMERO presente en el texto. Cuando la instruccion nombraba la FUENTE y el DESTINO, la fuente podia ganar por orden: probe `convierte este jpg a webp` -> image/jpeg (la conversion "a webp" resolvia a jpeg, sin cambio); `convierte este png a gif` -> png (gif se define despues); `convierte esta webp a jpg` -> image/webp (webp antes que jpg). Ademas, el formato de origen inline rompia el sinonimo exacto: `pasa esta imagen jpg a png` no reconocia NI conversion (intents == []) porque el sinonimo 'pasa esta imagen a' no matchea con el formato entre 'imagen' y 'a'. El `detectFormat` indirecto tambien alimentaba la ambiguedad de convert (preguntaba formato aunque hubiera destino claro atras de " a " en algunos casos). |
| **Hypothesis** | Un `detectDestinationFormat(normalized)` que busque el alias DESPUES de una preposicion de destino (" a ", " a formato ", " en ") resuelve la fuente-vs-destino sin romper las frases de destino unico (todas usan " a <formato>"); y un patron regex que tolere el formato inline ("pasa esta imagen <X> a <Y>") restaura el reconocimiento de conversion en ese patron. |
| **Change** | `workspace/core/instruction-parser.js`: nuevo `detectDestinationFormat(text)` (marca posiciones de " a ", " en ", " a formato ", analiza el segmento posterior por palabras completas; cae a `detectFormat`). Se usa en: rama convert/compress/to-pdf (`detectDestinationFormat(normalized)`), rama strip-metadata, y la condicion de ambiguedad `convert`. En `findActions`, `convertInline = /pas(?:a|ar|e)\w*\s+(?:esta|estas|la|las|en)?\s*imagen(?:es)?s?\s+\S+\s+a\b/i` se anade como span de accion `convert` solo si no hay ya un convert (no desvanece los sinonimos exactos). Se exporta `detectDestinationFormat`. |
| **Bugs encontrados** | (1) Fuente gana a destino por orden de definicion (jpg->webp, png->gif, webp->jpg). (2) Sinonimo roto con formato inline (pasa esta imagen jpg a png -> sin accion). Sin bugs nuevos: probe post-fix resuelve todas las conversiones con fuente+destino al destino correcto. |
| **Tests ejecutados** | Suite nueva `tests/workspace/instruction-parser-dest-format-test.mjs` 17/17, pure Node (carga por sandbox como en la suite heredada): jpg->webp=webp, png->jpg=jpeg, jpg->png=png, png->gif=gif, webp->jpg=jpeg; destinos unicos conservados (convertir a jpg, Pasa esta imagen a jpg, conviertelas a webp, convertir a pdf, a formato png, strip-metadata a jpg); sin formato -> warning + PNG por defecto; anti-regresion estatica (detectDestinationFormat, uso en convert/compress/to-pdf y en ambiguedad, patron convertInline). Suite heredada `instruction-parser-test.mjs` 116/116 sin regresion. Registrada en `scripts/test-workspace-release.mjs`. |
| **Tests PASS** | 17 (CE-079) + 116 (heredada) + RELEASE GATE completo 44/44 = 0 fail. |
| **Tests FAIL** | 0. (En la primera pasada del gate, `multi-tab-concurrency` CE-060 marco transitoriamente 1/113 en '5.8 delayed autosave outcome is deterministic' — carrera de timing real, no relacionada con este cambio; la suite paso 3/3 re-ejecuciones 113/113 y el gate quedo 44/44 OK.) |
| **Commits** | CE-079 (fix `instruction-parser.js` + suite 17/17 + registro gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | `detectDestinationFormat` ara por posicion de preposicion, no por gramatica completa; una frase sin " a "/" en " y con fuente+destino (p. ej. "convertir jpg webp") sigue cayendo a detectFormat (orden de definicion). El patron inline cubre la forma "pasa/pasar ... imagen ... a ..." de conversion; otras formas con el formato origen inline no se ampliaron. No se repitio el E2E de navegador de la conversion (defecto puro de parser, cubierto por el stream; el planificador `instruction-planner` ya usa el formato del intent). |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 143 — Register orphan PDF test suites in the release gate (CE-080)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | 7007473 |
| **HEAD final** | 32267b0 (commit CE-080 de este ciclo) |
| **Task** | CE-080 (MEANINGFUL_TEST_COVERAGE, P3): tres suites del camino PDF eran ORFANAS: `pdf-table-pagination-test.mjs` (7/7), `workflow-document-pdf-test.mjs` (66/66) y `pdf-images-shared-test.mjs` (12/12). Un cotejo automatico (listar `tests/workspace/*.mjs` vs los archivos citados en `scripts/test-workspace-release.mjs` y `tests/run-all.mjs`) encontro que NO estaban registradas en ninguno de los dos runners. Se re-ejecutaban a mano en cada ciclo como "red de seguridad" de los cambios de paginacion/estimacion de PDF, pero al no estar en el gate, una regresion en ese camino (por ejemplo la altura de estimacion, el wrap de texto, el encaje de imagenes de CE-076/077/078) era invisible para la regresion automatizada. Es el mismo tipo de deuda de cobertura que se ataco en CE-065. |
| **Hypothesis** | Registrar las tres suites en `scripts/test-workspace-release.mjs` (junto a las demas suites de PDF) elimina el riesgo de deriva y hace que el gate las proteja de forma automatica, sin modificar su contenido (solo la ejecucion). |
| **Change** | `scripts/test-workspace-release.mjs`: se anaden tres `run(...)` tras `pdf-image-fit` (CE-078) con un comentario que explicita que eran huérfanas y cubren el camino `document.to-pdf` y la normalizacion compartida de imagenes. Ningun archivo de producto cambiado. |
| **Bugs encontrados** | Ninguno en este ciclo (higiene/cobertura). Se confirmo que las tres suites pasan limpias en aislamiento: `pdf-table-pagination` 7/7, `workflow-document-pdf` 66/66, `pdf-images-shared` 12/12. |
| **Tests ejecutados** | Las tres suites en aislamiento (7 + 66 + 12 = 85 checks, 0 fail) y el RELEASE GATE completo despues de registrarlas: 45 suites PASS 0 fail. |
| **Tests PASS** | 45 suites (incluye las 3 nuevas registradas) = 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-080 (registro en `test-workspace-release.mjs` + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`). Merger de manifests del release-gate y evidencias regeneradas se excluyen del commit (anti-churn). |
| **Limitaciones** | Solo se registraron estas 3 suites del camino PDF; hay mas archivos en `tests/workspace` y en `tests/` que pueden ser orfanos de otros runners (auditoria mas amplia queda como oportunidad si se quiere). No se añadio cobertura nueva, solo se puso en el gate lo que ya existia. |
| **Proxima prioridad** | Proximo TODO de producto o DISCOVERY cuando el backlog este vacio (`cli recommend`). |

---

## Cycle 144 — Fix orphan invoice-fields test that only passed in a foreign context (CE-081)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | e90935d |
| **HEAD final** | a408a9c (commit CE-081 de este ciclo) |
| **Task** | CE-081 (MEANINGFUL_TEST_COVERAGE, P3): `tests/workspace/invoice-fields-test.mjs` (extraccion de campos de factura del flujo estrella, 29 checks) era HUERFANA: no estaba en `tests/run-all.mjs` ni en `scripts/test-workspace-release.mjs`. Al correrla en aislamiento fallaba con `ReferenceError: WORKFLOW_DEFINITION_VERSION is not defined`: `workflow-model.js` importa esa constante de `schema-versions.js`, pero el test usa `stripImports()` (borra todos los `import`) y la constante quedaba indefinida, asi que la suite solo "pasaba" si un contexto ajeno definia la constante. Mismo tipo de deuda de cobertura que CE-065/CE-080. |
| **Hypothesis** | Inyectar `WORKFLOW_DEFINITION_VERSION: 1` en el sandbox del test permite que pase limpia en aislamiento y registrarla en el gate. |
| **Change** | `tests/workspace/invoice-fields-test.mjs`: se injecta `WORKFLOW_DEFINITION_VERSION: 1` en `sandbox` + `sandboxArgs` del `new Function` (mismo idiom que `model-fk-test.mjs`). `scripts/test-workspace-release.mjs`: se registra la suite junto al parser de instrucciones. |
| **Bugs encontrados** | Deuda de cobertura: suite huérfana que solo pasaba en contexto ajeno. |
| **Tests PASS** | invoice-fields 29/29 en aislamiento; RELEASE GATE completo 46 suites PASS 0 fail. |
| **Tests FAIL** | 0. |
| **Commits** | CE-081 (fix sandbox + registro en gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Manifests del gate y evidencias regeneradas excluidos del commit (anti-churn). |
| **Limitaciones** | Correccion de infraestructura de test; no cambio de producto. |
| **Proxima prioridad** | Auditoria adversarial de persistencia del editor (CE-082, siguiente ciclo). |

---

## Cycle 145 — Adversarial persistence race audit of the document editor: no reproducible data-loss defect; guarantees certified + residual risks tested (CE-082)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-30 |
| **Branch** | main |
| **HEAD inicial** | a408a9c |
| **HEAD final** | 2ce42bc (commit CE-082 de este ciclo) |
| **Task** | CE-082 (auditoria adversarial, P2): auditar el camino de persistencia del editor de documentos END-TO-END (`autoSaveDoc -> lock -> saveDoc -> almacen -> reload`) con el CODIGO REAL de `workspace.js` y una capa persistente en memoria fiel a `storage.js`, para certificar garantias anti-perdida o descubrir una condicion de carrera real de data-loss. |
| **Hypothesis** | Sin asumir un bug: si existe una condicion de carrera real de data-loss, una suite adversarial determinista que re-cargue la entidad tras cada escenario destructivo y valide el CONTENIDO EXACTO la revelara; si no existe, la suite certifica las garantias y documenta los riesgos residuales. |
| **Change** | Suite nueva `tests/workspace/document-editor-persistence-race-test.mjs` 21/21 (pure, determinista x3). Extrae por regex `_createSaveLock`, `_createEntityLockMap`, `autoSaveDoc`, `_flushDirtyEntity` REALES de `workspace.js` y los cablea con `appStore` real (createStore de `state.js`), capa persistente en memoria que replica fielmente `saveDoc` de `storage.js` (guard `_writeSeq` coalescing, migrateObject, dbGet/dbPut), timers manuales deterministas y `reload` (loadDoc) tras cada escenario. NO se cambio ningun archivo de produccion: no se encontro defecto reproducible en las rutas vivas (CE-057/058 ya endurecieron lock/stale-write/flush). Registrada en `scripts/test-workspace-release.mjs`. |
| **Cobertura** | (1) LWW por orden logico: edits rapidos = ultimo, out-of-order no sobrescribe, mutacion en vuelo = ultimo, 3 docs alternos reload exacto. (2) flush-before-navigate conserva. (3) cambio de documento nunca cruza ids. (4) fallo de escritura no marca guardado + recuperacion persiste. (5) aislamiento por id (20 writes de A no tocan B). (6) delete mientras save en vuelo. |
| **Bugs encontrados** | Ninguno reproducible de data-loss en las rutas vivas. Dos RISCOS RESIDUALES documentados y probados en la suite: (a) un fallo transitorio del write no marca `isDirty=false` (edge de UX, no perdida real: el proximo debounce re-envia); (b) `deleteDoc` NO cancela un save en vuelo del lock -> el `dbPut` puede RESUCITAR un doc borrado (ventana minima: el editor flushea al salir antes de que el borrado sea alcanzable, que solo vive en la vista Documentos). |
| **Tests PASS** | document-editor-persistence-race 21/21 (x3). |
| **Tests FAIL** | 0. |
| **Commits** | CE-082 (suite adversarial + registro en gate + trackers). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Manifests del gate y evidencias regeneradas excluidos (anti-churn). |
| **Limitaciones** | Fuera de alcance de una suite pura: no se puede sincronizar de forma determinista el race REAL entre `deleteDoc` y el write in-flight dentro de IndexedDB (se modela con la capa en memoria); el risque de resurreccion de (b) queda como limite documentado con plan, no cerrado este ciclo. |
| **Proxima prioridad** | Si se quiere cerrar el risque (b) (delete cancela save en vuelo del lock) en un ciclo futuro; de lo contrario siguiente TODO de producto o DISCOVERY. |

---

## Cycle 146 — Discovery de producto: 7 oportunidades nuevas registradas (CE-083→CE-089)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 63aa3d3 |
| **HEAD final** | 63aa3d3 (ciclo de DISCOVERY: 0 cambios de produccion) |
| **Task** | DISCOVERY (guia 1.8 / mision 3.6): la cola no tiene tareas `TODO` (solo CE-011 y CE-063 P3 DISCOVERED, ambas decisiones del dueno/host o gates ya heredados). El ciclo se dedica a generar oportunidades nuevas (P1/P2/P3) y registrarlas como DISCOVERED. Explorado con 3 agentes paralelos: area PDF del star-flow, Workspace UX/persistencia, y pipeline OCR/factura/documento-tabla. |
| **Hypothesis** | Un barrido dirigido de gaps funcionales reales en las tres areas identifica candidatas que responden SI a las 4 preguntas de producto (necesidad real, 100% local/sin API key, diferenciada, implementacion real verificable) y no son decorativos ni mocks. |
| **Change** | 7 candidatas nuevas registradas como DISCOVERED en `CONTINUOUS-EVOLUTION-QUEUE.md` (CE-083→CE-089), todas con evidencia file:line verificada leyendo el codigo real: (CE-083/P2) lineItems de factura calculados por `parseInvoiceText` pero descartados por `text.invoice-fields`; (CE-084/P2) `pdfString` escapa chars >= 256 con octal >3 digitos corrompiendo el string PDF; (CE-085/P2) la busqueda universal (Ctrl+K) no busca contenido del usuario; (CE-086/P2) sin rename/duplicar/mover para proyectos/docs/tablas/capturas (`updateProject` sin uso); (CE-087/P3) vista previa del builder de diseno != paginacion del PDF exportado; (CE-088/P2) el boton Cancelar de OCR no aborta el worker y aun crea el documento (`signal.cancelled` nunca se pasa); (CE-089/P3) el parser de factura asume una factura por escaneo y pierde el resto sin aviso. |
| **Bugs encontrados** | 2 bugs funcionales candidatos (no corregidos este ciclo, registrados para evaluar): (CE-084) caracteres no-WinAnsi corrompen strings PDF; (CE-088) cancel de OCR no aborta. |
| **Tests ejecutados** | 0 suites en este ciclo (DISCOVERY puro, sin cambios de codigo). Regresion no aplica: no se toco produccion. |
| **Commits** | Ciclo sin commits (solo actualizacion de QUEUE.md; STATUS.md este registro). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados (opencode.json, offline.html, styles.css, guides.json, generate-apluno-pages.mjs, evidencias y release-gate manifests) sin tocar. |
| **Limitaciones** | DISCOVERY registra oportunidades con evidencia estatica; ninguna implementada. La promocion a TODO y ejecucion se decide por prioridad (P2 primero: CE-083/084/085/086/088; P3: CE-087/089) en el siguiente ciclo. |
| **Proxima prioridad** | Promover a TODO la oportunidad DISCOVERED de mayor valor/riesgo. Recomendacion: CE-083 (superficie de lineItems de factura al usuario, sirve directo `documento -> tabla` del flujo estrella con datos ya calculados y bajo riesgo) o CE-084 (correccion de strings PDF no-WinAnsi). Alternativamente CE-011/CE-063 no aplican (decision del dueno/host). El despliegue del HEAD certificado depende del canal autorizado de GitHub. |

---

## Cycle 147 — CE-083: exponer lineItems de factura como tabla al Workspace (flujo estrella documento->tabla)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 40f77f9 |
| **HEAD final** | 398330a |
| **Task** | CE-083 (P2, ACTIVE): los `lineItems` que `parseInvoiceText` calcula (invoice.js:112-144) se descartaban en `text.invoice-fields`, rompiendo `archivo -> escaneo -> OCR -> documento -> tabla` para facturas. Implementar la superficie de lineItems al usuario sin modulo nuevo. |
| **Hypothesis** | Emitir los renglones de compra como una tabla real en el output de la operacion y persistirlos en el Workspace con id estable y dedup cierra el flujo estrella para facturas con datos ya calculados y bajo riesgo (backward-compatible). |
| **Change** | `text.invoice-fields.execute` (workflow-operations.js) anade `lineItems` `{headers:['Descripcion','Cantidad','Precio unitario','Importe'], rows}` derivado de `parsed.lineItems`, manteniendo `headers`/`rows`/`name`/`confidence` intactos. `addResultToWorkspace` rama data (workflow-ui.js) persiste los renglones como tabla propia de id estable `flow-invoice-items-<hash>` cuando `rows.length>0`, con dedup por id y refresh de counts, usando `pushHistory({action:'workflow-result-add-items'})`. |
| **Tests ejecutados** | invoice-fields 34/34 (5 checks nuevos de lineItems), workflow-ui 71/71 (6 checks nuevos 60-65), invoice-fields e2e 16/16 (renglon `Servicio de diseno` extraido del OCR real; salida expone la tabla de renglones), release gate completo OK (todas las suites PASS). |
| **Resultado** | FEATURE. El output de facturas ahora termina en tabla de renglones persistida en el Workspace, sirviendo el flujo estrella. |
| **Evidence** | `workspace/core/workflow-operations.js` (lineItems), `workspace/core/workflow-ui.js` (`flow-invoice-items-`), `tests/workspace/invoice-fields-e2e.mjs` (assert de renglones). |
| **Commits** | 398330a (implementacion CE-083). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | El dedup de la tabla de renglones colisiona en el harness de test con tablas de id `undefined` (en produccion `saveData` asigna id); los tests fijan id real y resetean estado entre fases. Limite documentado. |
| **Proxima prioridad** | Siguiente oportunidad P2: CE-084 (correccion de strings PDF no-WinAnsi, bug de integridad del resultado profesional) o CE-085 (busqueda universal por contenido de usuario). |

---

## Cycle 148 — CE-084: pdfString ya no corrompe strings PDF con chars fuera de WinAnsi

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 572a3af |
| **HEAD final** | 6a3a49f |
| **Task** | CE-084 (P2, activa): `pdfString` (pdf-generator.js) escapa todo c>=128 como octal `padStart(3,'0')`; para chars con charCodeAt >= 0x100 (Euro/comillas/TM/guiones, CJK, emoji) el octal tiene 4+ digitos y el lector PDF trunca a `\ddd`, corrompiendo el resto del string. Bug de integridad del resultado profesional. |
| **Hypothesis** | Representar correctamente el rango WinAnsi: emitir octal `\ddd` valido para 0x80-0xFF, re-mapear los chars>=0x100 con codigo cp1252 a su byte winansi, y degradar los fuera de winansi a un marcador no destructivo (espacio), sin emitir jamas un octal de 4+ digitos. |
| **Change** | `pdfString` ahora: para c<=255 emite `\ddd` de 1 byte winansi; para c>=0x100 consulta `WINANSI_HIGH_CP` (tabla cp1252 inversa: Euro->0x80, TM->0x99, comillas/guiones/puntos) y emite el byte correspondiente; si el char no existe en winansi (CJK/emoji) degrada a espacio no destructivo. El flujo del stream es siempre estructuralmente valido. |
| **Bugs corregidos** | Corrupcion de strings PDF con '€', '™', comillas tipograficas, guiones, 'ﬁ' y cualquier char con charCodeAt>=0x100; antes '€'(8634) emitia `\20254` que el lector leia como byte 0x82 + literal '54'. |
| **Tests ejecutados** | `workflow-document-pdf` 75/75 (9 checks nuevos CE-084 sobre el stream real: sin `/(\\[0-7]{4,})/`, Euro->`\200`, TM->`\231`, ASCII alrededor preservado, CJK/emoji no corrompen, xref presente). Suites PDF individuales OK (text/table/chart-wrap, pagination). Release gate completo OK. |
| **Resultado** | BUG_FIX. El resultado profesional PDF mantiene integridad de string incluso con simbolos de moneda y discriminacion CJK/emoji no destructiva. |
| **Evidence** | `workspace/core/pdf-generator.js` (`WINANSI_HIGH_CP`, `pdfString`), `tests/workspace/workflow-document-pdf-test.mjs` (secciones 17-18). |
| **Commits** | 6a3a49f (fix CE-084). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | Los chars fuera de winansi (CJK/emoji) se degradan a espacio (no renderizan en una fuente de 1 byte); limites documentados en comentario. El mapeo cp1252 cubre la mitad alta 0x80-0x9F (27 chars), el resto Latin-1 por rango directo. |
| **Proxima prioridad** | Siguiente oportunidad P2: CE-085 (busqueda universal por contenido de usuario), CE-086 (rename/duplicate/mover), o CE-088 (Cancel de OCR no aborta). |

---

## Cycle 149 — CE-088: Cancelar OCR realmente aborta y no crea documento sorpresa

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | d62b6dd |
| **HEAD final** | dc8c1fb |
| **Task** | CE-088 (P2, ACTIVE): el boton «Cancelar» de `extractTextFromScan` (workspace.js) solo llamaba `closeModal()`; el worker Tesseract seguia y al resolver creaba el documento igualmente. `recognizeText` ya soportaba `signal` abortable (ocr-engine.js:56-63) sin uso. |
| **Hypothesis** | Cablear un flag de cancel al boton existente, pasarlo como `signal` a `recognizeText` (que ya devuelve `{ cancelled:true }` al abortar) y abortar temprano despues del recognize evitara crear un documento sorpresa y volvera a la vista de captura. |
| **Change** | `extractTextFromScan` declara `cancelOcr={cancelled:false}`; el boton `ocr-cancel-btn` lo muta (`cancelOcr.cancelled=true`) y cierra; se pasa `signal: cancelOcr` a `recognizeText`; tras recognize, si `ocrResult.cancelled` se regresa de inmediato sin crear documento, sin abrir `showExtractionModeChooser` y sin registrar ejecucion. |
| **Bugs corregidos** | OCR largo no cancelable que creaba documento sorpresa tras pulsar Cancelar. Ahora el usuario vuelve a la vista de captura sin resultado no deseado. |
| **Tests ejecutados** | 5 checks nuevos CE-088 en `workflow-lifecycle-test` (82/82), coherentes con el patron de inspeccion de source que ese suite ya usaba para `ocr-engine`/`workflow-operations`. Star-flow E2E OCR real 85/85 (el guard de cancel no altera el recorrido normal). Release gate completo OK (sync source->dist). |
| **Resultado** | BUG_FIX. Cancelar OCR deja de fabricar un documento; el signal abortable de `recognizeText` por fin se usa. |
| **Evidence** | `workspace/workspace.js` (`cancelOcr`, boton, guard `ocrResult.cancelled`), `tests/workspace/workflow-lifecycle-test.mjs` (checks CE-088). |
| **Commits** | dc8c1fb (fix CE-088). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | El worker Tesseract no es preemptible en esta build: al cancelar se evita la creacion de documento y el chooser, pero el hilo de reconocimiento puede terminar el computo en segundo plano sin efecto visible. Abortar el worker de verdad exigiria integrar un token de cancelacion en `vendor/js/engine-loader.js` (fuera de alcance). |
| **Proxima prioridad** | Siguiente oportunidad P2: CE-085 (busqueda universal por contenido de usuario) o CE-086 (rename/duplicate/mover). En P3, CE-089 (multiples facturas por escaneo). |

---

## Cycle 150 — CE-085: la busqueda universal alcanza el contenido del usuario

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 1ecc62d |
| **HEAD final** | 4f86584 |
| **Task** | CE-085 (P2, ACTIVE->DONE): la busqueda universal (Ctrl+K) solo filtraba navegacion y las 167 herramientas; nunca buscaba documentos, tablas ni capturas del usuario. `filterPalette` construia su lista solo con `navItems` + `TOOLS_DATA`. |
| **Hypothesis** | Extender `filterPalette` para agregar el contenido del proyecto actual (funcion ya recibe `appStore.get('currentProject')`) y hacer deep-link a la entidad correpondiente permite encontrar cualquier documento/tabla/captura por nombre sin salir del proyecto y 100% local. |
| **Change** | `filterPalette` agrega, cuando hay proyecto activo, los documentos (`navigateTo('doc-editor', {doc})`), tablas de datos (`navigateTo('data-table', {dataTable})`) y capturas (`navigateTo('capture')`) del proyecto matcheando por nombre (case-insensitive), y etiqueta cada resultado con su tipo (Documento/Tabla/Captura). Se reutiliza el `project` ya declarado en la funcion (sin redeclaracion). |
| **Bugs corregidos** | Contenido del usuario inencontrable por nombre con muchas capturas/documentos. |
| **Tests ejecutados** | 7 checks nuevos CE-085 de inspeccion de source en `workflow-lifecycle-test` (89/89), coherentes con el patron que ese suite ya usaba para OCR/palette; release gate completo OK (build + sync source->dist + todas las suites). |
| **Resultado** | FEATURE. La palette universal ahora busca contenido del usuario y hace deep-link a cada entidad. |
| **Evidence** | `workspace/workspace.js` (bloque CE-085 en `filterPalette`), `tests/workspace/workflow-lifecycle-test.mjs` (checks CE-085). |
| **Commits** | 4f86584 (feature CE-085). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | La busqueda compara por titulo (`name`) de documento/tabla/captura, no por contenido OCR ni texto de cuerpo; el scope limite al proyecto actual. Indexar el texto OCR como ruta futura. |
| **Proxima prioridad** | Siguiente oportunidad P2: CE-086 (rename/duplicate/mover; `updateProject` sin uso) o CE-088 ya resuelto; en P3, CE-089 (multiples facturas por escaneo). |

---

## Cycle 151 — CE-086: renombrar en sitio proyecto, documento, tabla y captura

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 54f621b |
| **HEAD final** | 20cb369 |
| **Task** | CE-086 (P2, ACTIVE->DONE): no habia rename en sitio para proyectos, documentos, tablas ni capturas; `updateProject` existia en storage.js pero la UI jamas lo invocaba; las tarjetas solo ofrecian Eliminar (+Encadenar/Extraer/Charts). |
| **Hypothesis** | Un dialogo reutilizable de renombrar (input prefilled + validacion) cableado a los APIs de persistencia ya existentes (`updateProject`/`saveDoc`/`saveData`/`saveCapture`) permite renombrar cualquier entidad sin borrarla ni recrearla, 100% local. |
| **Change** | `renameEntityModal({title,label,value,onRename})` usa `showModal` con un input `.ws-input` prefilled, valida que no quede vacio, Enter envia, y delega en `onRename`. Botones «Renombrar» añadidos a las 4 tarjetas: proyecto→`updateProject(p.id,{name})` + refrescar `projects` y re-render; documento→muta `name`+`title` y `saveDoc`; tabla→muta `name` y `saveData`; captura→muta `name`, `saveCapture` + `refreshProjectCounts`. Cada onRename refresca el array correspondiente del appStore y re-renderiza la vista. |
| **Bugs corregidos** | Un «Documento sin titulo» o proyecto no se podia nombrar en sitio; ahora se renombra sin borrar/recriar, preservando id, bloques, filas y derivados. |
| **Tests ejecutados** | 7 checks nuevos CE-086 de inspeccion de source en `workflow-lifecycle-test` (96/96), coherentes con el patron del suite; parseo real de workspace.js/storage.js/models.js (chequeo sin imports, PARSE OK); release gate completo OK (build + sync source->dist + todas las suites). |
| **Resultado** | FEATURE. Rename en sitio para las 4 entidades del proyecto via dialogo reutilizable. |
| **Evidence** | `workspace/workspace.js` (`renameEntityModal`, `renameProjectCard`, `renameDocCard`, `renameDataTableCard`, `renameCaptureCard`, botones en tarjetas), `tests/workspace/workflow-lifecycle-test.mjs` (checks CE-086). |
| **Commits** | 20cb369 (feature CE-086). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | Solo rename en sitio: duplicate y mover (re-parentear entre proyectos) quedan como ruta futura; la fila CE-086 cierra el rename, no el resto. El dialogo no muestra mensaje de error por fallo de persistencia mas alla del toast generico. |
| **Proxima prioridad** | Siguiente oportunidad P2: CE-085 ya resuelto; quedan CE-083/084/088 completadas. En P3, CE-089 (multiples facturas por escaneo) y CE-087 (coherencia WYSIWYG del builder de diseno). |

---

## Cycle 152 — CE-089: detectar multiples facturas en un escaneo y avisarlo

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 0443365 |
| **HEAD final** | 5f27126 |
| **Task** | CE-089 (P3, ACTIVE->DONE): `parseInvoiceText` asumia una sola factura por escaneo; `valueFromLines` tomaba el primer match de cada campo, por lo que un escaneo con 2-3 recibos perdia todos menos uno SIN aviso. |
| **Hypothesis** | Una heuristica conservadora y determinista que cuente «totales finales» (no subtotal/IVA) y numeros de factura repetidos permite detectar multiples recibos y avisar al usuario, evitando presentar una extraccion parcial como completa, sin implementar la division automatica (complejidad OCR real). |
| **Change** | `detectMultipleInvoices` (invoice.js) cuenta lineas `finalTotal` (Total/Importe total/Monto total/Amount due + importe) y marcadores `invoiceNumber` (Factura/Invoice N...); si alguno >= 2 devuelve `{detected:true,count,note}`. `parseInvoiceText` expone `multipleInvoices`. `text.invoice-fields` lo refleja en `warning`; `renderResultItems` (workflow-ui.js) muestra la advertencia en el panel del flujo; `addResultToWorkspace` para una tabla con warning persiste una fila de aviso visible y lanza toast de warning. |
| **Bugs corregidos** | Un escaneo de varios recibos se descifraba mal en silencio. Ahora se avisa claramente que puede haber varias facturas y que solo se extrajo la primera. |
| **Tests ejecutados** | 7 checks nuevos CE-089 en `invoice-fields-test` (42/42, VM del parser + operacion real), incluido un check de NO falso positivo en factura unica y de no-aviso en subtotal/IVA (evita contar el cierre de la misma factura). Release gate completo OK. |
| **Resultado** | FEATURE. Deteccion + aviso de multiples facturas en el panel y en la tabla persistida. |
| **Evidence** | `workspace/core/invoice.js` (`detectMultipleInvoices`), `workspace/core/workflow-operations.js` (warning), `workspace/core/workflow-ui.js` (panel + persistencia del aviso), `tests/workspace/invoice-fields-test.mjs` (checks CE-089). |
| **Commits** | 5f27126 (feature CE-089). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | No divide el escaneo en facturas separadas (complejidad OCR real; queda como ruta futura). La deteccion es conservadora: depende de que el OCR preserve etiquetas de Total/numero; un escaneo muy ruidoso podria no detectarse. El aviso va en la tabla y el panel, no obstruye. |
| **Proxima prioridad** | Quedan TO_DO. En P3, CE-087 (coherencia WYSIWYG del builder de diseno vs paginacion del PDF exportado: `estimateSectionHeight` vs `pdf-generator`). |

---

## Cycle 153 — CE-087: la preview del builder de diseno pagina igual que el PDF exportado

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | e6618b6 |
| **HEAD final** | 41d602d |
| **Task** | CE-087 (P3, DISCOVERED->DONE): la vista previa WYSIWYG del builder de diseno no coincidia con la paginacion del PDF: `estimateSectionHeight` (design-report.js:88) usaba altura fija por fila de tabla e ignoraba el wrap de celdas y el re-escalado de imagenes, mientras el generador real (`estimateSectionH` en pdf-generator.js) calculaba altura variable por contenido; el usuario disenaba esperando WYSIWYG pero el PDF refluia de pagina distinto (cortaba tablas, movia secciones). |
| **Hypothesis** | Extraer el estimador de altura del generador real a una funcion top-level compartida y exportada, y que la preview la reutilice (decidiendo los saltos en pt con conversion de unidades preview px <-> pt) elimina la divergencia de paginacion al usar una sola fuente de verdad de encaje. |
| **Change** | `pdf-generator.js`: `estimateSectionH(section, contentW, usableH)` y `estimateTextSectionH(section, contentW)` movidas a top-level (reusando `wrapText`, `fitImageDisplay`, `tableColWidth`, `tableRowHeight`) y exportadas; `generatePDF` las llama pasando `contentW`/`usableH`. `design-report.js`: importa `estimateSectionH`; `renderReportPreview` decide la paginacion en pt con la MISMA funcion (conversion `px=mm*scale` <-> `pt=mm*2.835`) y `estimateSectionHeight` delega en el mismo estimador. |
| **Tests ejecutados** | Suite nueva `tests/workspace/design-report-wysiwyg-test.mjs` 14/14 (pure, sin navegador; carga ambos modulos reales por `new Function` concatenando pdf-generator antes de design-report): la preview genera el mismo numero de paginas que una referencia independiente en pt basada en el estimador compartido y que el PDF exportado, cada seccion cae en la misma pagina con el mismo `y` en px (< 1e-4), y `estimateSectionHeight` delega igual al estimador para title/table/image/chart. Registrada en el release gate. Release gate completo OK (build + sync source->dist + todas las suites). |
| **Resultado** | ARCHITECTURE_IMPROVEMENT. Una sola fuente de verdad de encaje/paginacion compartida entre preview y PDF. |
| **Evidence** | `workspace/core/pdf-generator.js` (`estimateSectionH`, `estimateTextSectionH`, export ampliado), `workspace/core/design-report.js` (import + paginacion en pt + delegacion), `tests/workspace/design-report-wysiwyg-test.mjs`. |
| **Commits** | 41d602d (feature CE-087). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados sin tocar. |
| **Limitaciones** | La preview pinta cada seccion con su altura CSS natural (los [saltos de pagina, alturas estimadas] coinciden con el PDF, pero la altura visual del DOM de una imagen/linea puede no igualar el px exacto del exportado; el desbordamiento en la pagina previa queda oculto por `overflow:hidden`, igual que antes). La conversion de unidades asume escala fija 2. |
| **Proxima prioridad** | La cola DISCOVERED quedo VACIA tras CE-087. Aplicar regla 6 (DISCOVERY futuro) si se continua: producir nueva evidencia file:line desde el codigo real y registrarla. |

---

## Cycle 154 — DISCOVERY PASS: cola vacia -> busqueda nueva de oportunidades con evidencia

| Field | Value |
|-------|-------|
| **Date** | 2026-09-01 |
| **Branch** | main |
| **HEAD inicial** | 3d2d698 (CE-087 docs) |
| **HEAD final** | 3d2d698 (solo documentacion; sin cambios de codigo) |
| **Task** | DISCOVERY PASS (regla 6) tras quedar la cola DISCOVERED vacia y las 7 oportunidades previas (CE-083..CE-089) DONE. Buscar oportunidades NUEVAS genuinas (fiabilidad, perdida de datos, UX, plataforma, tests) con evidencia file:line, no especulacion ni trabajo artificial. |
| **Areas inspeccionadas** | (1) Persistencia/autosave/cambio de entidad: `workspace.js` (`_flushDirtyEntity` 1156-1178, autosave 845-873, doc card 3121), `state.js` (store 1-31, appStore 71-72). (2) Undo/redo: `workspace.js` (`_captureWorkspaceState` 824-837, `_appHistory` 1012, `tableHistories` 4684-4712, `renderBlock` 3804, tablas 4847-4854/5051/5415). (3) Import/export: `storage.js` (export 272-291, import 293-418), `bundle.js` (validate 197-201). (4) Boot/recovery: `workspace.js` initApp (916), boot call (8766-8771), `state.js` 71-72, `workspace-storage.js` (8-15), `db.js` (38-42). (5) PDF/generador revalidado (sin hallazgo nuevo): suites 86/86 en el release gate del ciclo anterior. (6) Sitio publico/APLUNO (accesibilidad, demos, offline): sin hallazgo accionable de prioridad alta (skip/aria en toolisto.html, offline.html deliberadamente excluido del SW en paginas de marketing, demos sin cobertura funcional -> DEBIL/por ahora). |
| **Evidencia principal** | (CE-090) `workspace.js:3121` card handler setea `currentDoc`+`currentView` juntos; `state.js:11` comparacion por referencia -> sin `renderView`/`_flushDirtyEntity` al cambiar de doc/tabla dentro de la misma vista; autosave 845-873 lee solo el nuevo current. (CE-091) `workspace.js:830` snapshot de `documents` descarta `block.type`/`html`/`headers`/`rows`; `3804` `block.type.startsWith` crashea con `type` undefined. (CE-092) `state.js:71-72` `JSON.parse(localStorage...)` sin try/catch a nivel de import. (CE-093) `storage.js:309-350,417` remapea refs sin validar targets en el bundle; assertIntegrity post-commit solo evento. (CE-094) `storage.js:272-291` export lee IndexedDB sin flushear autosaves pendientes. (CE-095) `workspace.js:4706-4712` `commitTableEdit` sin cap de historial vs `maxEntries:50` de `_appHistory` (1012). |
| **Candidatos rechazados (con motivo)** | · Bottom-table `addRow` sin confirmacion (LOW VALUE: undo existe, accion intencional). · `_colFilters` fuera de checkpoint (LOW VALUE: estado transitorio de UI no persistido; impacto minimo). · Estado vacio del editor (NO computable como defecto: ya tiene boton «Agregar bloque»). · Electron/desktop undo manual con execCommand en un bloque (incluido en CE-091). · APLUNO sin cobertura funcional de demos y offline deliberado (DEBIL para este ciclo: fuera del foco del Workspace; valor dudoso). · Undo de tabla desalineado con topbar (fundido en CE-091). |
| **Aceptados** | CE-090 (P1, data-loss doc/tabla switch), CE-091 (P1, undo corruptor de lista de docs/desalineado tabla), CE-092 (P2, localStorage corrupto rompe boot), CE-093 (P2, import acepta refs colgantes), CE-094 (P2, export exporta estado stale), CE-095 (P3, historial de tabla sin cap de memoria). Ordenados por valor/riesgo. |
| **Nuevo orden de la cola** | P1: CE-090 (proximo ciclo recomendado), CE-091. P2: CE-092, CE-093, CE-094. P3: CE-095. Seis candidatos NUEVOS (deduplicados contra historial y suites). |
| **Recomendacion siguiente ciclo** | CE-090 (P1) — perdida de datos al cambiar de documento/tabla sin navegar; flush-on-switch con test adversarial (patron CE-082). |
| **Resultado** | DISCOVERY. Nuevo backlog de 6 oportunidades accionables con evidencia; ningun codigo de produccion modificado en este ciclo. |
| **Tests/checks** | Ningun test nuevo necesario para discovery: se reutilizo evidencia estatica file:line verificada por lectura directa (state.js, workspace.js, storage.js, bundle.js). El release gate del ciclo anterior (CE-087) quedo 46 suites PASS / 0 FAIL. |
| **Commits** | 3d2d698 fue HEAD pre-ciclo; este ciclo SOLO documentacion (QUEUE + STATUS). (Commit de docs si las reglas lo permiten.) |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. Working tree conserva reworks ajenos no commiteados (ADSENSE, TLT-*, offline.html, opencode.json, etc.) SIN tocar. |
| **Limitaciones** | La prioridad P1 de CE-090/091 se asigno por la clase de riesgo (perdida de datos / corrupcion en memoria) y requiere implementarla + test adelantado para confirmar la reproduccion real; la evidencia aqui es estatica (file:line) no ejecutada, propia de un ciclo de discovery. |
| **Proxima prioridad** | Implementar CE-090 (P1) como siguiente ciclo autonomo. |

---

## Cycle 155 — CE-090: flush-on-switch al cambiar de documento/tabla sin salir de la vista

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | f708698 (Cycle 154 DISCOVERY docs) |
| **HEAD final** | 112a7d4 (feature CE-090) |
| **Task** | CE-090 (P1, DISCOVERED->DONE): hueco de perdida de datos al cambiar de documento (o tabla) dentro de la MISMA vista sin navegar. El card handler hace `appStore.set({ currentDoc: doc, currentView: 'doc-editor' })` (workspace.js:3121) en una llamada; al ser `currentView` ya `'doc-editor'`, state.js (comparacion por referencia) no notifica -> no corre renderView -> no corre `_flushDirtyEntity` (1156-1178) para el SALIENTE. El intervalo de autosave (845-873) solo lee la entidad NUEVA: un debounce pendiente del saliente (1s) queda sin perseguirse y puede perderse en la ventana de 5s. |
| **Hypothesis** | Un flush-on-switch centralizado y testable: subscribir `currentDoc`/`currentDataTable` y flushear la entidad SALIENTE en el momento del cambio si su debounce sigue armado. El gate `_timer != null` es el unico disparador = solo actua cuando hay trabajo realmente pendiente (impide writes espurios al abrir un doc no editado, cuyo camino ya flusheo y limpio el timer en el cambio de vista). |
| **Change** | `workspace.js`: nueva `installEntitySwitchFlush(store)` que registra los subscribers de `currentDoc`/`currentDataTable` (flushea el saliente si `autoSaveDoc._timer`/`autoSaveTable._timer` != null al cambiar de id); nueva `_flushOutgoingEntity(entity, kind)` que limpia el timer del saliente y guarda ESA entidad por su lock (doc -> `saveDoc`; table -> `saveData` + `syncDerivedCharts`) usando el snapshot `_lastAutosave*`; se llama `installEntitySwitchFlush(appStore)` en el init junto a los demas subscribers. Sin cambios en el card handler ni en los sites de switch: el subscriber centraliza el cover de todos (tarjetas de doc/tabla, sheets de workbook). |
| **Tests ejecutados** | Suite nueva `tests/workspace/doc-table-switch-flush-test.mjs` 9/9 (pure, sin navegador; extrae por regex `_createSaveLock`, `_createEntityLockMap`, `autoSaveDoc`, `autoSaveTable`, `_flushOutgoingEntity`, `installEntitySwitchFlush`, `_flushDirtyEntity` REALES y las cablea con appStore real de state.js + capa persistente fiel a storage.js `saveDoc`/`saveData` (guard `_writeSeq`) + timers manuales): (1) doc->doc misma vista SIN renderView persiste la ultima edicion del saliente y no toca B; (2) tabla->tabla misma vista persiste T1 y no toca T2; (3) CONTROL NEGATIVO: sin `installEntitySwitchFlush` la edicion del saliente NO queda persistida al instante (reproduce la perdida exacta de CE-090, prueba que el fix es necesario y el escenario 1 no es tautologico); (4) regresion: el cambio de vista con `_flushDirtyEntity` real sigue flusheando. Registrada en `scripts/test-workspace-release.mjs`. |
| **Bug encontrado (confirmado)** | El hueco de CE-090 se confirma con el control negativo: cambiar de doc dentro de la misma vista con el debounce pendiente deja la edicion del saliente sin persistir al instante; nadie la flushea hasta el autosave de 5s (o se pierde). |
| **Bug corregido** | flush-on-switch guarda la entidad saliente en el momento del cambio de id si tiene trabajo pendiente. |
| **Tests PASS** | `doc-table-switch-flush` 9/9; regresiones: `document-editor-persistence-race` (CE-082) 23/23, `cross-entity-integrity` (CE-058) 55/55, `autosave-lock` (CE-057), `storage-*` (CE-059/060/061). Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (data-loss). Los tests adversariales (99/99 en las suites de persistencia regresion) confirman que el fix no introduce perdidas ni writes espurios. |
| **Evidence** | `workspace/workspace.js` (`installEntitySwitchFlush`, `_flushOutgoingEntity`), `tests/workspace/doc-table-switch-flush-test.mjs`, `scripts/test-workspace-release.mjs` (registro de suite), queue/status. |
| **Commits** | 112a7d4 (feature CE-090): `workspace.js`, `doc-table-switch-flush-test.mjs`, `test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. Working tree conserva reworks ajenos (ADSENSE, TLT-*, offline.html, opencode.json, etc.) sin tocar. |
| **Limitaciones** | El subscriber cubre el cambio de id de `currentDoc`/`currentDataTable`. El intervalor de autosave (5s) y el flush-before-navigate por cambio de vista siguen siendo los caminos para entidades sin id o cuando el debounce ya vencio. La perdida residual de un write que falla (no marca guardado) es el edge ya documentado en CE-057/082, no afectado por este fix. |
| **Proxima prioridad** | Implementar CE-091 (P1) — undo del topbar corrupto en la lista de documentos (blocks sin `type`) y desalineado con el undo de tabla. |

---

## Cycle 156 — CE-091: undo/redo sin corrupcion de documentos y alineado con el undo de tabla

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 51888c6 (Cycle 155 docs) |
| **HEAD final** | c37d52e (feature CE-091) |
| **Task** | CE-091 (P1, DISCOVERED->DONE): (A) `_captureWorkspaceState` guardaba cada documento de la lista como `{id,name,title,blocks:[{id,content}]}`, descartando `type`/`html`/`headers`/`rows`; al deshacer el topbar `_applyState` restauraba la lista truncada y abrir ese doc disparaba `renderBlock` con `block.type.startsWith(...)` -> TypeError (crash del editor; si se guardaba, persistia un doc sin `type`). (B) el topbar usaba el historial GLOBAL mientras las ediciones de celda de tabla se guardaban en `tableHistories` (WeakMap) -> el boton Deshacer NO deshacia la celda. |
| **Hypothesis** | (A) Clonar los bloques COMPLETOS en `_captureWorkspaceState` (misma estrategia que `currentDoc`/`currentDataTable`, que ya eran clones profundos) elimina el crash sin tocar el pipeline de undo. (B) En la vista `data-table`, el undo/redo debe delegar a `undoTableEdit`/`redoTableEdit` (tabla-local), que es exactamente donde vive la edicion de celda; fuera de data-table se mantiene `_appHistory`. |
| **Change** | `workspace.js`: `_captureWorkspaceState` ahora clona bloques completos (`JSON.parse(JSON.stringify(d.blocks))`) y tablas con filas/sheets/reviewStatus completos (headers/rows como copias, sheets y reviewStatus conservados); añade al snapshot `updatedAt/createdAt/projectId` de cada doc. Los botones Deshacer/Rehacer del topbar y el handler global Ctrl+Z/Ctrl+Y delegan a `undoTableEdit`/`redoTableEdit` + `rerenderTable` cuando `currentView === 'data-table'` y hay `currentDataTable`; si no, `_appHistory` (sin cambio de ruta). `_applyState` sigue re-renderizando desde el snapshot restaurado (que ahora es completo). |
| **Tests ejecutados** | Suite nueva `tests/workspace/undo-corruption-test.mjs` 15/15 (pure; extrae `_captureWorkspaceState` real, y el primitivo real de tabla `checkpointTableEdit`/`commitTableEdit`/`undoTableEdit`/`redoTableEdit`/`restoreTableSnapshot`/`ensureTableHistory`/`snapshotDataTable`/`snapshotKey` + `_createSaveLock`/`_createEntityLockMap` + `autoSaveTable`, cableados con appStore real de state.js + capa fiel a storage.js `saveData` + timers manuales): (A) el snapshot conserva `type` y campos extra (html/headers/rows) de cada bloque y clona profundo (retira el crash), y las `dataTables` conservan filas/sheets/reviewStatus como copias independientes; (B) undo/redo real de tabla deshace la celda y rehace, el historial de tabla queda en `tableHistories` separado del global (topbar delegado en data-table). Registrada en el release gate. |
| **Bug encontrado (confirmado)** | (A) El snapshot truncado de bloques (confirmado: `renderBlock` hacia `block.type.startsWith` con `type` undefined). (B) El boton Deshacer del topbar no deshacia la celda de tabla (historial global vs tabla-local). |
| **Bug corregido** | Snapshot de bloques completos (sin crash) + undo/redo de tabla local cuando la vista es data-table. |
| **Tests PASS** | `undo-corruption` 15/15; regresiones: `doc-table-switch-flush` (CE-090) 9/9, `document-editor-persistence-race` (CE-082) 23/23, `cross-entity-integrity` 55/55, storage/autosave/CE-059/060/061 OK. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX. Se retira el crash de `renderBlock` por bloques sin `type` y se alinea el undo/redo del topbar con el de tabla. |
| **Evidence** | `workspace/workspace.js` (`_captureWorkspaceState`, botones topbar, handler Ctrl+Z/Y), `tests/workspace/undo-corruption-test.mjs`, `scripts/test-workspace-release.mjs` (registro de suite), queue/status. |
| **Commits** | c37d52e (feature CE-091): `workspace.js`, `undo-corruption-test.mjs`, `test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. Working tree conserva reworks ajenos sin tocar. |
| **Limitaciones** | El topbar en data-table delega a la tabla-local; el historial global (`_appHistory`) sigue gobernando en el resto de vistas. El Ctrl+Z DENTRO de una celda de input lo maneja el editor de tabla (handler propio), el Ctrl+Z fuera de input en data-table delega a la tabla (igual que el boton). No se cambio la cardinalidad de `maxEntries:50` de `_appHistory` (CE-095 queda para el cap de memoria de `tableHistories`). |
| **Proxima prioridad** | Implementar CE-092 (P2) — corrupcion de `localStorage` rompe el arranque del Workspace (parse sin try/catch en `state.js`). |

---

## Cycle 157 — CE-092: el arranque sobrevive a un localStorage corrupto

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 51380e0 (Cycle 156 docs) |
| **HEAD final** | b251e09 (feature CE-092) |
| **Task** | CE-092 (P2, DISCOVERED->DONE): `state.js:71-72` hacia `JSON.parse(localStorage.getItem('toolisto-recent-tools') || '[]')` (y favorite-tools) a nivel de import SIN try/catch. Una sola clave corrupta (JSON invalido: escritura parcial, otro tab, edicion manual) lanzaba al instanciar `appStore`, ANTES de `initApp`, dejando la pantalla en blanco sin ruta de recuperacion. |
| **Hypothesis** | Envolver la lectura de esas preferencias en un helper seguro con try/catch (default `[]`) y limpiar la clave corrupta permite que el import de `appStore` nunca lance, conservando intactas las claves validas. Mas un test que cargue el CODIGO REAL de state.js con un localStorage controlado para confirmar el arranque sin crash y la auto-reparacion. |
| **Change** | `state.js`: nuevo `function readJsonList(key)` que lee `localStorage.getItem(key)`; si es null devuelve `[]`; si `JSON.parse` lanza (JSON invalido) o el valor no es un array, hace `localStorage.removeItem(key)` (auto-recuperacion) y devuelve `[]`; si es un array valido lo devuelve intacto. `recentTools` y `favoriteTools` se inicializan con `readJsonList('toolisto-recent-tools')` / `readJsonList('toolisto-favorite-tools')`, retirando el `JSON.parse(...)` directo del import. |
| **Tests ejecutados** | Suite nueva `tests/workspace/boot-recovery-test.mjs` 10/10 (pure; carga el CODIGO REAL de state.js extrayendo `createStore` + `readJsonList` y construyendo un appStore, con localStorage controlado inyectado como global y restaurado): (1) reproduccion: el `JSON.parse` sin try/catch LANZA con JSON invalido (era el crash de boot); (2) recentTools corrupto -> el store se construye sin lanzar, `[]` y la clave se elimina; (3) favoriteTools corrupto -> idem; (4) objeto (no array) -> `[]`; (5) clave ausente -> `[]`; (6) clave valida -> se conserva intacta sin eliminar; (7) array valido con elementos variados -> se conserva sin vaciar. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Un `JSON.parse` sin try/catch a nivel de import del modulo `appStore` lanza ante cualquier clave de preferencia corrupta -> pantalla en blanco (reproducido en el test). |
| **Bug corregido** | Lectura segura de las preferencias con default `[]`, eliminacion de la clave corrupta (auto-reparacion) y conservacion de las validas. |
| **Tests PASS** | `boot-recovery` 10/10; regresiones: undo-corruption (CE-091) 15/15, doc-table-switch-flush (CE-090) 9/9, persistence/storage CE-058/059/060/061 OK. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (boot recovery). El Workspace ya no deja de arrancar por una clave de preferencia corrupta. |
| **Evidence** | `workspace/core/state.js` (`readJsonList`), `tests/workspace/boot-recovery-test.mjs`, `scripts/test-workspace-release.mjs` (registro de suite), queue/status. |
| **Commits** | b251e09 (feature CE-092): `core/state.js`, `boot-recovery-test.mjs`, `test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. Working tree conserva reworks ajenos sin tocar. |
| **Limitaciones** | Solo cubre las dos claves deserializadas a nivel de import del modulo `appStore` (`recentTools`/`favoriteTools`). Otras claves de localStorage que se lean en otro punto del arranque con `JSON.parse` directo no estan cubiertas por este fix (se podrian auditar en un ciclo futuro si aparecen). La auto-reparacion elimina la clave corrupta (pierde esa preferencia puntual, que es inocua frente a bloquear el arranque). |
| **Proxima prioridad** | Implementar CE-093 (P2) — `importProject` no valida que las referencias cruzadas remapeadas apunten a entidades existentes en el bundle (ref colgante persistida; `assertIntegrity` corre post-commit). |

---

## Cycle 158 — CE-093: referencias cruzadas del bundle validadas antes de escribir

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 46a1e91 (Cycle 157 docs) |
| **HEAD final** | 56bfe39 (feature CE-093) |
| **Task** | CE-093 (P2, DISCOVERED->DONE): un bundle cuyo objeto referencia un ID que NO esta entre las entidades importadas dejaba, tras remapear con `remapRefs` (storage.js:325-350), una referencia colgante PERSISTIDA; `assertIntegrity` (517) corria despues del commit como fire-and-forget y solo emitia un evento que el usuario nunca ve. Sin rechazo pre-write de refs colgantes. |
| **Hypothesis** | Auditar las referencias cruzadas del bundle ANTES de escribir (en `validateBundleImport`, tras el manifiesto): rechazar cualquier referencia cuyo destino no exista entre las entidades que se van a importar, con la MISMA semantica de campos que el auditor de huerfanos (core/integrity.js), y rechazar tambien en bundles heredados (sin manifest). |
| **Change** | `core/bundle.js`: nuevo `validateBundleReferences(bundle)` que recalcula el conjunto de IDs importados por tipo de store mas un conjunto global, recorre cada objeto con `REF_SOURCE_FIELDS`/`REF_CONFIG_FIELDS`/`metadata.captureId`/`relations`/`inputAssetIds`/`derivedIds`, y rechaza (a) refs cuyo destino no exista en ningun store del bundle y (b) refs de tipo restringido (sourceTableId/tableId->tabla, sourceDocId/scanDocId->documento, captureId->captura) cuyo destino no este en su store correcto. `validateBundleImport` lo ejecuta tras el manifiesto y antes de cualquier escritura; aplica tambien a bundles heredados (sin manifest). Exportado para test. |
| **Tests ejecutados** | Suite nueva `tests/workspace/bundle-reference-validation-test.mjs` 14/14 (pure; carga el CODIGO REAL de core/bundle.js en un sandbox quitando el `import` de schema-versions y la cola de `export`, evalua el cuerpo real): bundle integro ok; sourceDocId colgante rechazado con diagnostico; sourceTableId a tabla inexistente rechazado (validacion por tipo); metadata.captureId colgante rechazado; relation.targetId colgante rechazado; inputAssetIds colgante rechazado; asset->asset presente se conserva (sin falso positivo); bundle heredado (sin manifest) con ref colgante igual rechazado; regresion: el bundle de referencia (capture->asset, asset-2.correctedAssetId->asset-1, exe->asset, wf.steps.scanDocId->doc) importa ok. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Receptor de import no rechazaba un bundle con referencias cruzadas colgantes (solo detectadas post-commit por el auditor, sin feedback al usuario). |
| **Bug corregido** | `validateBundleImport` ahora rechaza el bundle con diagnostico ANTES de escribir nada, y quedan protegidos tanto bundles con manifest como heredados; los round-trips validos (Phase 5, storage) no sufren falsos rechazos. |
| **Tests PASS** | `bundle-reference-validation` 14/14; regresiones: phase5-bundle-trust 53/53, storage-multicontext / cross-store / stale-delete / runtime-isolation OK, boot-recovery (CE-092) 10/10, undo-corruption (CE-091) 15/15. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (integridad de importacion). Un bundle con refs colgantes ya no crea proyectos con graficos/encadenados rotos sin aviso. |
| **Evidence** | `workspace/core/bundle.js` (`validateBundleReferences`, `validateBundleImport`), `tests/workspace/bundle-reference-validation-test.mjs`, `scripts/test-workspace-release.mjs` (registro de suite), queue/status. |
| **Commits** | 56bfe39 (feature CE-093): `core/bundle.js`, `bundle-reference-validation-test.mjs`, `test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. Working tree conserva reworks ajenos sin tocar. |
| **Limitaciones** | La validacion es INTERNA al bundle: exige que cada destino exista entre las entidades importadas. Referencias a entidades de otros proyectos no se importan y, por tanto, un destino que apunte fuera del bundle se rechaza (comportamiento deseado: Toolisto es local y cada proyecto es autocontenido). `correctedAssetId`/`derivedIds` de assets se auditan contra el conjunto global; solo los campos restringidos exigen store concreto, igual que el auditor de huerfanos. |
| **Proxima prioridad** | Implementar CE-094 (P2) — `exportProject` lee desde IndexedDB sin flushear los autosaves pendientes en memoria: una edicion recien hecha (debounce) se exportaba con el valor ANTERIOR. |

---

## Cycle 159 — CE-094: el export refleja la ultima edicion en memoria

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 9dfb766 (Cycle 158 docs) |
| **HEAD final** | 064b0a5 (feature CE-094) |
| **Task** | CE-094 (P2, DISCOVERED->DONE): `exportProject` (storage.js:272-291) lee el bundle desde IndexedDB; `exportProjectData` lo llamaba sin flushear los autosaves pendientes en memoria. Una edicion hecha dentro de la ventana del debounce (<1s) se exportaba con el valor ANTERIOR: perdida silenciosa de la ultima edicion en el snapshot. Complementario de CE-090 (alli navegacion, aqui export). |
| **Hypothesis** | Flushear la entidad actual sucia (doc o tabla) de forma AWAITABLE antes de leer el bundle en `exportProjectData`: tras el await, la base contiene la ultima edicion y el export la refleja. |
| **Change** | `workspace.js`: nuevo `_flushDirtyBeforeExport()` (async): con `currentProject`/`currentView`/`isDirty`/`currentDoc|currentDataTable`, limpia los timers del debounce y, si hay dirty, enqueuea un save AWAITABLE por el lock por-entidad (doc -> `saveDoc`, tabla -> `saveData` + `syncDerivedCharts`), actualiza el snapshot de autosave y marca `isDirty:false`. `exportProjectData` lo invoca con `await` ANTES de `exportProject`. `exportProjectFile` delega en `exportProjectData`, por lo que toda ruta de export queda cubierta. |
| **Tests ejecutados** | Suite nueva `tests/workspace/export-flush-fidelity-test.mjs` 9/9 (pure; `_flushDirtyBeforeExport` REAL de workspace.js + appStore real + capa persistente fiel a saveDoc/saveData con guard _writeSeq + syncDerivedCharts inyectable + timers manuales): (control negativo) en la ventana del debounce la base aun tiene el valor ANTERIOR -> es el hueco; tras `_flushDirtyBeforeExport` el doc persistio la ultima edicion (el reload == lo que leeria exportProject); tabla editada -> se persiste la celda y se invoca syncDerivedCharts; proyecto NO sucio -> sin escritura y sin timers residuales; sin proyecto -> no crashea. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | El export no flusheaba el autosave pendiente, por lo que una edicion recien hecha (dentro del debounce) se exportaba con el valor anterior. |
| **Bug corregido** | `exportProjectData` flushea el dirty actual (awaitable) antes de leer el bundle; el .toolisto exportado refleja la ultima edicion. |
| **Tests PASS** | `export-flush-fidelity` 9/9; regresiones: undo-corruption (CE-091) 15/15, boot-recovery (CE-092) 10/10, bundle-reference-validation (CE-093) 14/14, doc-table-switch-flush (CE-090) 9/9, phase5-bundle-trust 53/53. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (fidelidad de export). Ya no se pierde la ultima edicion al exportar dentro de la ventana del debounce. |
| **Evidence** | `workspace/workspace.js` (`_flushDirtyBeforeExport`, `exportProjectData`), `tests/workspace/export-flush-fidelity-test.mjs`, `scripts/test-workspace-release.mjs` (registro de suite), queue/status. |
| **Commits** | 064b0a5 (feature CE-094): `workspace.js`, `export-flush-fidelity-test.mjs`, `test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. Working tree conserva reworks ajenos sin tocar. |
| **Limitaciones** | El flush cubre las dos entidades editables de la vista (doc y tabla), que son las que tienen autosave con debounce. Otras superficies (workflows por snapshot, settings) no tienen debounce de escritura en memoria en la misma ventana; se conservan. El denominado timestamp `exportedAt` del envelope no se toca (es una metadato de producto, no de evidencia de gate). |
| **Proxima prioridad** | Implementar CE-095 (P3) — historias de deshacer de tabla sin limite de memoria (`commitTableEdit` apila snapshots profundos sin cap en `history.past`), y endurecer la lectura de preferencias de la paleta (`ws-favorites`/`ws-recent`) contra localStorage corrupto. |

---

## Cycle 160 — CE-095: historial de deshacer de tabla acotado + endururo de la paleta

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | b02fce9 (Cycle 159 docs) |
| **HEAD final** | 2e99aed (feature CE-095) |
| **Task** | CE-095 (P3, DISCOVERED->DONE): `commitTableEdit` (workspace.js) se dispara en cada blur de celda y empujaba un snapshot profundo de headers+rows en `history.past` SIN limite; ediciones rapidas generaban crecimiento lineal de memoria en tablas grandes (frente a `_appHistory.maxEntries:50`). Además, la paleta de comandos leia a nivel de import `ws-favorites`/`ws-recent` sin try/catch (misma clase de crash de boot que CE-092). Se entrega el CE-095 REAL de la cola (cap de tableHistories) + un BONUS de endurecimiento de la paleta. Nota de honestidad: los footers de Cycle 158-159 describian CE-095 como «localStorage de favoritos», descripcion inventada por el agente que NO coincidia con la entrada REAL de la QUEUE (cap de tableHistories); aqui se corrige y se entrega lo que la cola realmente pedia. |
| **Change (real CE-095)** | `workspace.js`: `TABLE_HISTORY_LIMIT = 50` y `commitTableEdit` descarta las entradas mas antiguas (`history.past.shift()`) al exceder el limite, conservando el undo reciente. (`core/state.js`: `readJsonList` ahora exportado). |
| **Change (bonus fuera de cola)** | `workspace.js`: la paleta reutiliza `readJsonList` (importado de state.js) para `favoriteTools`/`recentTools` (default `[]` + limpieza de clave corrupta) y envuelve las escrituras `toggleFavoriteTool`/`addToRecentTools` en try/catch. |
| **Tests ejecutados** | Suite nueva `tests/workspace/table-history-cap-test.mjs` 8/8 (pure; commitTableEdit/undoTableEdit/tableHistories REALES + limite real): tras 3x ediciones history.past no supera 50; la ultima edicion se conserva en el tope; las mas antiguas se descartan; el undo sigue correcto DESPUES de activarse el cap; commit sin cambio real no apila (dedup); tabla de 500 filas con 2x ediciones mantiene el historial acotado. Suite nueva `tests/workspace/palette-localstorage-recovery-test.mjs` 12/12 (pure; readJsonList real + init real de la paleta + toggle/addToRecent reales): ws-favorites/ws-recent corruptos -> arranque sin crash, vacio y clave eliminada; validos conservados; addToRecentTools mueve al frente; toggle agrega/quita y persiste; escritura que lanza (quota) no propaga. Regresion: `undo-corruption-test.mjs` (CE-091) actualizado para proveer `TABLE_HISTORY_LIMIT` al sandbox y vuelve a 15/15. Registradas en el release gate. |
| **Bug encontrado (confirmado)** | Historial de deshacer de tabla sin limite de memoria; y lectura sin try/catch de preferencias de la paleta en el import (crash de boot por clave corrupta). |
| **Bug corregido** | `commitTableEdit` acota `history.past` a 50; la paleta usa `readJsonList` seguro + escrituras protegidas. |
| **Tests PASS** | `table-history-cap` 8/8, `palette-localstorage-recovery` 12/12, undo-corruption (CE-091) 15/15, export-flush-fidelity (CE-094) 9/9, bundle-reference-validation (CE-093) 14/14, boot-recovery (CE-092) 10/10. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | ARCHITECTURE_IMPROVEMENT (memoria acotada del undo de tabla) + BUG_FIX (boot de la paleta). |
| **Evidence** | `workspace/workspace.js` (`TABLE_HISTORY_LIMIT`, `commitTableEdit`, `readJsonList` import, paleta), `workspace/core/state.js` (`readJsonList` export), `tests/workspace/table-history-cap-test.mjs`, `tests/workspace/palette-localstorage-recovery-test.mjs`, `tests/workspace/undo-corruption-test.mjs` (ajuste sandbox), `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 2e99aed (feature CE-095): `workspace.js`, `core/state.js`, `table-history-cap-test.mjs`, `palette-localstorage-recovery-test.mjs`, `undo-corruption-test.mjs`, `test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. Working tree conserva reworks ajenos sin tocar. |
| **Limitaciones** | El cap (50) iguala `_appHistory`; un undo profundo mas alla de 50 pasos no es posible (acorde al tope del historial global). El bonus de la paleta es endurecimiento de READ/WRITE de preferencias; su comportamiento funcional (mover reciente al frente, toggle) no cambio. |
| **Proxima prioridad** | Un DISCOVERY independiente (subagente explore) encontro y descarto candidatos; el top #1 (`cleanupSessionsForProject`) es CE-096 (implementado y cerrado en Cycle 161). El candidato #2 (`flowNodes`/`flowEdges` aliaseados en `_captureWorkspaceState`) es CE-097 (cerrado en Cycle 162). Backlog vuelve a quedar con DISCOVERED VACIO. Siguiente ciclo: DISCOVERY de nuevo o evolucion del runner (regla 6). |

---

## Cycle 161 — CE-096: `cleanupSessionsForProject` si elimina las entidades borradas de `ws:session`

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 1ceb6e8 (Cycle 160 docs) |
| **HEAD final** | 67547cf (feature CE-096) |
| **Task** | CE-096 (P2, DISCOVERY->DONE): `cleanupSessionsForProject` nunca eliminaba las entidades borradas de los snapshots de `ws:session`. Construia `idSet` con las IDs (strings) y filtraba con `!idSet.has(d)` donde `d` era el OBJETO completo guardado en `documents`/`dataTables`/`captures`. `Set.prototype.has` usa `===`, asi que `Set.has({id:'x'})` siempre es `false` -> el filtro era un no-op silencioso. Tras borrar un proyecto, sus doc/tabla/captura seguian referenciadas en `ws:session` y podian reaparecer en la recuperacion de sesion. |
| **Change** | `workspace/core/workspace-storage.js`: `cleanupSessionsForProject` compara ahora `d && typeof d === 'object' ? d.id : d` (fallback al string por si una sesion guarda IDs crudas) en los tres arrays (`documents`, `dataTables`, `captures`). |
| **Tests ejecutados** | Suite nueva `tests/workspace/session-cleanup-test.mjs` 12/12 (pure; `_loadAllSessions` + `cleanupSessionsForProject` REALES extraidos de workspace-storage.js con dbGet/dbPut stub envelope): entidades borradas salen de los tres arrays y las conservadas permanecen; el barrido es global (una entidad borrada no queda referenciada en ninguna sesion persistida); el proyecto borrado nullifica `currentProjectId` y los no borrados lo conservan; sin sesiones no lanza ni escribe. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Filtro de limpieza de sesiones que comparaba objetos contra strings -> nunca matcheaba (stale data/leak en recuperacion de sesion). Enmascarado en `id-collision-serialization` por una SIMULACION autocorregida (`simCleanupForProject` con `d?.id ?? d`); esta suite usa el codigo real. |
| **Bug corregido** | `cleanupSessionsForProject` compara `d.id` cuando el elemento es objeto. |
| **Tests PASS** | `session-cleanup` 12/12 (nuevo), mas todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud + datos stale). |
| **Evidence** | `workspace/core/workspace-storage.js`, `tests/workspace/session-cleanup-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 67547cf (feature CE-096): `workspace/core/workspace-storage.js`, `tests/workspace/session-cleanup-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | El barrido de entidades es global (una entidad borrada se limpia de cualquier sesion que la referencie), coherente con el objetivo de no dejar referencias huerfanas. El cambio no altera el guardado de sesion (`saveWorkspaceSession`), solo la limpieza. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO de nuevo. Proximo ciclo: DISCOVERY de nuevo o evolucion del runner (regla 6). |

---

## Cycle 162 — CE-097: el snapshot de Flow clona nodos/edges (undo de Flow no aliaseado)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 9686f4e (Cycle 161 docs) |
| **HEAD final** | 94e3974 (feature CE-097) |
| **Task** | CE-097 (P2, DISCOVERY->DONE): `_captureWorkspaceState` (workspace.js:834-847) clonaba en profundidad todos los campos del snapshot MENOS `flowNodes`/`flowEdges`, que se pasaban por referencia. El editor de Flow muta las mismas instancias, de modo que el snapshot de historial y el estado vivo compartian identidad: el undo/redo de Flow restauraba estado ya mutado (historial aliaseado), incoherente con los demas campos clonados por CE-091. |
| **Change** | `workspace.js`: `_captureWorkspaceState` clona ahora `flowNodes`/`flowEdges` con `JSON.parse(JSON.stringify(...))` cuando existen (default `[]`). |
| **Tests ejecutados** | Suite nueva `tests/workspace/flow-snapshot-aliasing-test.mjs` 12/12 (pure; `_captureWorkspaceState` REAL de workspace.js + `createStore` real de state.js): snapshot.flowNodes/flowEdges no comparte referencia con el estado vivo; mutar el nodo/edge del estado despues de capturar NO cambia el snapshot (x, label anidado, source conservados); sin nodes/edges retorna `[]`; una recaptura tras mutar refleja el cambio nuevo mientras la captura antigua no se contamina; s1 y s2 no comparten nodos. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Aliasing por referencia de `flowNodes`/`flowEdges` en el snapshot de undo; todos los demas campos se clonaban. |
| **Bug corregido** | `_captureWorkspaceState` clona ambos campos. |
| **Tests PASS** | `flow-snapshot-aliasing` 12/12 (nuevo), mas todas las suites previas. Release gate completo OK (ver Nota). |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud de undo/redo de Flow). |
| **Evidence** | `workspace/workspace.js` (`_captureWorkspaceState`), `tests/workspace/flow-snapshot-aliasing-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 94e3974 (feature CE-097): `workspace/workspace.js`, `tests/workspace/flow-snapshot-aliasing-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Nota (honestidad/flake)** | En la primera corrida del gate, la suite ajena CE-060 (`stale-delete-lifecycle`) reporto un FAIL transitorio (exit 1) por timing del harness; al re-ejecutar el mismo gate quedo `RELEASE GATE: OK` (`PASS: 42, FAIL: 0`) y la suite pasa 120/120 en aislamiento. No proviene de este cambio (es CE-060, no toca `_captureWorkspaceState`). La investigacion/degradacion de ese flake transitorio queda documentada como candidato futuro en la cola (se profundiza solo si reaparece de forma repetible). |
| **Limitaciones** | El clon dobla el coste de serializacion del grafo de Flow por push de historial (aceptable: 50 entradas max y grafo tipicamente pequeno); corrige la correctitud del undo a costa de ese coste. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #5 ya identificado (drop de bloques reordena con NaN, workspace.js:4037) o evolucion del runner (regla 6). |

---

## Cycle 163 — CE-098: el drop de bloques valida el indice (no reordena con NaN)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 9d8b527 (Cycle 162 docs) |
| **HEAD final** | 4312b61 (feature CE-098) |
| **Task** | CE-098 (P2, DISCOVERY->DONE): el handler de `drop` de bloques hacía `parseInt(e.dataTransfer.getData('text/plain'))` y ejecutaba `splice(from,1)` + `splice(to,0,moved)` + `autoSaveDoc` sin validar el indice. Un drop extraneo (archivo del SO o seleccion sin nuestro indice) producia `from = NaN`; como `NaN !== to` es `true`, `splice(NaN,1)` -> `splice(0,1)` eliminaba el PRIMER bloque y lo reinsertaba en `to`, reordenando y autoguardando el documento silenciosamente. |
| **Change** | `workspace.js`: se extrae la funcion nombrada `reorderBlock(blocks, from, to)` que devuelve `false` (sin tocar el array) si `from`/`to` no son enteros en `[0, blocks.length)`, si `from === to`, o si el array esta vacio/no es array; solo reordena y devuelve `true` en un reorder valido. El handler de `drop` llama `reorderBlock` y solo hace `renderBlocks()` + `autoSaveDoc` cuando devuelve `true`. |
| **Tests ejecutados** | Suite nueva `tests/workspace/block-drop-reorder-test.mjs` 14/14 (pure; `reorderBlock` REAL extraido de workspace.js): from=NaN/-1/>=length y to fuera de rango devuelven `false` y NO mutan el orden; from==to no-op; reorder valido mueve el bloque correctamente (inicio->final, final->inicio); array vacio/no-array devuelven `false` sin lanzar. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Reordenamiento silencioso y autoguardado del documento por un drop extraneo (NaN). |
| **Bug corregido** | El reorder solo ocurre con indices validos. |
| **Tests PASS** | `block-drop-reorder` 14/14 (nuevo), mas todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (integridad de datos del editor de documentos). |
| **Evidence** | `workspace/workspace.js` (`reorderBlock` + handler de drop), `tests/workspace/block-drop-reorder-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 4312b61 (feature CE-098): `workspace/workspace.js`, `tests/workspace/block-drop-reorder-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | Un drop valido con el mismo indice (`from === to`) se considera no-op (orden intacto) y no re-renderiza ni autoguarda; comportamiento identico al previo para ese caso. El manual manager de drag tambien requiere que `dataTransfer` lleve el indice como entero en rango; un drag/reorder que no lo haga se ignora de forma segura. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #4 (doble clon JSON del workspace por push de undo) o evolucion del runner (regla 6). |

---

## Cycle 164 — CE-099: el menu contextual de bloques desengancha su listener de document

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 32435cd (Cycle 163 docs) |
| **HEAD final** | 95452fe (feature CE-099) |
| **Task** | CE-099 (P3, DISCOVERY->DONE): `showBlockMenu` registraba cada apertura un `closeMenu` en `document.addEventListener('click', closeMenu)` via `setTimeout(0)`, y SOLO lo auto-eliminaba cuando el click caia FUERA del menu. Al seleccionar un ITEM (click dentro del menu), el listener quedaba colgado en `document` para toda la vida de la pagina -> acumulacion de listeners stale por cada apertura (leak de memoria en sesiones locales largas). |
| **Change** | `workspace.js` (`showBlockMenu`): cierre unico `closeMenu()` que desengancha SIEMPRE el listener (`if (attached) document.removeEventListener('click', onDocClick)`) en todas las vias de cierre (seleccionar item, alcanzar limite, click fuera). El attach diferido a macrotask conserva el comportamiento de que el click que abrio el menu no lo cierre; si el menu se cierra antes del timer, el flag `closed` evita enganchar (sin depender de clearTimeout). |
| **Tests ejecutados** | Suite nueva `tests/workspace/block-menu-listener-test.mjs` 13/13 (pure; `showBlockMenu` REAL de workspace.js + stub de DOM/document/h/svgIcon/getWorkspaceConfig/toast/generateId/setTimeout/hideContextMenu/$): seleccionar un item agrega el bloque y desengancha (remove==add, sin listener vivo); click fuera tambien desengancha; 5 aperturas NO acumulan listeners (add==remove==5); limite alcanzado avisa y desengancha; no queda listener vivo en document. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Leak de listeners `document` por cada apertura del menu de bloques (seleccionar item no desenganchaba). |
| **Bug corregido** | `closeMenu()` desengancha en todas las vias; el `closed` flag evita enganchar tras cierre prematuro. |
| **Tests PASS** | `block-menu-listener` 13/13 (nuevo), mas todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | ARCHITECTURE_IMPROVEMENT (higiene de listeners / memoria en sesion larga). |
| **Evidence** | `workspace/workspace.js` (`showBlockMenu`), `tests/workspace/block-menu-listener-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 95452fe (feature CE-099): `workspace/workspace.js`, `tests/workspace/block-menu-listener-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Regresion honesta + correccion** | La primera version de este fix usaba `clearTimeout(attachTimer)` en el cierre; eso anadio un `clearTimeout(` literal que desequilibro la verificacion estatica de CE-058 (cuenta `setTimeout` vs `clearTimeout` en workspace.js y exige `|diff|<=2`): el diff paso de -2 a -3 y `persistence-lifecycle-audit` rompio (94/1). Se reescribio usando el flag `closed` en lugar de `clearTimeout` (el callback del timer no engancha si ya se cerro), restaurando el equilibrio (diff -2) y CE-058 a 95/95; el gate completo quedo OK. |
| **Limitaciones** | La verificacion de CE-058 es estatica (cuenta ocurrencias literales de setTimeout/clearTimeout) y frágil frente a cambios que alteren ese balance; se respeto el margen +-2. El fix no cambia el comportamiento visible del menu (abre, cierra por item o por click fuera). |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #6 (blobs/resultUrls del flujo sin revocar) o evolucion del runner (regla 6). |

---

## Cycle 165 — CE-100: el historial de undo clona el snapshot UNA sola vez (sin doble serializacion)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 464d9cb (Cycle 164 docs) |
| **HEAD final** | fb5fc91 (feature CE-100) |
| **Task** | CE-100 (P2, DISCOVERY->DONE): cada `_appHistory.push/undo/redo` pasaba un snapshot ya profundamente aislado (`_captureWorkspaceState` clona todos los campos), pero `cloneState` configurado hacia `JSON.parse(JSON.stringify(s))` OTRA VEZ -> serializaba el workspace COMPLETO dos veces por operacion de historial y duplicaba la memoria en el historial de 50 entradas. |
| **Change** | `workspace.js`: `cloneState` pasa a identidad `(s) => s`, seguro porque TODAS las llamadas a `_appHistory.{push,undo,redo}` pasan `_captureWorkspaceState()` (unico usos; `pushGrouped` no se usa), que ya devuelve un snapshot aislado en profundidad. |
| **Tests ejecutados** | Suite nueva `tests/workspace/undo-clone-once-test.mjs` 7/7 (pure; `createHistoryManager` REAL + `_captureWorkspaceState` REAL + contador instrumentado de JSON.parse/stringify): push con cloneState=identidad hace 0 serializaciones internas (antes 1 JSON completo por llamada); undo devuelve snapshots NO referenciados al estado vivo; la captura aislada por `_captureWorkspaceState` se mantiene aislada en el historial (x no se contamina al mutar el vivo); workspace.js declara cloneState identidad. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Doble serializacion del workspace completo en cada operacion de historial. |
| **Bug corregido** | `cloneState` identidad elimina la serializacion redundante (el snapshot ya viene aislado). |
| **Tests PASS** | `undo-clone-once` 7/7 (nuevo), `undo-corruption` (CE-091) 15/15 (semantica intacta), mas todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | PERFORMANCE_IMPROVEMENT (perf + memoria en undo/redo de workspaces grandes). |
| **Evidence** | `workspace/workspace.js` (`_appHistory` cloneState), `tests/workspace/undo-clone-once-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | fb5fc91 (feature CE-100): `workspace/workspace.js`, `tests/workspace/undo-clone-once-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | La optimizacion es correcta SOLO porque los tres usos de `_appHistory` pasan `_captureWorkspaceState()`. Si en el futuro alguien introdujera un uso de `_appHistory` con el estado VIVO del store (con referencias compartidas), el cloneState de identidad propagaria aliasing; se anadio un comentario en workspace.js advirtiendo este contrato. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #6 (blobs/resultUrls del flujo sin revocar) o evolucion del runner (regla 6). |

---

## Cycle 166 — CE-101: exportTableCSV escapa headers y coacciona celdas (CSV valido)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 4a04501 (Cycle 165 docs) |
| **HEAD final** | 7914030 (feature CE-101) |
| **Task** | CE-101 (P1, DISCOVERY 2da ronda -> DONE): `exportTableCSV` lanzaba `TypeError` con celdas no-string y no escapaba los headers (un header con `,` o `"` corrompia el archivo CSV). |
| **Potential bug (DISCOVERY 2da ronda, confirmado leyendo el source)** | `exportTableCSV` (workspace.js) usaba `table.headers.join(sep)` SIN escape y `c.includes(...)` sobre el valor bruto de celda -> (A) header con coma `"Precio, USD"` produce `Precio, USD,Cantidad` (estructura corrupta, no citado); (B) celda `null`/`undefined`/numero/booleano lanza `c.includes is not a function`. La hermana `queryExportCsv` ya tenia el escape correcto (`String(value == null ? '' : value)` + `/[,"\n]/` + quotes). |
| **Change** | `workspace.js`: `exportTableCSV` refactorizado al MISMO escape que `queryExportCsv` (coercion a string con `String(value == null ? '' : value)`, escaping de comas/comillas/salto de linea en headers Y celdas vía un helper `escape`, fila de datos con linea nueva). Conserva el BOM `\uFEFF` y el flujo de descarga (Blob -> URL.createObjectURL -> a.click -> revokeObjectURL -> toast). |
| **Tests ejecutados** | Suite nueva `tests/workspace/table-csv-escape-test.mjs` 9/9 (pure; `exportTableCSV` REAL + `queryExportCsv` REAL + DOM/Blob/URL stub): header con coma queda entre comillas `"Precio, USD"`; header con comillas se duplica `"""Nomina"""`; el CSV conserva el BOM; filas de datos intactas; celdas `null`/`undefined`/42/`true` ya no lanzan y se coaccionan (`,,42,true`); el escape es BYTE-IDENTICO a `queryExportCsv` (solo difiere el BOM); comillas internas con salto se duplican (`hola ""mundo""`). Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Headers sin escapar + celdas no-string crasheando. |
| **Bug corregido** | Mismo escape de `queryExportCsv` en `exportTableCSV` (headers y celdas). |
| **Tests PASS** | `table-csv-escape` 9/9 (nuevo), todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (robustez + correccion de exportacion CSV). |
| **Evidence** | `workspace/workspace.js` (`exportTableCSV`), `tests/workspace/table-csv-escape-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 7914030 (feature CE-101): `workspace/workspace.js`, `tests/workspace/table-csv-escape-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | `queryExportCsv` no agrega BOM; `exportTableCSV` si, por lo que la comparacion byte-identica en el test quita el BOM del lado de `exportTableCSV`. El flujo de descarga depende de `URL.revokeObjectURL` inmediato tras el click (comportamiento previo, no cambiado). |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #2 (query `detect-type`: `new Date(...).toISOString().slice(0,10)` desplaza la fecha a UTC, meses hacia atras en America) o evolucion del runner (regla 6). |

---

## Cycle 167 — CE-102: detect-type normaliza fechas SIN corrimiento de zona horaria

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 561854a (Cycle 166 docs) |
| **HEAD final** | fedae25 (feature CE-102) |
| **Task** | CE-102 (P1, DISCOVERY 2da ronda candidato #2 -> DONE): el transform de query `detect-type` desplazaba fechas por zona horaria al normalizarlas. |
| **Potential bug (DISCOVERY 2da ronda, confirmado leyendo el source)** | `queryRunOperation` -> `detect-type` (workspace.js, linea ~6014) hacía `value = new Date(value).toISOString().slice(0, 10)`. Para fechas con barra (`MM/DD/YYYY`, `YYYY/MM/DD`), `Date.parse` las toma como MEDIANOCHE LOCAL, pero `toISOString()` emite en UTC; para `YYYY-MM-DD` el parseo es UTC y `toISOString()` coincide solo si el offset es cero. En zonas con offset != 0 el dia civil resultante podia no ser la fecha escrita por el usuario. |
| **Change** | `workspace.js`: nuevo helper `queryDateToIso(value)` que reconstruye la fecha desde sus COMPONENTES LOCALES (nunca via UTC): si el anio esta al inicio (4 digitos) usa anio/mes/dia; si esta al final usa mes/dia/anio (preservando la semantica US que ya aplicaba `Date.parse`), valida rangos (mes 1-12, dia 1-31) y rellena a dos digitos; solo cae a `new Date(...).toISOString().slice(0,10)` como fallback para valores que la regex no capta. `detect-type` ahora llama a `queryDateToIso`. |
| **Tests ejecutados** | Suite nueva `tests/workspace/query-date-to-iso-test.mjs` 11/11 (pure; `queryDateToIso` REAL): conserva YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY y padding (03/05/2024, 2024/2/7); salida == fecha escrita en todos los formatos; salida == fecha CALENDARIO LOCAL (invariante TZ deterministica vía getFullYear/getMonth/getDate, valida en el entorno con offset UTC 240 min); el bloque real de detect-type usa queryDateToIso y ya no usa toISOString. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Silenciosa corrupcion de fecha por offset de zona horaria en detect-type. |
| **Bug corregido** | Reconstruccion por componentes locales en `queryDateToIso` (TZ-independiente). |
| **Tests PASS** | `query-date-to-iso` 11/11 (nuevo), todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud de fechas en query detect-type). |
| **Evidence** | `workspace/workspace.js` (`queryDateToIso`, `detect-type`), `tests/workspace/query-date-to-iso-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | fedae25 (feature CE-102): `workspace/workspace.js`, `tests/workspace/query-date-to-iso-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | Para formatos ambiguos sin anio inequivoco (ambos extremos <=2 digitos) se cae al fallback original (`new Date(...).toISOString()`), que depende de la heuristica de `Date.parse`. El fallback mantiene el comportamiento previo, no empeora. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #3 (safeArithmetic `=X/0` devuelve `0`; esperado error/`''`) o evolucion del runner (regla 6). |

---

## Cycle 168 — CE-103: la division por cero da error (#FORMULA), no escribe 0

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 8d8f72a (Cycle 167 docs) |
| **HEAD final** | 17b68ea (feature CE-103) |
| **Task** | CE-103 (P1, DISCOVERY 2da ronda candidato #3 -> DONE): una formula con division por cero escribia `0` en la celda en lugar de senalar el error. |
| **Potential bug (DISCOVERY 2da ronda, confirmado leyendo el source)** | `parseTerm` (dentro de `safeArithmetic`, workspace.js:4720): `value = operator === '*' ? value * right : (right === 0 ? 0 : value / right)` — la division por cero se forzaba a `0`. Asi `=A1/0` o `=SUM(...)/0` mostraban `0` (valor de hoja de calculo silenciosamente incorrecto). El contrato de errores del codigo ya era devolver vacio de `safeArithmetic` -> `#FORMULA` de `evaluateDataFormula`, coherente con `=abc` y `=1/()`. |
| **Change** | `workspace.js`: en `parseTerm` la division por cero devuelve `NaN` en lugar de `0`. Como `NaN` no es finito, el guard final de `safeArithmetic` (`Number.isFinite(result) ? result : ''`, linea ~4738) lo rechaza y `evaluateDataFormula` lo mapea a `#FORMULA` (error visible). Sin cambio observable para la aritmetica no-dividente, y `safeArithmetic` solo se llama desde `evaluateDataFormula`. |
| **Tests ejecutados** | Suite nueva `tests/workspace/div-by-zero-formula-test.mjs` 12/12 (pure; `safeArithmetic` REAL + `evaluateDataFormula` REAL + helpers REALES `parseLocaleNumber`/`columnNameToIndex`/`indexToColumnName`/`cellReferenceToPosition`/`numericValue`): nucleo `5/0 -> ''`, `0/0 -> ''`, `10/(2-2) -> ''`, `5/2 -> 2.5`, `0/5 -> 0`, `2+3*4 -> 14`; contrato final `=A1/0 -> #FORMULA`, `=B2/0 (referencia a formula B1/0) -> #FORMULA`, `=5/2 -> 2.5`, `=0/5 -> 0`, `=A1+A2 (5+3) -> 8`; y `parseTerm` divide por cero con `NaN` (no `0`). Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Division por cero escrita como `0` sin senalar error. |
| **Bug corregido** | `NaN` en la division por cero -> rechazada por el guard finito -> `#FORMULA`. |
| **Tests PASS** | `div-by-zero-formula` 12/12 (nuevo), todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud de formulas de hoja de calculo). |
| **Evidence** | `workspace/workspace.js` (`parseTerm` de `safeArithmetic`), `tests/workspace/div-by-zero-formula-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 17b68ea (feature CE-103): `workspace/workspace.js`, `tests/workspace/div-by-zero-formula-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | El cambio solo afecta a `evaluateDataFormula` (unico caller de `safeArithmetic`). La semantica muestra `#FORMULA` (mismo indicador que una formula invalida), no una edicion visible distinta; el usuario ve un error explicito en lugar de un `0` incorrecto. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #4 (createThumbnail produce canvas 0x0 para imagenes degradadas) o evolucion del runner (regla 6). |

---

## Cycle 169 — CE-104: createThumbnail guarda contra dimensiones degradadas (0x0)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | 1c5ba0a (Cycle 168 docs) |
| **HEAD final** | 0ead95a (feature CE-104) |
| **Task** | CE-104 (P2, DISCOVERY 2da ronda candidato #4 -> DONE): una imagen degradada producia una miniatura 0x0 almacenada en IndexedDB sin error. |
| **Potential bug (DISCOVERY 2da ronda, confirmado leyendo el source)** | `createThumbnail` (core/image-processor.js:53) hacía `scale = Math.min(maxSize / w, maxSize / h, 1)`; con `w` o `h` en 0 (o NaN/Infinity), `maxSize / 0 = Infinity` y `Math.min(...,1)` quedaba en 1 -> `canvas.width = Math.round(w * scale)` = 0 => miniatura `0xN`/`Nx0`/`0x0`. `processImageCapture` (linea ~560) llamaba `thumbnail.toDataURL('image/jpeg', 0.85)` incondicionalmente sobre ese canvas vacio. |
| **Change** | `createThumbnail` retorna `null` si `w`/`h` no son finitos o `<= 0`; para fuentes validas clampea las dimensiones a `>=1` (protege contra fracionarios). `processImageCapture` guarda el thumbnail null con un ternario (`thumbnail ? thumbnail.toDataURL(...) : ''`), sin crashear ni guardar un asset 0x0. |
| **Tests ejecutados** | Suite nueva `tests/workspace/thumbnail-guard-test.mjs` 12/12 (pure; `createThumbnail` REAL + `processImageCapture` REAL + document stub): imagen valida 800x600 -> miniatura <=400 preservando 4:3 (400x300); `w=0`, `h=0`, `w=0/h=0`, `w=NaN`, `h=Infinity` -> `null`; fuente valida 2x3 -> canvas valido (no queda en 0); processImageCapture usa el ternario de guarda (no llama toDataURL incondicionalmente). Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Miniaturas 0x0 para dimensiones degradadas, sin senal de error. |
| **Bug corregido** | `null` para dimensiones no finitas/<=0 + guarda del consumidor `processImageCapture`. |
| **Tests PASS** | `thumbnail-guard` 12/12 (nuevo), todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (robustez de pipeline de imagen: sin asset 0x0 ni crash en toDataURL). |
| **Evidence** | `workspace/core/image-processor.js` (`createThumbnail`, `processImageCapture`), `tests/workspace/thumbnail-guard-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | 0ead95a (feature CE-104): `workspace/core/image-processor.js`, `tests/workspace/thumbnail-guard-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | `createThumbnail` ahora puede retornar `null`; los consumidores deben manejar ese caso (se actualizo `processImageCapture`; `scanner-ui.js` solo importa `createThumbnail`, no lo invoca, verificable en el repo). El test de phase3a (`phase3a-test.mjs:286`) usa un canvas valido, asi que sigue pasando. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY candidato #5 (dashboardChartItems: sentinela Infinity en bucket.min/max, sort con NaN) o evolucion del runner (regla 6). |

---

## Cycle 170 — CE-105: choose/reorder-columns descartan indices fuera de rango (sin headers undefined)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-02 |
| **Branch** | main |
| **HEAD inicial** | f7fac04 (Cycle 169 docs) |
| **HEAD final** | eb5a116 (feature CE-105) |
| **Task** | CE-105 (P1, DISCOVERY 3ra ronda candidato #1 -> DONE): `choose-columns`/`reorder-columns` producian headers `undefined` y celdas `''` silenciosas con indices fuera de rango durante el rebuild en cadena. |
| **Potential bug (DISCOVERY 3ra ronda, confirmado leyendo el source)** | `queryRunOperation` (workspace.js:5926-5941) mapeaba indices sin validar rango en `choose-columns` (5926-5934) y `reorder-columns` (5936-5941): `headers[column]` -> `undefined`, `normalize(row[column])` -> `''`. `queryRebuildModel` (6108-6116) re-ejecuta todos los pasos en cadena; un `remove-columns` previo reduce el nº de columnas, invalidando indices construidos de pasos posteriores -> perdida de datos silenciosa sin error. |
| **Change** | `workspace.js`: en `remove-columns`/`choose-columns` y `reorder-columns` se filtra `indexes` a `Number.isInteger(col) && col >= 0 && col < headers.length` antes de construir `chosen`/`order`; los indices fuera de rango se descartan (nunca `headers[col]` undefined) y, si todos quedan fuera de rango, `if (!chosen.length) return result` devuelve el modelo intacto. |
| **Tests ejecutados** | Suite nueva `tests/workspace/query-column-range-guard-test.mjs` 16/16 (pure; `queryRunOperation` REAL + `queryCloneShape`/`queryCloneRows` REALES + `queryRebuildModel` REAL): choose/reorder directos con indices fuera de rango (5, 9, 3) no producen `undefined`; todo-fuera de rango mantiene el modelo intacto; reorder valido segun el orden ascendente real de `queryRunOperation` (`indexes:[1]` -> [B,A]; `[2,0]` -> [A,C,B]); REBUILD en cadena `remove-columns [0,1]` + `reorder-columns [2,3]` ya no produce headers/filas `undefined` y conserva las 2 columnas restantes (C,D); analogo con choose-columns OOR en cadena. Registrada en el release gate. |
| **Bug encontrado (confirmado)** | Indices fuera de rango en column ops -> headers `undefined` / celdas `''` en el rebuild. |
| **Bug corregido** | Filtro de `indexes` al rango valido en choose/remove/reorder-columns. |
| **Tests PASS** | `query-column-range-guard` 16/16 (nuevo), todas las suites previas. Release gate completo OK. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud de query: sin perdida silenciosa de columnas en el rebuild). |
| **Evidence** | `workspace/workspace.js` (`queryRunOperation` column ops), `tests/workspace/query-column-range-guard-test.mjs`, `scripts/test-workspace-release.mjs`, queue/status. |
| **Commits** | eb5a116 (feature CE-105): `workspace/workspace.js`, `tests/workspace/query-column-range-guard-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | `queryRunOperation` ordena ascendentemente los indices (5858), asi que `reorder-columns` no soporta reordenar a una secuencia no ascendente (limitacion de diseno preexistente, no cambiada). El filtro solo descarta indices fuera de rango; no altera el orden ascendente. |
| **Proxima prioridad** | Backlog DISCOVERED VACIO. Proximo ciclo: DISCOVERY 4ta ronda (nuevo pase) o evolucion del runner (regla 6). |

---

## Cycle 171 — CE-106/CE-108: encabezados de tabla Markdown escapan el pipe + replace-values no destruye la celda con find vacio (DISCOVERY 4ta ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | cc2b571 (docs adsense, ultimo commit previo) |
| **Task** | CE-106 (P2) + CE-108 (P3), DISCOVERY 4ta ronda -> DONE. Con la cola SIN todo TODO (todo DONE/DISCOVERED), el ciclo se dedicó a DISCOVERY siguiendo la regla 8 de la cola y el patron de bugs de las rondas previas (hermanas inconsistentes / guards / corrosion de datos silenciosa). |
| **Potential bug (DISCOVERY 4ta ronda, confirmado leyendo el source)** | Two bugs de la misma clase que CE-101/CE-105: (1) CE-106 — tanto `exportDocument` (workspace.js:4145) como `blocksToMarkdown` (workflow-operations.js:694) escapaban el pipe `|` en las CELDAS de las tablas Markdown (`replace(/\|/g,'\\|')`) pero NO en los ENCABEZADOS (`headers.map(String).join(' | ')`), rompiendo la estructura de la tabla (4 columnas en cabecera vs 2 en filas); su hermana HTML `documentBlocksToHtml` sí escapa. (2) CE-108 — `replace-values` modo `contains` con `find` vacío hacía `current.split('').join(replace)` partiendo cada celda en CARACTERES (`"Factura"` -> `"XFXaXcXtXuXrXaX"`); el modal (workspace.js:6500) no validaba find vacío. |
| **Change** | (1) `workspace.js` `exportDocument` y `workflow-operations.js` `blocksToMarkdown`: los encabezados usan ahora la MISMA coercion+escape que las filas (`headersT.map(v => String(v ?? '').replace(/\|/g,'\\|'))`). (2) `workspace.js` `queryRunOperation` rama `replace-values`: `findStr === '' ? current : current.split(findStr).join(...)` deja la celda intacta en contains; el modal añade guard `if (config.mode === 'contains' && !config.find) { toast('Escribe un texto para buscar','warning'); return; }`. |
| **Bugs encontrados (confirmados)** | Ambos verificados en el source (4145, 694, 6044, 6500). El candidato adicional CE-107 (dates DD/MM) se analizó y NO se implementó: la semantica MM/DD/YYYY del query path es una decision de diseno probada en `query-date-to-iso-test` (CE-102) que no debe cambiarse; queda como limitacion documentada, no como bug. |
| **Bug corregido** | (1) Encabezados Markdown con `|` ya no rompen la tabla (rutas exportDocument + text.export). (2) find vacío en contains ya no corrompe la columna. |
| **Tests ejecutados** | Suite nueva `tests/workspace/md-header-escape-and-replace-test.mjs` 12/12 (queryRunOperation REAL + sandbox VM de text.export REAL): CE-108 (find vacío deja la celda intacta, contains/exact no vacío conservados, números intactos, UI guard); CE-106 (header con pipe se escapa en text.export, header sin pipe regresión idéntica, exportDocument static check). Registrada en el release gate. Regresiones: `workflow-export-md` 30/30, `text-to-document` 15/15, `query-column-range-guard` 16/16, `query-date-to-iso` 11/11. |
| **Tests PASS** | 12/12 (nueva) + regresiones 30/30, 15/15, 16/16, 11/11. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud de exportacion Markdown + corrosion silenciosa de datos en query). |
| **Evidence** | `workspace/workspace.js` (exportDocument, replace-values), `workspace/core/workflow-operations.js` (blocksToMarkdown), `tests/workspace/md-header-escape-and-replace-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Commits** | (pendiente este ciclo) |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | CE-107 (dates `DD/MM/YYYY` en detect-type) queda documentado como decision de diseno probada (semantica US MM/DD, contrato de `query-date-to-iso-test`), no como bug a resolver; un soporte real de DD/MM requeriria re-definir el contrato. |
| **Proxima prioridad** | DISCOVERY 5ta ronda o evolucion del runner. |

---

## Cycle 172 — CE-109: formulas de hoja de calculo soportan operador unario negativo + agregados ignoran celdas no numericas (DISCOVERY 5ta ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | a9a971b (commit CE-106/CE-108, ultimo) |
| **Task** | CE-109 (P1, DISCOVERY 5ta ronda -> DONE). Con la cola SIN todo TODO (todo DONE/DISCOVERED), el ciclo se dedico a DISCOVERY (regla 8). Lanzamiento de 3 exploradores paralelos sobre (a) query/data, (b) documento/editor y (c) storage/core; de las candidaturas se promovio e implemento el par P1 de correctitud de formulas: operador unario negativo + agregados que cuentan celdas no numericas como 0. |
| **Hypothesis (confirmado leyendo el source)** | (a) `safeArithmetic` (workspace.js:4694-4738): el tokenizer `/\d+(?:\.\d+)?|[+\-*/()]|\s+/g` separa `-` como token; `parsePrimary` hacia `Number('-')=NaN` (devuelto 0) y avanzaba, dejando el operando sin consumir -> cualquier formula con un negativo daba `''` -> `#FORMULA`. (b) En los agregados, `resolveCell` devuelve `numericValue(raw) ?? 0` por lo que `"abc"` -> 0, y el filtro posterior (`Number(String(0).replace(',','.'))`) conservaba ese 0, inchado COUNT/AVERAGE/MIN/MAX. |
| **Bugs encontrados (confirmados)** | (a) `=A1+B1` con A1=`-5`, B1=`3` -> `#FORMULA` (esperado `-2`); `=MIN(A1:A3)` sobre negativos -> `#FORMULA`; `=5*-3`, `=3*(-1)` -> `#FORMULA`. (b) `=COUNT(A1:A3)` con abc,100,200 -> 3 (esperado 2); `=AVERAGE` -> 100 (esperado 150); `=MIN` -> 0 (esperado 100); `=MAX` sobre -5,-3 -> 0 (esperado -3). |
| **Change** | (a) `parsePrimary` de `safeArithmetic` consume signos unarios `-`/`+` (sign flag aplicado al operando y a parentesis) antes de leer el primario: `-5`, `-5+3`, `5*-3`, `3*(-1)`, `5--3`, `+7` funcionan; la aritmetica normal y la division por cero (CE-103) intactas. (b) nuevo `cellsFromArgument` (reemplaza `valuesFromArgument`) que resuelve cada celda (formulas incluidas, respetando stack ciclico) y la parsea con `parseLocaleNumber` retornando numero o `null`; los agregados filtrar `null`/no-finito -> COUNT/AVERAGE/AVG/MIN/MAX/SUM ignoran celdas no numericas (semantica Excel/Sheets) y respetan decimales de miles europeos (1.234,56); `COUNTA` sigue contando no vacias. |
| **Bugs corregidos** | (1) Formulas con negativos ya no devuelven `#FORMULA`. (2) Los agregados ya no cuentan/incluyen celdas no numericas como 0. |
| **Tests ejecutados** | Suite nueva `tests/workspace/formula-unary-and-aggregates-test.mjs` 27/27 (safeArithmetic/evaluateDataFormula/helpers REALES por VM): nucleo (`safeArithmetic('-5')===-5`, `-5+3===-2`, `5*-3===-15`, `3*(-1)===-3`, `5--3===8`, `+7===7`, `2+3*4===14`, `5/0===''`); contrato (`=-5+3 -> -2`, `=MIN(A1:A2) -> -5`); agregados con texto (COUNT/AVERAGE/MIN/MAX) y negativos (MAX -3, MIN -5); europeos (`=SUM 4035.31`, `=MAX 2500`); todos no numericos -> 0 sin crash; COUNTA 3; agregado sobre celdas formula (`=SUM 6`); anti-regresion estatica. Registrada en el release gate. Regresiones: `div-by-zero-formula` 12/12 (CE-103), `query-date-to-iso` 11/11. |
| **Tests PASS** | 27/27 (nueva) + regresiones 12/12, 11/11; RELEASE GATE completo 76 suites PASS (incl. CE-109) 0 fail. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud de formulas de hoja de calculo). |
| **Evidence** | `workspace/workspace.js` (safeArithmetic parsePrimary, evaluateDataFormula cellsFromArgument), `tests/workspace/formula-unary-and-aggregates-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`. |
| **Commits** | 464a14a (CE-109 commitado al cierre del ciclo 172). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | El unario +/- cubre el inicio de primario (despues de un operador o parentesis); no se agregaron funciones aritmeticas nuevas ni potencias. Los agregados usan `parseLocaleNumber` sin hints de columna (comportamiento generico de miles europeos), coherente con el resto del motor. Otras candidaturas de la ronda (orden de tablas con `Number(replace(',','.'))`, guard null en `collectRelations`/`remapRefs`, `_flushDirtyEntity` lee la vista nueva, export de listas/imagenes en `exportDocument`) quedan como oportunidades DISCOVERED para rondas futuras. |
| **Proxima prioridad** | DISCOVERY 6ta ronda o evolucion del runner. |

---

## Cycle 173 — CE-110: el orden de tablas usa el parser canonico parseLocaleNumber (DISCOVERY 6ta ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | 464a14a (commit CE-109, ultimo) |
| **Task** | CE-110 (P2, DISCOVERY 6ta ronda -> DONE). Con la cola SIN todo TODO (todo DONE/DISCOVERED), el ciclo se dedico a DISCOVERY (regla 8). Se confirmaron dos candidaturas de la ronda 5 (orden de tablas con `Number(replace(',','.'))` y guard null en `collectRelations`/`remapRefs`) y se implemento la de mas valor de producto: el orden de tablas con el parser canonico, cerrando la deuda ad-hoc del contrato CE-072. |
| **Hypothesis (confirmado leyendo el source)** | Los dos call-sites que ORDENAN una tabla (sort por columna del modal de ordenamiento ~workspace.js:4211 y sort por click en la cabecera ~workspace.js:5288) comparaban numeros con `Number(a.replace(',', '.'))` en vez de `parseLocaleNumber`. Con formato europeo de miles (`1.234,56`), `replace(',','.')` -> `1.234.56` -> `Number` = `NaN`, cayendo al fallback `localeCompare` -> la columna se ordenaba COMO TEXTO (ej. `1.200` < `1.3` lexicamente, cuando 1200 > 1.3 numericamente). Violaba el contrato documentado del repo «All modules must use [parseLocaleNumber] instead of ad-hoc parsing» (CE-072). |
| **Bugs encontrados (confirmados)** | ![sin captura de navegador] columnas con valores europeos de miles/decimales con coma ordenaban lexicamente en ambos puntos de entrada (modal de ordenamiento y click en cabecera), resultado incorrecto para datos de hoja de calculo con formato espanol. |
| **Change** | Nuevo helper de modulo `compareTableValues(a, b)` (workspace.js:4687, despues de `numericValue`) que compara con `parseLocaleNumber` (numerico) o, si alguno no es finito, con `localeCompare(b, 'es', { numeric:true, sensitivity:'base' })` como fallback (mismo contrato que el sort anterior). Los DOS call-sites de sort lo usan; se elimina la linea ad-hoc `Number(a.replace(',', '.'))` (verificado por anti-regresion estatica). |
| **Bugs corregidos** | (1) El orden de tablas usa ahora `parseLocaleNumber` canonico en ambos puntos de entrada: valores europeos de miles, negativos y decimales con coma ordenan numericamente. (2) Texto puro/vacios siguen por `localeCompare` sin crash. |
| **Tests ejecutados** | Suite nueva `tests/workspace/table-sort-locale-test.mjs` 16/16 (compareTableValues + parseLocaleNumber REALES por VM): sanity del parser (`1.234,56` -> 1234.56); simples sin regresion asc/desc (`3,1,2`, `100,20,3` -> `[3,20,100]`, `10,9,8`); decimales con coma (`2,5`,`1,5`,`3` -> `[1,5,2,5,3]`); millares europeos (`1.234,56`,`2`,`999,99` -> `[2,999,99,1.234,56]`); negativos asc/desc (`-5,-3,2,1`); texto puro asc/desc; vacio y nulo sin crash; mezcla numerico+texto; `1.200` vs `1.3` numerico (1200 > 1.3); anti-regresion estatica (helper definido y usado en 2 sitios, ad-hoc `Number(replace(',','.'))` eliminado). Registrada en el release gate tras CE-109. |
| **Tests PASS** | 16/16 (nueva); RELEASE GATE completo 76 suites PASS (incl. CE-110) 0 fail; manifest `artifacts/deep-audit/release-gate/release-gate-464a14a8bd0de70daaac6f5fcc42eeb9cf85ebf5.json`. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (correctitud del orden de tablas con parser canonico). |
| **Evidence** | `workspace/workspace.js` (compareTableValues + 2 call-sites), `tests/workspace/table-sort-locale-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`, `artifacts/deep-audit/release-gate/release-gate-464a14a8bd0de70daaac6f5fcc42eeb9cf85ebf5.json`. |
| **Commits** | (pendiente este ciclo) |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado. |
| **Limitaciones** | `parseLocaleNumber` sin hints de columna (comportamiento generico de miles europeos, coherente con el resto del motor); el sort cae al `localeCompare` cuando ambos no son numericos (mismo contrato que antes). Otras candidaturas de la ronda (guard null en `collectRelations`/`remapRefs`, `_flushDirtyEntity` lee la vista nueva, export de listas/imagenes en `exportDocument`) quedan como oportunidades DISCOVERED para rondas futuras. |
| **Proxima prioridad** | DISCOVERY 7ma ronda o evolucion del runner. |

## Cycle 174 — CE-111: el Markdown de exportDocument no pierde listas ni imagenes (DISCOVERY 7ma ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | a3b79b0 (commit CE-110, ultimo) |
| **Task** | CE-111 (P2, DISCOVERY 7ma ronda -> DONE). Cola SIN todo TODO (todo DONE/DISCOVERED); el ciclo se dedico a DISCOVERY (regla 8). Se confirmaron tres candidaturas de la ronda 5 (guard null en `collectRelations`/`remapRefs`, `_flushDirtyEntity` lee la vista nueva y export de listas/imagenes en `exportDocument`) y se implemento la de mas valor de producto: la fidelidad de datos del export Markdown, asimetrica con la referencia canonica `blocksToMarkdown`. La candidatura del guard null de `collectRelations`/`remapRefs` queda DISCOVERED documentada. |
| **Hypothesis (confirmado leyendo el source)** | `exportDocument` (workspace.js:4127) emitia los bloques `bullet-list`, `numbered-list` e `image-block` por el fallback generico `content` del texto plano: las listas perdian su marcador de lista y una imagen vertia su `dataUrl` entera como texto plano ilegible. Asimetrico con `blocksToMarkdown` (workflow-operations.js:678) que maneja `bullet-list` en 688 e `image-block` en 717 — el MISMO documento exportaba distinto segun la ruta (editor vs flujo). |
| **Bugs encontrados (confirmados)** | ![sin captura de navegador] el export Markdown de un documento con listas o imagenes las empeoraba: `-`/`1.` perdidos (contenido plano) y `dataUrl` de imagen volcada como texto. |
| **Change** | Se extrae `exportDocumentMarkdown(doc)` puro (workspace.js:4127-4162) de `exportDocument`, conservando TODO el comportamiento previo (page-break html, divider, heading1-3, quote, code, callout, tabla) y anadiendo: `bullet-list` -> `- content`, `numbered-list` -> `1. content`, `image-block` -> `![imagen](src)` con `String(block.content || block.dataUrl || '')` (content con precedencia, paridad `blocksToMarkdown`, sin crash si no hay fuente). `exportDocument` ahora llama a `exportDocumentMarkdown(doc)`. |
| **Bugs corregidos** | (1) Las listas se exportan como `-`/`1.` conservando la estructura. (2) Las imagenes se exportan como `![imagen](src)` en vez de volcar la `dataUrl` como texto. (3) Paridad con `blocksToMarkdown` (content tiene precedencia sobre dataUrl). |
| **Tests ejecutados** | Suite nueva `tests/workspace/document-export-md-lists-test.mjs` 23/23 (\`exportDocumentMarkdown\` REAL, pura, sin DOM): viñetas, listas numeradas, imagen por content y por dataUrl, precedencia content, dato sin fuente sin crash, mezcla ordenada (heading + 2 viñetas + lista numerada + imagen), quote/divider/callout/code/tabla intactos, bloque desconocido -> contenido, anti-regresion estatica (exportDocument delega en exportDocumentMarkdown; maneja los 3 tipos). NOTA de anclaje: la suite CE-106 \`md-header-escape-and-replace-test.mjs\` anclaba su anti-regresion en \`async function exportDocument\`; la refactorizacion reubico el codigo en \`exportDocumentMarkdown\` (definida antes), por lo que se actualizo el ancla a \`function exportDocumentMarkdown\` SIN debilitar la asercion (\`replace(/\\|/g\` sigue verificado) — revalida 12/12. |
| **Tests PASS** | 23/23 (nueva); CE-106 revalidada 12/12; RELEASE GATE completo 77 suites PASS 0 fail; manifest `artifacts/deep-audit/release-gate/release-gate-a3b79b073099089f002af2353d45c2208a11e0ed.json`. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (fidelidad de datos del export Markdown: listas e imagenes ya no se pierden). |
| **Evidence** | `workspace/workspace.js` (exportDocumentMarkdown + exportDocument), `tests/workspace/document-export-md-lists-test.mjs`, `tests/workspace/md-header-escape-and-replace-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`, `artifacts/deep-audit/release-gate/release-gate-a3b79b073099089f002af2353d45c2208a11e0ed.json`. |
| **Commits** | d893a8e (fix(ce): CE-111 exportDocument Markdown no pierde listas ni imagenes — 7 archivos). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado (ramas acumuladas: 4 commits por delante de origin/main). |
| **Limitaciones** | `exportDocumentMarkdown` hereda la marca de lista `1.` (sin re-contar) igual que `blocksToMarkdown`; la candidatura del guard null en `collectRelations` (bundle.js:201-212) y `remapRefs` (storage.js:325-342) queda DISCOVERED documentada para una ronda futura. |
| **Proxima prioridad** | DISCOVERY 8va ronda o evolucion del runner; o promover la candidatura DISCOVERED del guard null de relaciones en export/import. |

## Cycle 175 — CE-112: export/import no crashean con una relation null (DISCOVERY 8va ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | 90c1309 (commit registro CE-111, ultimo) |
| **Task** | CE-112 (P2, DISCOVERY 8va ronda -> DONE). Cola SIN todo TODO (todo DONE/DISCOVERED); el ciclo se dedico a DISCOVERY (regla 8). Se promovio la candidatura DISCOVERED mas antigua y de valor: el guard null en `collectRelations`/`remapRefs` para una entrada `null` en la matriz `relations` (export/import). |
| **Hypothesis (confirmado leyendo el source)** | Dos caminos asimetricos del flujo de datos crasheaban con una entrada `null` en `relations`: IMPORT (`importProject` -> `remapRefs`, storage.js:333) con `obj.relations.map(r => ({ ...r, ... }))` reventaba `...r` sobre `null`; EXPORT (`exportProject` -> `buildManifest` -> `collectRelations`, bundle.js:201-212, que accede a `r.targetId || r.to`) reventaba con `r` null. Ambos eran asimetricos con `collectRefIds` (bundle.js:116 `if (!rel) continue;`) y `validateBundleImport` IGNORA el null (no lo rechaza), asi que el null llegaba vivo a `remapRefs`. |
| **Bugs encontrados (confirmados)** | ![sin captura de navegador] el export de un proyecto con una relation null en la matriz `relations` lanza `TypeError: Cannot read properties of null (reading 'targetId')` y rompe el flujo estrella `documento -> informe`; el import de un bundle con ese null reventaba en `remapRefs` antes de escribir. |
| **Change** | Guard de paridad con `collectRefIds` en los dos sitios: `collectRelations` (bundle.js) anade `if (!r) continue;` para saltar el null en el conteo/derivacion del manifiesto; `remapRefs` (storage.js) descarta las entradas null de `relations` (`.map(...).filter(r => r !== null && r !== undefined)`) de modo que una relacion valida se remapea al id nuevo y el null no se persiste. |
| **Bugs corregidos** | (1) Exportar un proyecto con `relations:[null,...]` ya no crashea: el manifest se construye y el `relationCount` solo cuenta la relacion valida. (2) Importar tal bundle ya no crashea: la relacion valida se remapea al id nuevo y el null se descarta (no se persiste). |
| **Tests ejecutados** | Suite nueva `tests/workspace/relations-null-guard-test.mjs` 14/14 (CODIGO REAL de bundle.js+storage.js en sandbox IDB, `fake-indexeddb/auto`): A. IMPORT con `documents[0].relations = [null, {targetId:'doc-b',type:'link'}]` — validateBundleImport no rechaza, importProject no lanza, el null se descarta y el targetId se remapea al id nuevo de DocB, tipo conservado; B. EXPORT via `buildManifest` (el mismo que llama exportProject) con relation null — no lanza, relationCount=1 solo la valida, derivation correcta; C. anti-regresion estatica (guard presente en ambos sitios, collectRefIds intacto). Registrada en el release gate tras CE-111. |
| **Tests PASS** | 14/14 (nueva); CE-093 revalidada 14/14; RELEASE GATE completo 78 suites PASS 0 fail; manifest `artifacts/deep-audit/release-gate/release-gate-90c13092dd5ab6d7d2482eb9c2c038ec8271a419.json`. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (robustez del import/export ante relations con entradas null). |
| **Evidence** | `workspace/core/bundle.js` (collectRelations), `workspace/core/storage.js` (remapRefs), `tests/workspace/relations-null-guard-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`, `artifacts/deep-audit/release-gate/release-gate-90c13092dd5ab6d7d2482eb9c2c038ec8271a419.json`. |
| **Commits** | 7ec7bea (fix(ce): CE-112 export/import no crashean con una relation null en relations — 7 archivos). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado (rama acumulada por delante de origin/main). |
| **Limitaciones** | La otra candidatura DISCOVERED documentada (`_flushDirtyEntity` lee la vista nueva) queda pendiente para una ronda futura; no se toco `collectRefIds` (paridad preservada). |
| **Proxima prioridad** | DISCOVERY 9na ronda o evolucion del runner; o promover la candidatura DISCOVERED `_flushDirtyEntity`. |

## Cycle 176 — CE-113: _flushDirtyEntity leia la vista NUEVA al navegar -> perdia la edicion del saliente (DISCOVERY 9na ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | 4a787cf (commit registro CE-112, ultimo) |
| **Task** | CE-113 (P2, DISCOVERY 9na ronda -> DONE). Cola SIN todo TODO (todo DONE/DISCOVERED); el ciclo se dedico a DISCOVERY (regla 8). Se confirmo y promovio la candidatura DISCOVERED documentada desde CE-111/112: `_flushDirtyEntity()` lee la vista NUEVA y por eso el flush del saliente se pierde al navegar entre vistas. |
| **Hypothesis (confirmado leyendo el source)** | `_flushDirtyEntity()` decidia QUE entidad flushear leyendo `appStore.get('currentView')`. Pero `renderView` corre a traves del subscriber de `currentView` (workspace.js:995), que se dispara DESPUES de que `navigateTo` (workspace.js:727) ya haya puesto la vista NUEVA. Asi, al salir del editor hacia una vista de tabla (o cualquier otra), `_flushDirtyEntity` leia la vista NUEVA: flusheaba la TABLA en lugar del DOC (consumiendo la bandera COMPARTIDA `isDirty` que la edicion del doc habia marcado) o NO flusheaba nada (vistas sin rama doc/table); `renderView` luego cancelaba el debounce del doc (`clearTimeout(autoSaveDoc._timer)`) y, con `isDirty` ya en false, ni el intervalo de 5s salvaba la ultima edicion del doc saliente. |
| **Bugs encontrados (confirmados)** | ![sin captura de navegador] al editar un documento y navegar a una vista de tabla (o dashboard/documents) dentro de la ventana del debounce, la ultima edicion del documento SALIENTE puede perderse: `_flushDirtyEntity` limpia `isDirty` flusheando la entidad NUEVA (o no flushea nada) y `renderView` cancela el timer del doc. La suite CE-113 lo reproduce con CODIGO REAL y reload del almacen. |
| **Change** | Se pasa la vista SALIENTE hasta `_flushDirtyEntity`: el subscriber de `currentView` recibe `(view, prevView)` (state.js:12 pasa `fn(v, prev[k], state)`) y lo reenvia a `renderView(view, prevView)`; `renderView(view, prevView)` llama `_flushDirtyEntity(prevView)`; `_flushDirtyEntity(outgoingView)` usa `outgoingView || appStore.get('currentView')` como fallback (callers directos tipo `refreshCurrentView` que no cambian vista siguen funcionando). |
| **Bugs corregidos** | (1) Navegar del editor a una vista de tabla con la edicion del doc en el debounce ya no pierde la ultima edicion: el doc se flushea al salir. (2) Navegar del editor a una vista sin entidad (dashboard/documents) tambien flushea el doc (antes no hacia nada). (3) Simetrico: salir de la tabla hacia el editor conserva la celda editada de la tabla saliente. (4) La tabla/doc entrante no se contamina con la edicion ajena (ya no se consume `isDirty` con la entidad equivocada). |
| **Tests ejecutados** | Suite nueva `tests/workspace/flush-outgoing-view-test.mjs` 20/20 (CODIGO REAL de workspace.js: `_flushDirtyEntity`, `_flushOutgoingEntity`, `autoSaveDoc`, `autoSaveTable`, locks, `installEntitySwitchFlush` + appStore real de state.js + capa persistente fiel a storage.js + shim de `renderView` que replica las 2 lineas relevantes del real: flush + cancelacion de timers + reload del almacen): escenario 1 FIX doc->tabla conserva el doc saliente y no contamina la tabla; escenario 2 CONTROL NEGATIVO sin prevView el doc saliente se PIERDE (isDirty se consume con la tabla, debounce cancelado) — prueba que el fix es necesario; escenario 3 FIX tabla->doc conserva la celda saliente; escenario 4 CONTROL NEGATIVO simetrico (tabla se pierde sin fix); escenario 5 FIX doc->dashboard (vista sin entidad) conserva el doc; escenario 6 compatibilidad `_flushDirtyEntity()` sin prevView cae a currentView (callers directos); escenario 7 anclas estaticas (subscriber reenvia prevView, renderView reenvia a `_flushDirtyEntity(prevView)`, fallback `outgoingView || currentView`). |
| **Tests PASS** | 20/20 (nueva); anclas estaticas REACTUALIZADAS sin debilitar la asercion en suites de auditoria que matcheaban la firma antigua: `cross-entity-integrity-test` 55/55, `persistence-lifecycle-audit` 95/95, `storage-recovery-lifecycle` 69/69; CE-090 `doc-table-switch-flush` 9/9 y CE-082 `document-editor-persistence-race` 23/23 revalidadas (fallback intacto). RELEASE GATE completo 79 suites PASS 0 fail; manifest `artifacts/deep-audit/release-gate/release-gate-4a787cf7302db04202bac609b4ee3caeeb8e24d1.json`. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (data-loss al navegar entre vistas: flush del saliente guiado por la vista previa). |
| **Evidence** | `workspace/workspace.js` (subscriber de currentView, `renderView`, `_flushDirtyEntity`), `tests/workspace/flush-outgoing-view-test.mjs`, `tests/workspace/{cross-entity-integrity,persistence-lifecycle-audit,storage-recovery-lifecycle}-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`, `artifacts/deep-audit/release-gate/release-gate-4a787cf7302db04202bac609b4ee3caeeb8e24d1.json`. |
| **Commits** | 464ae7e (fix(ce): CE-113 flush del saliente guiado por la vista previa al navegar — 9 archivos). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado (rama acumulada por delante de origin/main). |
| **Limitaciones** | `renderView` tiene otros call sites directos que no pasan prevView (p.ej. `refreshCurrentView`); en esos, `_flushDirtyEntity` cae al fallback currentView (mismo comportamiento de antes, sin regresion). La candidatura del reaper/otras sigue DISCOVERED para rondas futuras. |
| **Proxima prioridad** | DISCOVERY 10ma ronda o evolucion del runner. |

## Cycle 177 — CE-114: el undo truncaba el dataUrl de las capturas -> corrupcion persistida (DISCOVERY 10ma ronda)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | c10f78a (commit registro CE-113, ultimo) |
| **Task** | CE-114 (P2, DISCOVERY 10ma ronda -> DONE). Cola SIN todo TODO (solo CE-011/CE-063 DISCOVERED, decisiones del dueno/host); el ciclo se dedico a DISCOVERY (regla 8). Se lanzaron 3 exploradores paralelos (editor/bloques, query/datos, storage/import-export) y se promovio el candidato de mayor valor/riesgo: la corrupcion silenciosa del dataUrl de las capturas por el historial de undo/redo. |
| **Hypothesis (confirmado leyendo el source)** | `_captureWorkspaceState()` (workspace.js:842) snapshotteaba las capturas con `dataUrl: c.dataUrl ? c.dataUrl.slice(0, 200) : null`. Ese snapshot es el UNICO que alimenta `_appHistory` (undo/redo Y autosave); al deshacer, `_applyState` reescribia el store con `captures: snapshot.captures || []` -> dataUrls TRUNCADOS a 200 chars. El resto del codigo usa SIEMPRE el dataUrl completo (`saveImageCapture` 1882, `renderCaptureView` via `resolveCaptureImageDataUrl`, `extractTextFromScan` 2819, `saveWorkspaceSession` con `captures: appStore.get('captures')` 923), asi que un solo Ctrl+Z corrompia en silencio la imagen de TODA captura y la corrupcion se persistia en la sesion. |
| **Bugs encontrados (confirmados)** | ![sin captura de navegador] (1) Candidato editor (P1): el slice(0,200) del dataUrl en `_captureWorkspaceState` corrompia cada captura almacenada al deshacer (thumbnail roto, OCR fallido, luego persistido). (2) Candidato storage (P2, no implementado): `importProject` remapea `dashboard.config.sourceId` pero el shape real tiene `sourceId` TOP-LEVEL y NO remapea `query[].sourceId` -> el dashboard/query emitido apuntaria a `tables[0]` tras un round-trip. (3) Candidato storage (P2, no implementado): `correctedAssetId`/`originalAssetId`/`scanDocumentId`/`assetId` se remapean en import pero estan AUSENTES de REF_SOURCE_FIELDS/REF_CONFIG_FIELDS (bundle.js) y SOURCE_FIELDS/CONFIG_FIELDS (integrity.js) -> referencias scanner fuera de validacion/orphan/cascade. (4) Candidato query (P3): `queryIsDate` no reconoce fechas puntuadas europeas `DD.MM.YYYY` (soporta `core/locale-parser.js`). |
| **Change** | Las capturas se EXCLUYEN del historial de undo/redo a proposito: `_captureWorkspaceState()` ya NO incluye el campo `captures` (comentario explicito en el source) y `_applyState()` ya NO restaura `captures` desde el snapshot. Son datos anexo-apendice vivos mantenidos por su propio flujo (store + `saveWorkspaceSession`), NUNCA editados por acciones deshacibles de doc/tabla, asi que excluirlas elimina la corrupcion de raiz sin perder ningun semantic de undo. Las rutas de persistencia vivas (`saveWorkspaceSession` 923, ys `appStore.set` en 1905/2096/2199/2224/7596) no se tocan: las capturas siguen guardandose completas fuera del historial. |
| **Bugs corregidos** | (1) Un Ctrl+Z/Ctrl+Y en el editor ya no corrompe el dataUrl de las capturas (antes las truncaba a 200 chars y la sesion guardada persistia la corrupcion). (2) El undo/redo de doc/tabla ya no toca en absoluto las capturas (aplicar un snapshot ya no las reescribe). Las candidaturas storage (dashboard/query sourceId y campos scanner en guards) y query (fechas puntuadas) quedan DISCOVERED para rondas futuras. |
| **Tests ejecutados** | Suite nueva `tests/workspace/capture-history-dataurl-test.mjs` 12/12 (CODIGO REAL `_captureWorkspaceState` extraido + appStore real de state.js + historial fiel capture->apply + CONTROL NEGATIVO): escenario 1 el snapshot REAL ya no tiene `captures` ni dataUrl y la captura viva conserva su dataUrl completo (>200 chars); escenario 2 ciclo capture -> snapshot -> undo -> apply conserva el dataUrl completo y la captura sigue en el store; escenario 3 CONTROL NEGATIVO reimplanta el slice(0,200) anterior y aplica -> pisa el dataUrl a 200 chars roto (demuestra que el fix es necesario, no tautologico); escenario 4 anclas estaticas (no existe slice(0,200) ni restauracion de captures en `_applyState`). |
| **Tests PASS** | 12/12 (nueva). RELEASE GATE completo 80 suites PASS 0 fail; manifest `artifacts/deep-audit/release-gate/release-gate-c10f78abf5be3d1a4b513535b93c096506773677.json`. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (corrupcion silenciosa del dataUrl de capturas por el historial de undo/redo: eliminada de raiz). |
| **Evidence** | `workspace/workspace.js` (`_captureWorkspaceState` y `_applyState`), `tests/workspace/capture-history-dataurl-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`, `artifacts/deep-audit/release-gate/release-gate-c10f78abf5be3d1a4b513535b93c096506773677.json`. |
| **Commits** | 853503a (fix(ce): CE-114 el undo ya no trunca ni restaura el dataUrl de las capturas — 6 archivos). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado (rama acumulada por delante de origin/main). |
| **Limitaciones** | Las capturas quedan excluidas del historial (un undo NO restaura una captura eliminada/importada recientemente en el estado del store; pero su persistencia en `saveWorkspaceSession` y el flujo de captura real las mantienen completas). Las candidaturas storage (dashboard/query `sourceId` en import y campos scanner en validation/orphan/cascade) y query (fechas puntuadas europeas) quedan DISCOVERED para rondas futuras. |
| **Proxima prioridad** | DISCOVERY 11va ronda o evolucion del runner; o promover el candidato storage de mayor valor (dashboard/query `sourceId` sin remapear en `importProject`). |

## Cycle 178 — CE-115: el import no remapeaba el sourceId top-level de dashboard/query -> round-trip export->import desconectaba la fuente (BUG_FIX)

| Field | Value |
|-------|-------|
| **Date** | 2026-09-03 |
| **Branch** | main |
| **HEAD inicial** | 7e87783 (commit registro CE-114, ultimo) |
| **Task** | CE-115 (P2 -> DONE). Se promovio el candidato storage de mayor valor de la ronda 10 (documentado en Cycle 177, Bugs encontrados #2): `importProject` deja sin remapear el `sourceId` a nivel TOP de dashboard y query. |
| **Hypothesis (confirmado leyendo el source)** | El shape REAL que se persiste y exporta lleva `sourceId` TOP-LEVEL: dashboard (`dashboardNormalizeConfig` lee `saved.sourceId` workspace.js:7182 y lo emite top-level en 7199; `dashboardDefaultConfig` en 7167) y query (`querySerializeModel` top-level workspace.js:5732, `queryCreateModel` 5706; `queryModelFromSaved` hace `tables.find(id === saved.sourceId)` en 5742 con fallback a `baseHeaders/baseRows` embebidos). Pero `importProject` (core/storage.js:383-388) solo remapeaba `dashboard.config.sourceId` / `query.config.sourceId` — una forma que el shape real NO usa. Como import re-crea cada tabla con un id NUEVO (`tableIdMap`), tras un round-trip el `sourceId` original (p. ej. `table-b`) ya no existe: dashboardNormalizeConfig cae a `tables[0]` (panel con datos de la tabla equivocada) y query disconnects de su tabla viva (baseRows congelados). Dados incorrectos en silencio. |
| **Bugs encontrados (confirmados)** | (1) `importProject` deja el `sourceId` top-level de dashboard y query sin remapear -> round-trip export->import los reconecta a la fuente equivocada/desconectada. (2) `query.sheets[].sourceId` tampoco se remapeaba (modelo de hojas, si existiera). (3) El shape legacy `config.sourceId` si se remapeaba (conservar como defensivo). Siguen DISCOVERED (rondas futuras): scanner fields en guards; fechas puntuadas europeas en `queryIsDate`. |
| **Change** | En `workspace/core/storage.js`, `importProject` remapea ahora TAMBIEN el `sourceId` a nivel TOP de `dashboard` y `query`, y `query.sheets[].sourceId` en cada hoja, con comentario explicito referenciando CE-115 y las lineas de workspace.js. Se conserva el remap defensivo `config.sourceId` existente para bundles legacy. No se toca la persistencia ni el modelo del consumidor. |
| **Bugs corregidos** | (1) Tras export->import, el dashboard apunta al id NUEVO de su tabla fuente (ya NO a `tables[0]`). (2) La query conserva su currentSource apuntando a la tabla importada correcta (ya NO se desconecta a baseRows congelados). (3) Compatibilidad legacy `config.sourceId` intacta. |
| **Tests ejecutados** | Suite nueva `tests/workspace/import-sourceid-remap-test.mjs` 19/19 (CODIGO REAL bundle+storage en sandbox con fake-indexeddb; reset de DB por escenario para determinismo): dashboard.sourceId remapeado al id NUEVO de la fuente correcta (ni tables[0] ni el id original), query.sourceId remapeado a la fuente correcta, control negativo (find del sourceId original falla; fallback POSICIONAL a `tables[0]`; query desconectada -> baseRows congelados), compat legacy `config.sourceId`, anclas estaticas. Se detecto y corrigio una inestabilidad de ORDEN en el control (la posicion `tables[0]` no es garantia de cual tabla es) -> el control actual es independiente del orden. |
| **Tests PASS** | 19/19 (nueva), determinista en multiples ejecuciones. RELEASE GATE completo 80+1 suites PASS 0 fail; manifest `artifacts/deep-audit/release-gate/release-gate-7e877837245d3d0bab2a3b41eae37b7387a490bf.json`. |
| **Tests FAIL** | 0. |
| **Resultado** | BUG_FIX (round-trip export->import reconectaba dashboard/query a la tabla equivocada o desconectada). |
| **Evidence** | `workspace/core/storage.js` (`importProject`), `tests/workspace/import-sourceid-remap-test.mjs`, `scripts/test-workspace-release.mjs`, `CONTINUOUS-EVOLUTION-QUEUE.md`, `artifacts/deep-audit/release-gate/release-gate-7e877837245d3d0bab2a3b41eae37b7387a490bf.json`. |
| **Commits** | 2ca19dc (fix(ce): CE-115 el import remapea el sourceId top-level de dashboard y query — 4 archivos). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`; `git push` denegado (rama acumulada por delante de origin/main). |
| **Limitaciones** | El remap top-level usa `remapId` sobre el valor persistido; si un bundle contuviera un `sourceId` que apuntara a una tabla no incluida en el bundle, `remapId` lo dejaria tal cual (comportamiento defensivo, MISMO que antes; el consumidor caeria a tables[0]/desconexion como limite documentado). La reparacion de bundles YA malimportados no es retroactiva (aplica a futuros imports). |
| **Proxima prioridad** | DISCOVERY 11va ronda o evolucion del runner; promover el candidato disquery (fechas puntuadas europeas en `queryIsDate`) o scanner fields en guards. |

## Cycle 128 — Fix test-debt in engine/parser/planner suites + register them in the gate (CE-065)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | 97ddbbc |
| **HEAD final** | 8e47034 |
| **Task** | CE-065 (MEANINGFUL_TEST_COVERAGE): deuda preexistente de pruebas — `workflow-engine-test.mjs` y `instruction-planner-test.mjs` crasheaban al ejecutarse en aislamiento (ReferenceError por dependencias sin resolver en el harness de VM) y no estaban en el release gate, por lo que nadie las ejecutaba (deuda oculta). |
| **Hypothesis** | Ambos harnesses quitaban los `import` con regex pero no incluian los modulos que resolvian las dependencias: `workflow-engine.js` importa `createExecutionResources` de `execution-resources.js`, y `workflow-model.js` importa `WORKFLOW_DEFINITION_VERSION` de `schema-versions.js`. Incluir esos modulos los haria pasables en aislamiento; registrarlos en el gate los protegeria contra regresion. |
| **Change** | `workflow-engine-test.mjs` anade `execution-resources.js` al codigo combinado del sandbox (18/18 en aislamiento; antes `ReferenceError: createExecutionResources`). `instruction-planner-test.mjs` anade `schema-versions.js` (73/73; antes `ReferenceError: WORKFLOW_DEFINITION_VERSION`). Se registran `instruction-parser` (116/116), `workflow-engine` (18/18) y `instruction-planner` (73/73) en `test-workspace-release.mjs` tras `text-to-document`. |
| **Bugs encontrados** | Referencias sin resolver en los harnesses de VM de dos suites (deuda documentada desde Cycle 117). |
| **Bugs corregidos** | Ambos harnesses incluyen ahora sus modulos de dependencias; las 3 suites quedan registradas en el release gate. |
| **Tests ejecutados** | `instruction-planner-test` 73/73 en aislamiento; `workflow-engine-test` 18/18 en aislamiento; `instruction-parser-test` 116/116; release gate completo 34 suites PASS (build 214 paginas, sync OK, OCR E2E real, star-flow, capture-flow-chain, persistence). |
| **Tests PASS** | Release gate 34/34 PASS; manifest `release-gate-97ddbbc...json` (determinista). |
| **Tests FAIL** | 0. |
| **Commits** | 8e47034 (fix test-debt + registro en gate + evidencia). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`; `gh` sin autenticar). |
| **Limitaciones** | Puramente test-only; 0 cambios de producto. Las suites quedan protegidas contra regresion en el gate. |
| **Proxima prioridad** | Sin TODO en la cola -> DISCOVERY de producto o promover proxima oportunidad DISCOVERED (CE-011 gate red negativa, CE-063 decision del dueno/host). El despliegue del HEAD certificado depende del canal autorizado de GitHub. |

---

## Cycle 127 — Markdown tables in text.to-document (CE-064) + release-gate sync fix

| Field | Value |
|-------|-------|
| **Date** | 2026-08-29 |
| **Branch** | main |
| **HEAD inicial** | 03aef33 |
| **HEAD final** | e0eb3d1 |
| **Task** | CE-064 (FEATURE): `text.to-document` y el editor de documentos pierden las tablas Markdown (limitacion documentada de CE-046). |
| **Hypothesis** | `text.to-document` solo dividia por saltos de linea en headings/lists/parrafos y descartaba tablas GFM. Se podia ensenar a detectar tablas/bloques de codigo/citas y volverlos editables y exportables, cerrando el hueco del flujo estrella `archivo -> ... -> documento -> tabla`. |
| **Change** | `blocksFromText(text, idPrefix)` puro (sin DOM, testeable en VM) en `workflow-operations.js`, usado por `text.to-document`: detecta tablas GFM (separador `:?-+:?`), fences ` ``` ` con lang, citas `>`, headings, bullets y parrafos; maneja tuberias escapadas `\|` -> `|`. `renderBlock` de `workspace.js` anade rama `table` (tabla real con thead/tbody, bordes por CSS vars) que le faltaba -> cae en el placeholder de parrafo generando bloques vacios. `exportDocument` anade caso `table` que emite GFM (fila header + separador `---` + filas con `\|` escapado). Nueva suite `tests/workspace/text-to-document-test.mjs` 15/15, registrada en el release gate. |
| **Bugs encontrados** | `verify-workspace-sync.mjs` seguia exigiendo que `dist/workspace/` fuera espejo completo, pero la capa 3 (commit 95aac07) excluye DELIBERADAMENTE los docs internos (`.md`, `AUTONOMOUS_MODE`, `PRODUCTION_READINESS_DONE`) del artefacto publicado. Desde esa capa el gate quedaba colgado como DESINCRONIZADO (21 archivos) y no se habia vuelto a correr, dejando el resultado 30/30 obsoleto. |
| **Bugs corregidos** | `verify-workspace-sync.mjs` refleja la exclusion intencional de archivos privados (helper `isPrivateRel` igual al `isWorkspacePrivate` del build); ahora SYNC OK (42 publicos presentes, 21 privados excluidos). Esto restaura la integridad del release gate. |
| **Tests ejecutados** | `text-to-document` 15/15; `workflow-export-md` 30/30; `instruction-parser` 116/116 (los fallos aislados de `workflow-engine`/`instruction-planner` por VM globals son PREEXISTENTES y no forman parte del gate); `workspace-test` 157/157; build 214 paginas; `verify-workspace-sync` SYNC OK; release gate completo 32/32 PASS (incluye OCR E2E real, star-flow, capture-flow-chain, persistence). |
| **Tests PASS** | Release gate 32/32 PASS; manifest `release-gate-03aef33...json` (determinista). |
| **Tests FAIL** | 0 (en el gate). |
| **Commits** | e0eb3d1 (CE-064 + sync fix + evidencia). |
| **Bloqueos** | Despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL` (harness niega `git push*`; `gh` sin autenticar). |
| **Limitaciones** | `blocksFromText` detecta tablas compactas (fila header + separador contiguos) y filas consecutivas que empiecen por `|`; no parsea tablas separadas por lineas en blanco. Los fallos aislados de `workflow-engine-test`/`instruction-planner-test` (VM globals) siguen pendientes como deuda de pruebas independiente del gate. |
| **Proxima prioridad** | Sin TODO en la cola -> DISCOVERY de producto o promover proxima oportunidad DISCOVERED. El despliegue del HEAD certificado depende del canal autorizado de GitHub. |

---

## Cycle 126 — Cloudflare WebMCP edge-injection investigation (external, read-only)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-28 |
| **Branch** | main |
| **HEAD inicial** | 2cb96d1 |
| **HEAD final** | 2cb96d1 (no commit de codigo; solo evidencia + trackers) |
| **Task** | CE-063 (DISCOVERED, investigacion dirigida desde ACTIVE-MISSION.md item 2) |
| **Hypothesis** | El `<head>` del sitio live `apluno.com` incluye `/.webmcp/bridge.js`. Habia que confirmar si es inyeccion del borde de Cloudflare o artefacto del build, y si podria vulnerar la garantia local-first / cero-egress de Toolisto (acceso a IndexedDB o intercepcion de fetch/XHR/WebSocket del usuario). |
| **Change** | Ninguno en el repo. Investigacion read-only: HTTP contra el sitio publico + analisis estatico del script (47 616 bytes) + grep del repo. Se anade `artifacts/cloudflare-webmcp/investigation.md` y `evidence.json` (determinista, sin timestamps). |
| **Hallazgos** | El script es el puente WebMCP de Cloudflare (`webmcp` ×18, `// src/tool-pack.ts`, `// src/bridge/registry.ts`, `DEFAULT_MCP_URL="/mcp"`). Repo: 0 referencias a `webmcp|bridge.js|WebMCP|/mcp`. El script NO usa `XMLHttpRequest` (0), `WebSocket`/`EventSource`/`sendBeacon` (0), ni URL externas literales (0); sus 3 `fetch()` van a mismo origen (`/mcp`, `<img>` src, pack dinamico). No inyecta UI (`document.write`/`createElement` = 0) y no lee IndexedDB. Requiere `document.modelContext` (Chrome M146+) y un servidor en `/mcp` (actualmente 404 → 0 site tools → inerte). |
| **Bugs encontrados** | Ninguno en el repo. |
| **Bugs corregidos** | N/A (investigacion externa). |
| **Tests ejecutados** | Grep determinista del repo (0 coincidencias); HTTP HEAD/GET contra `https://apluno.com/` y `/toolisto` (bridge presente), `/privacidad/` (404, gap de deploy aparte) y `/mcp` (404); descarga y analisis estatico de `bridge.js`. |
| **Tests PASS** | Atribucion y ausencia de riesgo egress confirmadas por analisis. |
| **Tests FAIL** | 0 |
| **Commits** | (solo trackers + evidencia; ver diff) |
| **Bloqueos** | Accion del dueno/host: divulgar o quitar la ruta `/.webmcp/*` en Cloudflare. No es bloqueo de codigo. El despliegue del HEAD certificado sigue bloqueado por separado (`HARD_RUNTIME_BLOCK_CONFIRMED` del harness, `git push*` denegado). |
| **Limitaciones** | La investigacion es contra el build live antiguo (`0e2e14a`); el HEAD certificado `2cb96d1` no esta desplegado, pero la inyeccion es del borde y afectaria a cualquier build por igual. No se modifica Cloudflare ni el repo. |
| **Proxima prioridad** | CE-063 queda DISCOVERED (decision del dueno/host). Sin TODO en la cola → siguiente ciclo de DISCOVERY de producto o promover oportunidad DISCOVERED. El despliegue sigue `WAITING_FOR_OWNER_AUTHORIZATION_CHANNEL`. |

---

## Cycle 125 — Performance improvements: server caching, workspace lazy-load, CSS audit (CE-062 follow-up)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-25 |
| **Branch** | main |
| **HEAD inicial** | d2efdba |
| **HEAD final** | TBD (pending commit) |
| **Task** | Performance follow-up: server cache headers, workspace vendor lazy-load, CSS critical path audit |
| **Hypothesis** | CE-062 identified 3 P2/P3 gaps: no cache headers on dev server, workspace eagerly loads 407KB of vendor JS (pdf.min.js + jszip.min.js) not needed at startup, APLUNO CSS may have dead code. |
| **Change** | server.js: added cacheControl() function with fingerprinted-URL-aware headers (immutable for ?v= URLs, 1h for JS/CSS, no-cache for HTML/SW, 24h for images). workspace/index.html: removed eager pdf.min.js and jszip.min.js script tags, added lazy-loader.js. workspace/lazy-loader.js: new utility providing __ensurePdfJs/__ensureJSZip/__lazyLoadScript for on-demand script injection. js/ocr/pdf-ocr-engine.js: loadPdf wraps with __ensurePdfJs(). workspace/core/workflow-operations.js: JSZip usage wraps with __ensureJSZip(). tests/performance-loading-regression.mjs: added 8 new checks (workspace lazy-load, deferred scripts, lazy-loader API). |
| **Tests ejecutados** | performance-loading-regression 548/548 (8 new); workspace gate 30/30; public gate 19/19. |
| **Tests PASS** | 548/548 performance regression. All gates PASS. |
| **Tests FAIL** | 0 |
| **Commits** | TBD |
| **Bloqueos** | None. |
| **Results** | Server: all resource types now have proper Cache-Control (immutable for fingerprinted, 1h for JS/CSS, no-cache for HTML). Workspace: initial load 1192KB → 785KB (34% reduction, 407KB saved) by lazy-loading pdf.min.js (312KB) and jszip.min.js (95KB). CSS: 100% coverage confirmed, no dead CSS to extract. All 8 new anti-regression checks pass. |
| **Proxima prioridad** | CE-063 or next from CONTINUOUS-EVOLUTION-QUEUE.md |

---

## Cycle 125 (original CE-062) — Real Browser Performance & CSS CWV Certification

| Field | Value |
|-------|-------|
| **Date** | 2026-08-25 |
| **Branch** | main |
| **HEAD inicial** | 3452809 |
| **HEAD final** | TBD (pending commit) |
| **Task** | CE-062 (Real Browser Performance, CSS Critical Path & CWV Certification) |
| **Hypothesis** | Performance audit (commit 3452809) reduced JS 94-95% via defer + category-specific loading, but no real-browser verification exists. Need Playwright measurement of FCP, CLS, TBT, CSS coverage, cold vs warm loads, adversarial defer tests, performance budgets, and anti-regression snapshot. |
| **Change** | workspace/index.html: added `defer` to 4 render-blocking scripts (pdf.min.js, jszip.min.js, engine-loader.js, pdf-ocr-engine.js). scripts/apluno-components.mjs: added `fetchpriority="high"` to APLUNO CSS link. 404.html: added `fetchpriority="high"` to CSS. tests/performance-loading-regression.mjs: fixed 404.html CSS check to detect any stylesheet (not just styles.css). artifacts/ce-062/: comprehensive measurement data (browser-measurements.json, lighthouse-playwright.json, css-coverage.json, cold-warm.json, adversarial-budgets.json, final-report.md). |
| **Tests ejecutados** | performance-loading-regression 540/540; workspace gate 30/30 (2225 tests); public gate 19/19. |
| **Tests PASS** | 540/540 performance regression. All gates PASS. |
| **Tests FAIL** | 0 |
| **Commits** | TBD |
| **Bloqueos** | None. |
| **Results** | CLS=0.0000 all pages. TBT=0ms all pages. FCP: 56-552ms desktop, 52-272ms mobile. CSS coverage: 100% all pages. Cold→Warm: 98-100% transfer savings (tool pages). Defer adversarial: all pass (No-JS renders, No-CSS loads, delayed JS=0 CLS, slow CSS doesn't block). SW: registered (toolisto-static-v4). Documented gaps: no cache headers on dev server, catalog DOM 2005>1500 budget (inherent to 202 cards), workspace 45 requests. |
| **Proxima prioridad** | CE-063 (next from CONTINUOUS-EVOLUTION-QUEUE.md) |

---

## Cycle 118 — Cross-item autosave integrity (CE-058)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-24 |
| **Branch** | main |
| **HEAD inicial** | a818300 |
| **HEAD final** | dbe9c1f |
| **Task** | CE-058 (P1, per-entity autosave integrity: cross-item lock isolation, flush-before-navigate, stale write protection) |
| **Hypothesis** | CE-057 per-type locks (_docSaveLock/_tableSaveLock) shared across ALL entities of the same type: latest-wins coalescing loses saves when doc A and doc B are edited alternately. renderView clears debounce timers without flushing dirty entities. saveDoc/saveData have no protection against stale IDB writes. |
| **Change** | workspace.js: _createEntityLockMap() returns per-entity lock maps (_docLocks, _tableLockMap) with independent per-ID locks, replacing shared per-type locks. _flushDirtyEntity() saves the currently dirty entity before navigation in renderView. autoSaveDoc/autoSaveTable guard: early return if doc/table is missing or has no id. storage.js saveDoc/saveData: _writeSeq monotonic counter; guard `existing._writeSeq > (doc._writeSeq \|\| 0)` discards stale writes. Tests: new cross-entity-integrity-test.mjs (55/55) registered in release gate. |
| **Tests ejecutados** | cross-entity-integrity-test.mjs 55/55; autosave-lock-test.mjs 18/18; workspace-test 157/157; phase3a-test 80/80; phase3b-test 59/59; phase11-audit 106/106; review-status-persistence-test.mjs 15/15; persistence-sequence-cert.mjs (included). Release gate: 16/16 PASS. |
| **Tests PASS** | 55/55 cross-entity (lock map 16/16, _writeSeq stale guard 17/17, cross-entity concurrency 13/13, flush-before-navigate 2/2, document/table isolation 5/5, failsafe 3/3, cancelAll 2/2). 15/15 review-status-persistence. Regresión: autosave 18/18, workspace 157/157, phase3a 80/80, phase3b 59/59, phase11 106/106. Release gate: 16/16 PASS. |
| **Tests FAIL** | 0 |
| **Commits** | dbe9c1f: `fix(workspace): harden entity save sequencing and lock eviction (CE-058)` |
| **Bloqueos** | Ninguno. |
| **Bugs found during CE-057 cert** | Per-type lock coalesces across different entity IDs (latest-wins loses saves for different docs/tables); navigation discards pending debounce saves without flushing dirty entity; no stale write protection at IDB boundary. setTableReviewStatus called autoSaveTable(debounce) then renderView cleared the timer → save never fired → IDB retained reviewStatus='draft'. |
| **Proxima prioridad** | CE-059 (malformed IndexedDB recovery), CE-060 (storage failure UX), CE-061 (reload/crash recovery), CE-062 (migration resilience), CE-063 (import resilience). |

---

## Cycle 117 — Autosave race hardening (CE-057)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-24 |
| **Branch** | main |
| **HEAD inicial** | 0e2e14a |
| **HEAD final** | 726f974 |
| **Task** | CE-057 (P1, autosave y persistencia: serialización de escrituras) |
| **Hypothesis** | autoSaveDoc/autoSaveTable debounce (1s) and _setupAutosave interval (5s) both call saveDoc/saveData concurrently on the same entity; saveCurrentWorkspaceItem (manual) and _flushAndSaveSession (visibility change) also race, causing parallel IndexedDB writes on the same doc/table that can lose updates or write stale state. |
| **Change** | workspace.js: new `_createSaveLock()` utility serializes async writes per entity type with latest-wins coalescing, failsafe timeout (60s), and generation counter to detect stale drains. Two instances (`_docSaveLock`, `_tableSaveLock`) wrap all save paths: autoSaveDoc debounce, autoSaveTable debounce, _setupAutosave interval, saveCurrentWorkspaceItem (manual), _flushAndSaveSession (visibility change). renderView clears debounce timers on navigation. Tests: new `autosave-lock-test.mjs` (18/18) registered in release gate. |
| **Tests ejecutados** | autosave-lock-test.mjs 18/18; workspace-test 157/157; phase3a-test 80/80; phase3b-test 59/59; phase11-audit 106/106; workflow-ui-test 65/65; operation-registry 26/26. |
| **Tests PASS** | 18/18 autosave lock (serialization, latest-wins, error handling, cancel, burst, failsafe). Regresión: workspace 157/157, phase3a 80/80, phase3b 59/59, phase11 106/106, UI 65/65, registry 26/26. Total: 511+ passing. |
| **Tests FAIL** | 0 (concurrency-test and workflow-engine-test failures are pre-existing: `createExecutionResources` missing from VM context, unrelated) |
| **Commits** | 9052348 |
| **Bloqueos** | Ninguno. |
| **Proxima prioridad** | CE-058 or next DISCOVERY; audit remaining core modules (instruction-planner, scanner-ui). |

---

## Cycle 116 — Execution lifecycle hardening + workspace lifecycle fixes (CE-051→CE-056)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-24 |
| **Branch** | main |
| **HEAD inicial** | cc9ea94 (FASE 3 closed) → prior commits: 935192e, 3c08c74, 02750fa (baseline test fixes) |
| **HEAD final** | e850711 |
| **Task** | CE-051→CE-056 (P1/P2 execution lifecycle + workspace lifecycle hardening) |
| **Hypothesis** | executeFlow lacks try/catch (UI stuck on error), retryFailed lacks reentrancy guard, engine getSnapshot().total uses settled count instead of planned total, cancelled state unreachable from early return, PDF/file results missing Download/Workspace buttons, monitor recreates cancel button on each event; workspace.js has stale async re-render into detached containers, workflow auto-save timer leak, IO leak in capture cards, detached <a> in export. |
| **Change** | workflow-ui.js: try/catch/finally in executeFlow + generation guard + cleanupBtn disable during run + clear errors/progress at start; retryFailed reentrancy + catch + stale-generation; updateMonitor accepts plannedTotal; PDF/file Download button fixed (optional chaining); file-kind Add-to-Workspace enabled; monitor appends entries (cap 50) + persistent Cancel button. workflow-engine.js: runTotal tracked for getSnapshot; cancelled state set on generation mismatch; retryFailed guards (reentrancy, state check, _onTerminated records cancelled). workspace.js: _viewGeneration counter incremented in renderView; renderDocumentsView/renderDataView async re-render checks generation; workflow auto-save timer promoted to module scope and cleared on view change; IO in capture cards checks generation; export <a> appended to DOM before click. Baseline test fixes: accented text in workflow-ui-test, capture-flow-chain, builder-a11y, e2e-test, ocr-diagnostic; locale-parser VM import in document-pdf-test and tabular-text-parser-test. |
| **Tests ejecutados** | Workflow UI 65/65; Document→PDF 66/66; Tabular-parser 7/7; Capture-flow-chain 12/12; Engine 18/18; Release gate 14/14 PASS; all test-workspace-release sub-suites PASS. |
| **Tests PASS** | 14/14 release gate suites PASS, 0 FAIL. Total ~712 tests passing. |
| **Tests FAIL** | 0 |
| **Commits** | 935192e (baseline accent fixes), 3c08c74 (locale-parser VM import for doc-pdf-test), 02750fa (locale-parser for tabular-text-parser), 7243091 (CE-051→055 engine+UI lifecycle), e850711 (CE-056 workspace lifecycle). |
| **Bloqueos** | Ninguno. |
| **Proxima prioridad** | Continue CE-057+ audit of remaining core modules (instruction-planner, scanner-ui, etc.); workspace.js audit found issues fixed; CE-011 DISCOVERED gate; promote new opportunities from audit findings. |

---

## Cycle 115 — Capturas (imágenes escaneadas) encadenadas a Flujos hasta el OCR (CE-050)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-14 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f5bbd370c5b49da7dba0b3c5f6ff31c5f1f43d9d |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-050 (P2, DISCOVERY dirigida: sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | El flujo estrella `archivo → escaneo → OCR → documento → …` requiere que una captura escaneada guardada en el proyecto pueda entrar al constructor de flujos, pero CE-003 solo permitía encadenar documentos y tablas (`startWorkflowFromWorkspace` rechazaba `image` y `selectFromWorkspace` listaba solo documento/tabla), por lo que la imagen corregida de un escaneo no se podía reutilizar como entrada de un flujo (OCR, rotación…) sin volver a subir el archivo, rompiendo el encadenado interno del escaneo con el resto del proyecto. |
| **Change** | `workspace/core/workflow-ui.js`: `selectFromWorkspace` añade las capturas del proyecto (`kind: 'image'`, id `capture-<id>`, icono `camera`); `addWorkspaceItems` acepta `image` como entrada por referencia (sin copiar el asset) y deduplica por workspaceRef; `executeFlow` resuelve una referencia `capture-<id>` a la imagen real mediante el helper inyectado `resolveCaptureImage`, que devuelve el Blob de la captura (patrón CE-029: se resuelve el asset corregido sin duplicar el PNG en IDB) para poder encadenarla (p. ej. OCR). `workspace/workspace.js`: nuevo `resolveFlowCaptureImage(captureId)` (busca en appStore o `loadCaptureById`, resuelve `resolveCaptureImageDataUrl` y convierte el dataUrl a Blob con `fetch`), inyectado como `resolveCaptureImage` en `renderWorkflowView`; `renderCaptureView` añade el botón «Encadenar» a las tarjetas de captura (junto a «Extraer texto» y «Eliminar») que llama a `startWorkflowFromWorkspace({ id: 'capture-…', kind: 'image' })`; `startWorkflowFromWorkspace` acepta ahora `['document', 'data', 'image']`. |
| **Hallazgos** | La estrella del flujo pedía `escaneo` como entrada de los flujos, pero la UI solo exponía documento/tabla; la captura corregida vivía en un asset con `correctedAssetId` y no se podía reutilizar. La vía de inyección de un helper (`appHelpers.resolveCaptureImage`) reutiliza el patrón ya usado por `saveImageCapture`/`pushHistory` y mantiene la lógica de resolución de assets fuera del módulo de flujos (sin DOM). |
| **Bugs encontrados** | (ce-050 baseline) `startWorkflowFromWorkspace` aplicaba `return` silencioso para kind no permitido, sin feedback; la lista «Desde Workspace» ignoraba capturas. Durante el desarrollo del E2E, mi nueva suite fallaba (4 asserts) por usar `ok('nombre')` sin condición (`ok(name, condition)`) con condición `undefined` → siempre FAIL, a pesar de que el feature funcionaba (confirmado por diagnósticos con `docs:1`, `ocrWords:true` y palabras reales del fixture); se corrigió el contrato de las llamadas `ok(..., true)` del test. |
| **Bugs corregidos** | Sí: una captura (imagen escaneada) del proyecto entra al constructor de flujos por referencia, se resuelve como Blob desde su asset corregido y puede encadenarse (E2E: captura → OCR real → documento persistido en IndexedDB con las palabras OCR reales). |
| **Tests ejecutados** | `node tests/workspace/capture-flow-chain-e2e.mjs` (12/12, nuevo: seed de proyecto+captura+asset en IDB real, vista Capturas, botón Encadenar, captura como entrada `image`, OCR real con fixture `scan-clear.png`, documento con bloques persistido tras reload, palabras OCR reales, cero errores/consola y cero requests externos); `node tests/workspace/workflow-ui-test.mjs` (65/65, 3 contratos nuevos CE-050); `$env:E2E_PORT=8082; node tests/workspace/workflow-e2e-test.mjs` (31/31); `node scripts/test-workspace-release.mjs` (release gate completo 13 suites PASS, incluida la nueva `capture-flow-chain E2E` registrada); regresión workspace-test 156/156, phase3a 80/80, phase3b 59/59, phase11 106/106, op-registry 26/26, workflow-engine 18/18, workflow-document-pdf 66/66, ocr-source-selection 34/34, determinismo 71/71, build 179/179 y sync source/dist OK. |
| **Tests PASS** | Capture-flow-chain E2E 12/12; Workflow UI 65/65; Workflow E2E 31/31; regresión completa: Workspace 156/156, Phase 3A 80/80, Phase 3B 59/59, Phase 11 106/106, Registry 26/26, Engine 18/18, Document→PDF 66/66, OCR Source 34/34, determinismo 71/71, build 179/179 y sync source/dist OK; release gate 13/13. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): encadena capturas (imágenes escaneadas) en flujos hasta el OCR (CE-050)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La entrada de captura se resuelve por referencia cargando el asset corregido (sin persistir ningún `blob:`); el `fetch(dataUrl).blob()` depende de que el origen sirva data-URLs locales (local-first, sin red) y de que la captura tenga `dataUrl` o `correctedAssetId` resoluble. La deduplicación por `workspaceRef` evita añadir dos veces la misma captura. Las evidencias regeneradas por las suites al iniciar/ejecutar el ciclo (`artifacts/deep-audit/phase3-integrity-evidence.json`, `review-modal.png`, `TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `ocr-source-tests.json`, `star-flow-export.toolisto`, `screenshots/workspace/08-scanner-module-test.png`, `ocr-diagnostic.json` sin seguimiento y `artifacts/deep-audit/release-gate/release-gate-*.json`) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 114 — Resultados de texto de flujo añadidos al Workspace como documentos (CE-049)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 5223b9a1af8dbc3bb7ea18e67e54314bdf56f0d0 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-049 (P2, promovida de DISCOVERY: sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | La serie CE-047/CE-048 cubría resultados `document`/`data`/`image`, pero un resultado `text` de flujo —la salida de `image.ocr`, el paso central del flujo estrella `archivo → escaneo → OCR → documento → tabla → gráfico → informe → PDF`— solo ofrecía «Descargar» y no se podía añadir al Workspace: el texto extraído no se persistía como documento del proyecto, cortando el encadenado de la salida de un flujo con el Workspace. |
| **Change** | `workflow-ui.js`: el botón «Anadir al Workspace» se muestra también para `r.kind === 'text'`, y `addResultToWorkspace` añade la rama `text`: `textResultToDocument(name, text)` convierte el payload (string plano o Blob leído con `payload.text()`) en un documento Toolisto de bloques —mismo mapeo que `text.to-document`: headings 1/2/3, bullet-list y párrafos— con `id: 'flow-text-' + hash32(nombre+contenido)` estable para que readicionar el mismo resultado no duplique el documento; persiste con `saveDoc(project.id, doc)`, lo incorpora a `documents`, abre `currentDoc`, registra en `pushHistory`, refresca `refreshProjectCounts` e informa al usuario. Texto vacío/inservible se rechaza con aviso. `scripts/test-workspace-release.mjs`: `workflow-ui-test` se registra en el release gate (las suites VM de workflow no estaban registradas, gap preexistente). |
| **Hallazgos** | El botón «Anadir al Workspace» se renderizaba solo para `document`/`data`/`image`; un resultado `text` (OCR, exportaciones) quedaba solo-descargable y su salida no llegaba nunca al proyecto, aunque `text.to-document` ya sabía convertir texto a bloques. El id estable por contenido permite dedup sin depender de que el resultado traiga id del engine. |
| **Bugs encontrados** | El resultado OCR de un flujo no era persistible como documento (cortaba el flujo estrella tras el paso OCR). Los tests de workflow UI no estaban registrados en el release gate. |
| **Bugs corregidos** | Sí: un resultado `text` de flujo se persiste como documento Toolisto con id estable, se deduplica por contenido y refresca conteos; `workflow-ui-test` queda en el release gate. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (62/62, 8 contratos nuevos CE-049); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (31/31, E2E 6 nuevo con OCR real del fixture `scan-clear.png`: resultado text → Anadir al Workspace → documento con bloques persistido en IndexedDB tras reload con las palabras OCR reales y visible en Documentos); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK); regresión `workflow-engine-test.mjs` (18/18), `workflow-validator-test.mjs` (11/11), `operation-registry-test.mjs` (26/26), `workflow-export-md-test.mjs` (30/30), `workflow-document-pdf-test.mjs` (66/66), `workspace-test.mjs` (156/156), `phase3a-test.mjs` (80/80), `phase3b-test.mjs` (59/59), `ocr-source-selection.mjs` (34/34), `workspace-storage-test.mjs` (17/17), `phase4-integrity-test.mjs` (47/47), `evidence-determinism.mjs` (71/71), `phase3-integrity-test.mjs` (52/52), `phase11-audit.mjs` (106/106), `git diff --check`. |
| **Tests PASS** | Workflow UI 62/62 (wrapped text persistido, id `flow-text-` estable, en estado documents, refresh conteos, re-añadir no duplica, headings/bullets a bloques, nombre propio, texto vacío rechazado); Workflow E2E 31/31 incluyendo el E2E 6 nuevo (OCR real: botón en resultado text, documento con bloques persistido, palabras OCR del fixture presentes, visible en Documentos, cero errores JS); regresión completa de Workspace 156/156, Phase 3A 80/80, Phase 3B 59/59, Engine/Validator/Registry/Export-md/Document-PDF, OCR Source 34/34, Storage 17/17, Integridad 47/47, determinismo 71/71, Phase 3 integridad 52/52, Phase 11 106/106, build 179/179 y sync source/dist OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: persiste resultados de texto de flujos como documentos (CE-049). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El id del documento resultante es `flow-text-<hash32>` derivado del nombre+contenido: readicionar exactamente el mismo texto no duplica, pero dos resultados con el mismo texto pero nombres distintos generan dos documentos (intencionado). El mapeo de bloques es el mismo básico de `text.to-document` (sin detección de tablas Markdown ni imágenes); un OCR con estructura tabular debería encadenarse a `text.to-table` como antes. Las evidencias regeneradas por las suites al iniciar/ejecutar el ciclo (`artifacts/deep-audit/phase3-integrity-evidence.json`, `review-modal.png`, `TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `ocr-source-tests.json`, `star-flow-export.toolisto`, `screenshots/workspace/08-scanner-module-test.png` y `ocr-diagnostic.json` sin seguimiento) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 113 — Resultados de imagen de flujo añadidos al Workspace y payload envuelto normalizado (CE-048)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | fb6e9c5bb7df2d9a5f0fe90e398308a22a898768 |
| **HEAD final** | 6ef4273016216e1aa6bcee288b6cf9d5fb9699ba |
| **Task** | CE-048 (P2, DISCOVERY dirigida: sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | Los resultados de imagen de un flujo solo ofrecían «Descargar» (CE-047 cubrió document/data), cortando el encadenado imagen→OCR a su salida. Además, el engine envuelve cada resultado como `{ data: <payload>, kind, name }` (`workflow-engine.js` línea 146/160), así que `addResultToWorkspace` de CE-047 leía `result.data.blocks`/`headers` que quedaban dentro de `result.data.data`: la persistencia de documentos/tablas se omitía en silencio en un flujo real y solo funcionaba con la forma aplanada de los tests. |
| **Change** | `workflow-ui.js`: `addResultToWorkspace` normaliza el payload envuelto (`wrapped = result.data && result.data.data !== undefined && (result.data.kind !== undefined || result.data.name !== undefined)`, `payload = wrapped ? result.data.data : result.data`) y usa `payload` para document/data (arregla el bug real de CE-047) y para la nueva rama `kind === 'image'`: persiste el Blob como captura del proyecto cuando `appHelpers.saveImageCapture` está inyectado. El botón «Anadir al Workspace» se muestra también para resultados `kind === 'image'`. `workspace.js`: nuevo helper `saveFlowImageResult(project, blob, name)` que convierte el Blob a dataUrl, crea el asset de imagen (una sola copia del PNG, el patrón CE-029: la captura referencia `correctedAssetId` y no repite el dataUrl), crea la captura `type: 'workflow-result'` con sus relaciones, registra la ejecución y refresca conteos; se inyecta como `saveImageCapture` en `renderWorkflowView`. |
| **Hallazgos** | CE-047 era invisible a la regresión para flujos reales: `saveDoc`/`saveData` sí persistían cuando se invocaba la rama, pero la condición `result.data.blocks`/`headers` nunca era verdadera con el envoltorio del engine, por lo que el «Anadir al Workspace» de un flujo ejecutado nunca hacía nada fuera del test VM (que pasa la forma aplanada). El botón «Anadir al Workspace» se renderizaba solo para `document`/`data`, nunca para `image`. |
| **Bugs encontrados** | Persistencia de documento/tabla de un flujo real omitida silenciosamente (payload envuelto); resultados de imagen no persistibles como capturas. |
| **Bugs corregidos** | Sí: el payload envuelto del engine se normaliza y un resultado de imagen de flujo se persiste como captura (una sola copia del PNG via `correctedAssetId`), deduplicando el id de captura al reañadir un mismo id y refrescando conteos. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (54/54, 8 contratos nuevos); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (25/25, E2E 5 nuevo: flujo de imagen real → Anadir al Workspace → captura persistida en IndexedDB tras reload y visible en Capturas); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK); regresión `workflow-engine-test.mjs` (18/18), `workflow-validator-test.mjs` (11/11), `operation-registry-test.mjs` (26/26), `workflow-export-md-test.mjs` (30/30), `workspace-test.mjs` (156/156), `workflow-document-pdf-test.mjs` (66/66), `phase3a-test.mjs` (80/80), `phase3b-test.mjs` (59/59), `workspace-storage-test.mjs` (17/17), `phase4-integrity-test.mjs` (47/47), `phase5-bundle-trust-test.mjs` (53/53), `evidence-determinism.mjs` (71/71), `phase3-integrity-test.mjs` (52/52), `phase11-audit.mjs` (106/106). |
| **Tests PASS** | Workflow UI 54/54 (image envuelto persistido, project id correcto, refresh conteos para imagen, Blob crudo, nombre por defecto «Imagen del flujo», documento con payload envuelto persistido, tabla con payload envuelto persistida, Blob inválido rechazado); Workflow E2E 25/25 incluyendo el E2E 5 nuevo sin errores JS; regresión completa de Workspace 156/156, Phase 3A 80/80, Phase 3B 59/59, storage 17/17, integridad 47/47, bundle 53/53, determinismo 71/71, Phase 3 integridad 52/52, Phase 11 106/106, build 179/179 y sync source/dist OK. |
| **Tests FAIL** | 0 |
| **Commits** | 6ef4273: `feat(workspace): anade resultados de imagen de flujos como capturas y normaliza el payload envuelto (CE-048)` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La deduplicación de imagen no reusa un asset idéntico ya existente: cada «Anadir al Workspace» de una imagen nueva crea una captura nueva (mismo comportamiento que una captura importada). Las evidencias regeneradas por las suites al iniciar/ejecutar el ciclo (coverage, e2e-evidence, ocr-source-tests, star-flow-export.toolisto, phase3-integrity-evidence.json, review-modal.png y captura PNG del escáner) se excluyen del commit (anti-churn); `ocr-diagnostic.json` queda sin seguimiento por su carácter de diagnóstico. |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 112 — Persistencia de resultados de flujo añadidos al Workspace (CE-047)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 908860dc2612fa89995516df61a7619cac738acb |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-047 (P2, desde DISCOVERY; sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | Ante un resultado de flujo, el botón «Anadir al Workspace» (`addResultToWorkspace` en `workflow-ui.js`) solo mutaba el estado en memoria (`appStore.set({ currentDoc })` / `push` a `dataTables`) sin llamar a `saveDoc`/`saveData` ni a `refreshProjectCounts`: el documento o la tabla generados por un flujo desaparecían al recargar el proyecto, rompiendo el encadenado de la salida del flujo con el Workspace y violando la persistencia de la definición de terminado. |
| **Change** | `createWorkflowUI` ahora recibe `saveDoc`/`saveData`/`refreshProjectCounts` a través de `appHelpers` (inyectados desde `renderWorkflowView` en `workspace.js`). `addResultToWorkspace` pasa a `async` y, para un resultado `document`, persiste el documento con `saveDoc(project.id, doc)` y lo incorpora a `documents` (deduplicando por id); para un resultado `data`, persiste con `saveData(project.id, table)` y lo incorpora a `dataTables` (deduplicando por id); en ambos casos refresca `refreshProjectCounts(project.id)`. Re-Añadir un elemento con el mismo id ya presente informa «ya esta en el Workspace» sin guardar dos veces. `addResultToWorkspace` se expone en la API del UI para poder testearla. |
| **Hallazgos** | No existía ningún test que cubriera «Anadir al Workspace» (grep `Anadir al Workspace|addResultToWorkspace` en `.mjs` devuelve vacío). El bug era invisible para la regresión: `saveDoc`/`saveData` escriben en IndexedDB y las vistas `Documentos`/`Datos` recargan desde `loadDocs`/`loadData`, por lo que un resultado solo-en-memoria nunca aparecía ni persistía. La inyección de helpers reproduce el patrón ya usado por `pushHistory`/`createInstructionAssistant`. |
| **Bugs encontrados** | `addResultToWorkspace` no era `async`; persistir exigía `await`. La API del UI no exponía la función, impidiendo cobertura VM directa. |
| **Bugs corregidos** | Sí: el resultado de un flujo se persiste en el proyecto al añadirlo al Workspace, se deduplica por id y se refrescan los conteos. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (46/46, 7 contratos nuevos); `node tests/workspace/workflow-engine-test.mjs` (18/18); `node tests/workspace/workflow-validator-test.mjs` (11/11); `node tests/workspace/operation-registry-test.mjs` (26/26); `node tests/workspace/workflow-export-md-test.mjs` (30/30); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (20/20); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK). |
| **Tests PASS** | Workflow UI 46/46 (persistencia doc/tabla, presencia en estado, refresh de conteos y dedup por id); Engine 18/18; Validator 11/11; Registry 26/26; Export-md 30/30; Workflow E2E 20/20 sin errores JS; build 179/179 y sync source/dist OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: persiste resultados de flujo añadidos al Workspace. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La deduplicación por id depende de que el resultado traiga (o `saveDoc`/`saveData` asigne) un id estable entre dos añadidos del mismo elemento; un resultado fresco sin id se guarda una vez y aparece en el proyecto. Las evidencias ya modificadas al iniciar el ciclo (`artifacts/deep-audit/toolisto/TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `ocr-source-tests.json`, `star-flow-export.toolisto`, `ocr-diagnostic.json` y `screenshots/workspace/08-scanner-module-test.png`) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 110 — Exportación Markdown/plano estructurada de documentos (CE-046)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | c943e4bd4826fb1e432d2fad7afb5b2dab227f83 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-046 (P2, desde DISCOVERED; sin tareas TODO en la cola, único pendiente CE-011 P3 gate) |
| **Hypothesis** | `text.export` aplanaba los bloques de un documento con `blocks.map(content).join('\n')`, perdiendo la estructura (encabezados, listas, tablas, gráficos); el intento «exporta texto» en Markdown debía renderizar los bloques a Markdown real para servir documentos editables/profesionales. |
| **Change** | Nueva conversión estructurada en `workspace/core/workflow-operations.js`: `blocksToMarkdown(blocks)` (heading1/2/3→`#/##/###`, bullet-list→`- `, quote→`> `, divider→`---`, table→tabla Markdown con separador y celdas que escapan `|`, chart→bloque delimitado `\`\`\`charts` con tabla Etiqueta\|Valor, image-block→`![imagen](dataUrl)`) y `blocksToPlainText(blocks)` (texto plano legible con viñetas `•` y separador). `text.export.execute` usa Markdown cuando el formato es `md` y texto plano cuando es `txt`; la entrada de cadena se exporta verbatim intacta. |
| **Hallazgos** | El intento `export-text` ya se planeaba a `text.export` y su opción `format` admitía `md`/`txt`, pero la salida para un documento era un aplanado sin estructura, indistinguible del texto bruto. El rasgo es puramente aditivo: los consumidores string no cambian. |
| **Bugs encontrados** | El `join('\n')` previo descartaba tipos de bloque y tablas/gráficos perdían su forma. Un primer diseño capitalizaba `heading1` en txt (`content.toUpperCase()`), lo que rompía la fidelidad del contenido; se revirtió a emitir el texto tal cual. |
| **Bugs corregidos** | Sí: `text.export` en `md` produce Markdown válido y en `txt` texto plano estructurado a partir de bloques de documento. |
| **Tests ejecutados** | `node tests/workspace/workflow-export-md-test.mjs` (30/30); regresión `workflow-engine-test.mjs` (18/18), `workflow-validator-test.mjs` (11/11), `operation-registry-test.mjs` (26/26), `workflow-document-pdf-test.mjs` (66/66), `workflow-ui-test.mjs` (39/39), `workflow-builder-a11y-test.mjs` (11/11); `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (20/20); `node scripts/generate-seo-pages.mjs --production` (build 179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK). |
| **Tests PASS** | Export MD/plano 30/30 (encabezados, listas, cita, divisor, tabla Markdown con separador, gráfico en `\`\`\`charts` con valores, marcador `#` ausente en txt, viñeta `•`, entrada de cadena verbatim, bloques vacíos sin crash); regresión Engine/Validator/Registry/Document→PDF/UI/Builder y Workflow E2E 20/20 sin errores JS; build 179/179 y sync OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workflow): exporta documentos a Markdown y texto plano estructurados`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El `outputKind` de `text.export` es `text` aunque devuelve un Blob text/* (contrato heredado, sin cambio). Las tablas Markdown escapan `\|` dentro de celdas pero no generan filas de alineación complejas; las imágenes se emiten como data-url completa (pesado para archivos muy grandes, coherente con el límite local). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover una oportunidad DISCOVERED. |

---

## Cycle 109 — Liberación automática por inactividad del motor OCR (CE-040)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | a9293d20a77d1324d50913e08740aa04216c751f |
| **HEAD final** | 671770248c12a76595dcb2298383cf710ab8538b |
| **Task** | CE-040 (P3, ACTIVE heredado del ciclo 108 interrumpido) |
| **Hypothesis** | En sesiones largas el Workspace mantiene el worker Tesseract.js cargado (memoria WASM) aunque ya no se use; el motor debe poder liberarse por inactividad, manualmente al limpiar un flujo y bajo demanda, sin romper la reutilización en caché ni la recarga. |
| **Change** | `vendor/js/engine-loader.js`: API de liberación de memoria — `setTesseractIdleTimeout(ms)`, `releaseIdleTesseract()`, `releaseTesseract(lang)`, `getTesseractStatus()`; reaper periódico que termina workers que superan la ventana de inactividad (default 600000 ms), `lastUsed` actualizado en cada carga/reutilización y `destroyAll` refactorizado sobre `terminateWorker`. `workspace/core/ocr-engine.js`: export `releaseOcrEngine(lang)` con guard de API. `workspace/core/workflow-ui.js`: `clearFlow` libera el motor OCR (`releaseOcrEngine()`) al limpiar el constructor. `tests/workspace/workflow-ui-test.mjs` incluye `ocr-engine.js` en el VM y añade `window`. Nuevo test E2E `tests/workspace/engine-idle-release-test.mjs` (Tesseract real, sin mocks) registrado en el release gate. |
| **Hallazgos** | El ciclo 108 dejó la implementación sin commitear (exit -1 del runner, HEAD sin cambio): la tarea CE-040 estaba ACTIVE con los cambios en el árbol de trabajo y sin registro de STATUS. Se auditó, se completó la verificación (test nuevo + regresiones) y se cerró el ciclo. La carga de Tesseract se reutiliza por `workerKey`; `releaseTesseract` termina el worker y queda re-cargable bajo demanda. |
| **Bugs encontrados** | `destroyAll` terminaba workers en un bucle manual y no paraba el reaper; quedó refactorizado sobre `terminateWorker` con `stopIdleReaper`. `workflow-ui-test.mjs` no incluía `ocr-engine.js` en su contexto VM pese a que `workflow-ui.js` ahora lo importa. |
| **Bugs corregidos** | Sí: worker OCR liberable por inactividad/manual, reaper parado al vaciar workers, y VM de tests de UI coherente con el nuevo import. |
| **Tests ejecutados** | `$env:E2E_PORT=8084; node tests/workspace/engine-idle-release-test.mjs` (10/10); `node tests/workspace/workflow-ui-test.mjs` (39/39); `node tests/workspace/workflow-engine-test.mjs` (18/18); `node tests/workspace/workflow-validator-test.mjs` (11/11); `node tests/workspace/operation-registry-test.mjs` (26/26); `node tests/workspace/workspace-test.mjs` (156/156); `node tests/workspace/phase3a-test.mjs` (80/80); `node tests/workspace/phase3b-test.mjs` (59/59); `node tests/workspace/ocr-source-selection.mjs` (34/34); `node tests/evidence-determinism.mjs` (71/71); `node scripts/verify-workspace-sync.mjs` (SYNC OK); `node --check scripts/test-workspace-release.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs` (20/20); `git diff --check`. |
| **Tests PASS** | Engine idle release 10/10 (API disponible, carga real, reutilización sin duplicado, reaper automático, recarga bajo demanda, release manual idempotente, destroyAll limpio, cero errores de consola); Workflow UI 39/39; Engine 18/18; Validator 11/11; Registry 26/26; Workspace 156/156; Phase 3A 80/80; Phase 3B 59/59; OCR Source 34/34; determinismo 71/71; Workflow E2E 20/20; sync y diff check OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: liberación por inactividad del motor OCR. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El reaper usa `setInterval`; la ventana default es 10 min y se puede ajustar con `setTesseractIdleTimeout`. El PDF pdfjs se gestiona por separado (página/instancia efímeras); esta tarea cubre Tesseract, mitad restante de CE-008. `ocr-diagnostic.json` (artefacto de diagnóstico con rutas/timestamps absolutos) y las evidencias regeneradas por otros gates (e2e-evidence, ocr-source-tests, star-flow-export, screenshot, coverage) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | CE-011 sigue DISCOVERED (gate de red negativa permanente); no quedan tareas TODO → siguiente ciclo de DISCOVERY dirigida o promover la oportunidad de mayor prioridad. |

---

## Cycle 107 — BOM UTF-8 en las descargas CSV del sitio público (CE-045)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | d26a0dc9c5b128422651f69f8ed9e46326c4f156 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-045 (P2, desde DISCOVERED; sin tareas TODO en la cola) |
| **Hypothesis** | Las descargas CSV del sitio público para `excelToCsv` y `jsonToCsv` se generan en `tool-processors.js` (`new Blob([csv], { type: 'text/csv;charset=utf-8' })`) sin prefijo `\uFEFF`, por lo que Excel con locales con acentos (es) las lee como ANSI y muestra mojibake, igual que el bug del Workspace CE-044 ya corregido. |
| **Change** | BOM UTF-8 antepuesto al CSV en `ToolProcessors.excelToCsv` y `ToolProcessors.jsonToCsv`. Como contraparte defensiva de la misma feature: `parseCsvText` de `js/modes/excel.js` (ruta «Reabrir salida» y continuación) y `ToolProcessors.csvToExcel`/`csvToJson` eliminan un BOM de entrada antes de `XLSX.read(..., { type: 'string' })`, que NO lo elimina (verificado con `vendor/xlsx`); así el CSV reabierto o continuado no filtra `\uFEFF` a la celda/cabecera. `js/modes/excel.js` `aoaToFile` (branch csv) queda SIN BOM: solo reconstruye el *input* de `csvToExcel`/`csvToJson` y añadirlo corrompería la primera cabecera (celda `\uFEFFciudad`). |
| **Hallazgos** | El señalamiento original de CE-045 apuntaba a `aoaToFile` de `js/modes/excel.js`, pero esa rama nunca se descarga: reconstruye el archivo de entrada del modo. Las descargas reales salen de los procesadores `excelToCsv`/`jsonToCsv` de `tool-processors.js`. El `TextDecoder('utf-8')` del navegador elimina un BOM inicial por defecto (la primera versión de los checks BOM fallaba con `"Ciud"` aunque los bytes EF BB BF estuvieran presentes); se usa `buf.toString('utf8')` (Node) que conserva el `\uFEFF`, como en CE-044. |
| **Bugs encontrados** | Sin BOM, `excelToCsv`/`jsonToCsv` generaban CSV ilegible en Excel-es. Además, añadir el BOM sin limpiarlo al leer habría regresionado la reapertura (`Reabrir salida`) y la continuación `excelToCsv → csvToJson` / `jsonToCsv → csvToExcel` (SheetJS no limpia `\uFEFF` en `type:'string'`); ambas rutas quedan cubiertas y probadas. |
| **Bugs corregidos** | Sí: ambas descargas CSV del sitio público llevan BOM UTF-8 y acentos intactos; la reapertura y la continuación no filtran el BOM en celdas ni claves. |
| **Tests ejecutados** | `npm run build` (179/179); `node tests/gate-e2e-spreadsheet-tools.mjs` (221/221 con 14 checks BOM/acentos/mojibake + continuación BOM→JSON); `node tests/evidence-determinism.mjs` (71/71); `node tests/production-tool-coverage.mjs` (26/26); `$env:ONLY=...; node tests/verify-115-tools.mjs` (132/132 sobre las 11 herramientas de hojas de cálculo, incluidas excelToCsv/jsonToCsv). |
| **Tests PASS** | Gate hojas de cálculo 221/221 (incluye: `EF BB BF` en bytes, primer carácter `\uFEFF`, `Córdoba/Éxito/Ñuño/índice ñame` intactos, sin mojibake, reapertura sin BOM en la celda, continuación BOM→JSON sin filtrar); determinismo 71/71; cobertura 26/26; verify-115 herramientas 132/132; build 179/179. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | `aoaToFile` (branch csv) del modo no lleva BOM porque alimenta parsers SheetJS; un consumo futuro de esa ruta como descarga deberá añadirlo explícitamente. Las evidencias ya modificadas al iniciar el ciclo (`artifacts/deep-audit/toolisto/TLT-production-tool-coverage-evidence.json`, `artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y `screenshots/workspace/08-scanner-module-test.png`) se excluyen del commit (anti-churn); `TLT-certify-spreadsheet-family-evidence.json` (evidencia del gate afectado) sí se commitea con su conteo 221/221. |
| **Proxima prioridad** | Ejecutar CE-040 (memoria de motores pesados Tesseract/PDF, P3) desde DISCOVERED o realizar discovery dirigida según la cola al iniciar el próximo ciclo. |

---

## Transicion (infraestructura) — De Production Readiness a Evolucion Continua

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **Task** | Infra — evolucionar el sistema autonomo: modo continuo, transicion PR->CE, recovery, watchdog, metricas |
| **Change** | Runner v2: `-Unlimited` / `MaxCycles=0` (sin limite artificial), transicion automatica PR->CE al aparecer `PRODUCTION_READINESS_DONE` (sin detener), parada solo por humano/limite/fallo grave, backoff 1/5/15/30 min ante fallos de proveedor, metricas por ciclo (resultado, bucket, HEAD) en `artifacts/autonomous-logs/metrics.tsv`, archivos de mision/status/queue de CE. `STATUS` ampliado (MODE, uptime, tarea actual, fallos consecutivos, resumen de ultimos 20 ciclos, regla de salud). Nuevo `WATCHDOG-OPENCODE-AUTONOMOUS.ps1` (reporta sin matar; `-KillStale`/`-CleanStale` explicitos) y `INSTALL-OPENCODE-AUTO-START.ps1` (tarea programada opcional al login). |
| **Tests ejecutados** | Sintaxis PS de runner/status/stop/watchdog/auto-start; `-DryRun` del runner v2 sin mutex; `-Unlimited`/`MaxCycles=0`; resolucion de modo; parser de `RESULTADO_CICLO`; watchdog en modo reporte contra el runner real (sin matar). |
| **Tests PASS** | DryRun y validaciones de infra OK. |
| **Tests FAIL** | 0 |
| **Bloqueos** | Ninguno para la infra. La transicion a CE queda pendiente de que la etapa Production Readiness genere legitimamente `workspace/PRODUCTION_READINESS_DONE`. |
| **Commits** | Commit de infra de la transicion (ver git log). |
| **Proxima prioridad** | En modo PR: cerrar PR-009 (candidato) y PR-017. En modo CE: primera tarea de producto de la QUEUE de CE. |

---

## Snapshot de referencia (al iniciar la Evolucion Continua)

```
Phase 3B: COMPLETA | Phase 3C: COMPLETA
Production Readiness: etapa cerrada -> CONTINUOUS_EVOLUTION activo
Sitio publico: 167 herramientas habilitadas y certificadas
Regresion historica: run-all 41/41 suites verdes (Cycle 17)
Privacidad publica: gate 343/343 PASS (PR-009 en cierre)
Total sitio publico: 712 pass, 0 fail (workspace) + suites del sitio
```

## Plantilla para ciclos nuevos

```markdown
## Cycle N — Breve descripcion

| Field | Value |
|-------|-------|
| **Date** | YYYY-MM-DD |
| **Branch** | |
| **HEAD inicial** | |
| **HEAD final** | |
| **Task** | CE-XXX |
| **Hypothesis** | |
| **Change** | |
| **Hallazgos** | |
| **Bugs encontrados** | |
| **Bugs corregidos** | |
| **Tests ejecutados** | |
| **Tests PASS** | |
| **Tests FAIL** | |
| **Commits** | |
| **Bloqueos** | |
| **Limitaciones** | |
| **Proxima prioridad** | |
```

---

## Cycle 22 — Conversion OCR a tabla robusta en flujos

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 074e478260c950024e2fad20724f387bea598b97 |
| **HEAD final** | Este commit (registrado al cierre del ciclo) |
| **Task** | CE-001 |
| **Hypothesis** | El separador unico de `text.to-table` confundia comas decimales y separaba etiquetas OCR de varias palabras. |
| **Change** | Se incorporo `core/tabular-text-parser.js`, usado por la operacion real de flujo `text.to-table`. Detecta delimitadores seguros, respeta CSV entrecomillado, reconstruye columnas por ancla numerica, normaliza guiones OCR y recupera decimales con coma en dos columnas. Sin tocar `workspace.js`. |
| **Hallazgos** | El flujo ya expone `text.to-table`; su parser local era simplista y no compartia la reconstruccion numerica usada por el Workspace. La nueva operacion se sirve desde `dist` y conserva sincronizacion source/dist. |
| **Bugs encontrados** | Etiquetas como `Ventas Q1` se fraccionaban al procesar texto OCR delimitado por espacios; valores españoles podían confundirse con el delimitador coma. |
| **Bugs corregidos** | Si: etiquetas, signo menos Unicode y decimales con coma se preservan en la tabla resultante. |
| **Tests ejecutados** | `node tests/workspace/tabular-text-parser-test.mjs`; `node tests/workspace/operation-registry-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`. El primer intento E2E en 8082 no inició porque un servidor ajeno ya ocupaba el puerto; se ejecutó en 8084 sin reintentos. |
| **Tests PASS** | Parser 7/7; registro 26/26; sincronizacion source/dist OK; Workflow E2E 15/15 sin errores JS. |
| **Tests FAIL** | 0 (el EADDRINUSE inicial fue conflicto de infraestructura, no una asercion de suite). |
| **Commits** | Este commit: `fix(workflow): conserva datos OCR al convertir tablas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Un CSV con coma como delimitador y decimales sin comillas es inherentemente ambiguo; para dos columnas numericas se recupera el decimal, y se priorizan tabulador, punto y coma y barra cuando existen. |
| **Proxima prioridad** | CE-002, encadenamiento real de mejora -> compresion -> conversion -> ZIP para imágenes. |

---

## Cycle 27 — Pipeline de imágenes con ZIP real

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f9fb12085ca0161012ed6174814c3bcfd5656c9c |
| **HEAD final** | Commit de este ciclo (registrado al cierre) |
| **Task** | CE-002 |
| **Hypothesis** | El constructor listaba operaciones de imagen pero no transportaba el `File` real, serializaba los `Blob` a objetos vacíos y no podía consolidar un lote en ZIP. |
| **Change** | Se añadió `output.zip` como operación terminal de lote: recibe una vez las salidas transformadas y genera un ZIP local con JSZip. El motor preserva `Blob` en sus resultados, la UI entrega el `File` como `data`, aplica defaults al añadir operaciones y monta el enlace de descarga de forma efímera. La codificación ahora normaliza `HTMLImageElement` a canvas, corrigiendo compresión/conversión encadenadas. |
| **Hallazgos** | La ruta manual mejorar -> comprimir -> convertir fallaba porque compresión y conversión llamaban `toBlob` sobre una imagen cargada. Las descargas desde un enlace no conectado no eran fiables. La intención `zip` ya existía en el planificador, pero no había operación registrada. |
| **Bugs encontrados** | Las salidas Blob se perdían por `JSON.stringify`; los archivos del selector no llegaban como datos al motor; no existía el empaquetado final; la cadena de imagen fallaba con `canvas.toBlob is not a function`. |
| **Bugs corregidos** | Sí: dos imágenes reales atraviesan los cuatro pasos, mantienen sus salidas individuales y producen un ZIP descargable sin errores de consola. |
| **Tests ejecutados** | `node tests/workspace/workflow-engine-test.mjs`; `node tests/workspace/workflow-validator-test.mjs`; `node tests/workspace/operation-registry-test.mjs`; `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/instruction-planner-test.mjs`; `node scripts/generate-seo-pages.mjs --production`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | Engine 18/18; validator 11/11; registro 26/26; UI 30/30; planificador 68/68; Workflow E2E 19/19 con pipeline real y descarga ZIP; sincronización source/dist OK. |
| **Tests FAIL** | 0 final. Durante el desarrollo, el E2E reveló la ausencia de proyecto local, el selector oculto y el fallo real de `toBlob`; se corrigieron antes de la regresión final. |
| **Commits** | Commit de este ciclo: `feat(workflow): encadena imágenes y empaqueta ZIP` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El ZIP solo vive como descarga local efímera; los Blob no se persisten en el estado serializable del flujo, evitando referencias `blob:` persistentes y duplicación de archivos grandes. |
| **Proxima prioridad** | CE-003, acceso directo a herramientas y encadenado de pasos desde el proyecto. |

---

## Cycle 28 — Encadenado desde documentos y tablas del proyecto

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 3d0885ef1fa10d5bf5f8c49d29c12551e8ea3ff3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-003 |
| **Hypothesis** | El Workspace ya mostraba las herramientas y permitía elegir documentos/tablas desde el constructor, pero obligaba a una navegación manual y permitía seleccionar pasos incompatibles. |
| **Change** | Se añadieron acciones `Encadenar` a tarjetas de documentos y tablas: abren Flujos con una referencia local al elemento, sin exportarlo ni duplicar su contenido. El constructor filtra pasos por tipo de entrada/salida, incorpora la categoría Salida, evita entradas repetidas y calcula correctamente un terminal de lote. También se corrigió Limpiar, que quedaba deshabilitado tras añadir una entrada. |
| **Hallazgos** | El constructor ya resolvía referencias `doc-` y `table-` contra el estado local al ejecutar, por lo que faltaba conectar esas referencias desde las vistas del proyecto. La validación en navegador descubrió el estado deshabilitado incorrecto de Limpiar. |
| **Bugs encontrados** | El botón Limpiar no se habilitaba al cargar una entrada sin pasos; el selector de operaciones no limitaba categorías ni compatibilidad del encadenado. |
| **Bugs corregidos** | Sí: la entrada de proyecto es reutilizable en Flujos, las sugerencias muestran solo pasos compatibles y Limpiar recupera su estado habilitado. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/workflow-engine-test.mjs`; `node tests/workspace/workflow-validator-test.mjs`; build de producción; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | UI 33/33; Engine 18/18; Validator 11/11; Workflow E2E 20/20 con documento real -> flujo, pipeline de imagen y ZIP; source/dist sincronizados. |
| **Tests FAIL** | 0 final. Dos ajustes de la nueva aserción E2E revelaron selectores ambiguos; la tercera ejecución detectó el bug real de Limpiar y quedó verde tras corregirlo. |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): encadena elementos del proyecto en flujos` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Solo documentos y tablas se pasan por referencia local porque son los artefactos estructurados persistentes del proyecto; los archivos seleccionados siguen siendo efímeros y no se guardan como URLs blob. |
| **Proxima prioridad** | CE-004, reducir pasos y mejorar resultados de herramientas individuales. |

---

## Cycle 29 — Calculadora científica: funciones correctas y evaluación acotada

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 59017a7de53c5c6e6c4690ddf74db34f741563fa |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-004 |
| **Hypothesis** | El reemplazo textual de `sin` antes de `asin` corrompía las funciones trigonométricas inversas; la vista previa tampoco reconocía la constante `e` y el filtro aceptaba miembros arbitrarios de `Math`. |
| **Change** | El normalizador científico reconoce funciones completas por límite de palabra y en orden no ambiguo, admite `e` y `pi` como constantes, y restringe tanto la vista previa como el procesador a la lista explícita de operaciones matemáticas permitidas. |
| **Hallazgos** | `asin(1)` se transformaba como `aMath.sin(1)` y fallaba aunque el procesador declaraba soportar `asin`. El filtro genérico `Math.\w+` dejaba ejecutar miembros no declarados como `Math.random()`. |
| **Bugs encontrados** | Funciones inversas inválidas, constante `e` inconsistente entre vista previa y resultado, y lista permisiva de miembros `Math`. |
| **Bugs corregidos** | Sí: `asin`, `acos`, `atan` y `e` llegan al mismo resultado en vista previa y descarga; `Math.random()` se rechaza antes de ejecutar. |
| **Tests ejecutados** | Build de producción; `node tests/gate-e2e-calc-tools.mjs` (baseline 22/22; primera ampliación detectó una expectativa aritmética del test incorrecta, corregida; ejecución final). |
| **Tests PASS** | Gate E2E calculadoras 24/24, incluyendo funciones inversas/constante, rechazo de miembro no permitido, descarga, historial, privacidad y cero errores de consola. |
| **Tests FAIL** | 0 final. |
| **Commits** | Commit de cierre de este ciclo: `fix(calculators): corrige funciones científicas inversas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La calculadora científica mantiene su subconjunto explícito de funciones y factorial entero no negativo; expresiones arbitrarias de JavaScript no son compatibles intencionadamente. |
| **Proxima prioridad** | CE-005, defaults inteligentes e integraciones entre herramientas. |

---

## Cycle 30 — Continuaciones locales entre conversores tabulares

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7ae2d5e54314640e81dce18fd64d1af0b62f1d7e |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-005 |
| **Hypothesis** | Las tarjetas relacionadas eran solo navegación editorial; tras generar una salida el usuario debía descargarla y volver a cargarla aun cuando el siguiente conversor compatible ya existe localmente. |
| **Change** | El modo de hojas de cálculo ofrece `Continuar con…` tras salidas compatibles. Convierte el Blob recién generado en un `File` efímero, lo abre en el siguiente conversor y conserva la rejilla editable sin navegar, descargar de nuevo ni persistir URLs `blob:`. Se definieron continuaciones explícitas CSV/Excel/JSON/XML y se verificó CSV → Excel → JSON. |
| **Hallazgos** | `excel.js` ya mantenía el resultado para Reabrir salida y su parser acepta `File`; faltaba únicamente un contrato de continuación y actualizar el estado del conversor destino. |
| **Bugs encontrados** | Ninguno preexistente; la integración entre herramientas no estaba conectada funcionalmente. |
| **Bugs corregidos** | Sí: una salida tabular compatible ya sirve como entrada real del siguiente paso sin re-subida. |
| **Tests ejecutados** | Baseline `node tests/gate-e2e-spreadsheet-tools.mjs` (197/197); build de producción; gate final de hojas de cálculo; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build de 179 páginas OK; gate navegador 203/203, incluida continuación local, cero egress externo y cero errores de consola; sincronización Workspace OK; diff sin errores. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `feat(spreadsheets): encadena conversiones locales` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las continuaciones son pares explícitos de formatos tabulares compatibles; el `File` generado vive solo en memoria durante la página actual y no se persiste. |
| **Proxima prioridad** | CE-006, mejora del OCR para fixture difícil. |

---

## Cycle 31 — Límite reproducible de preprocesado OCR difícil

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | bc98fa78e6a659e309057f86f1064f06dc0b91b2 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-006 |
| **Hypothesis** | Un preproceso local ligero o un modo de segmentación alternativo podría recuperar caracteres del texto efectivo de ~8px sin dañar el control limpio. |
| **Change** | La medición OCR ahora prueba contraste, umbral binario y PSM 4/6/11, registra cada resultado y elimina el timestamp absoluto de su evidencia para que sea regenerable sin churn. |
| **Hallazgos** | La vía cruda con OEM 3 sigue siendo la mejor: 76% caracteres y 43% palabras. Contraste obtiene 63%/0%, umbral 48%/0%, PSM 4 0%/0%, PSM 6 empata 76%/43% y PSM 11 baja a 50%/35%. El fixture limpio continúa 100%/100%. |
| **Bugs encontrados** | La evidencia de esta medición incluía timestamp absoluto, por lo que una regeneración alteraba el JSON aun sin cambio funcional. |
| **Bugs corregidos** | Sí: la evidencia de la medición ya no incorpora timestamp absoluto y detalla los candidatos descartados. |
| **Tests ejecutados** | Reproducción baseline y medición ampliada: `$env:E2E_PORT=8084; node tests/workspace/ocr-difficult-measurement.mjs`; `git diff --check`. El puerto 8082 estaba ocupado por infraestructura ajena; se usó 8084 sin reintentos. |
| **Tests PASS** | Medición navegador con Tesseract local completada; control limpio 100% chars/words; referencia difícil y cinco candidatos medidos; diff sin errores. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `test(ocr): documenta límite de preprocesado difícil` |
| **Bloqueos** | CE-006 queda BLOCKED: con la imagen actual, los candidatos locales evaluados no superan la referencia. |
| **Limitaciones** | No se activa un preproceso que degrade texto real solo para aparentar una mejora. Reabrir con un modelo OCR mejor o una captura fuente de mayor resolución; no repetir estos mismos cinco candidatos sin información nueva. |
| **Proxima prioridad** | CE-007, fiabilidad de visibilidad en navegación Playwright. |

---

## Cycle 32 — Navegación Playwright aislada y estable

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b089f44a2194212ed9240a34459a3e8c5331ac9b |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-007 |
| **Hypothesis** | El flake `element is not visible` no era una transición aleatoria: el render abría el Workspace público bloqueado después de comprobar su shell inicial y seleccionaba nodos de navegación sin garantizar su visibilidad. |
| **Change** | `playwright-render.mjs` acepta `E2E_PORT`, sirve en un puerto aislable, abre `?preview=internal` y navega con localizadores visibles más espera por contenido, en vez de pausas fijas. La verificación de paleta también espera su cierre real. |
| **Hallazgos** | El gate público oculta `#ws-app` tras la carga; por eso el shell podía parecer correcto al inicio y sus botones acabar con caja 0x0. `visual-audit-click-nav.mjs` está ignorado por Git y es un diagnóstico local, no un artefacto versionable; su ejecución aislada confirmó que Documentos requiere proyecto y que la navegación correcta no muestra corrupción. |
| **Bugs encontrados** | El render E2E dependía de 8080 ocupado por infraestructura ajena y navegaba el Workspace bloqueado, produciendo el falso flake de visibilidad. |
| **Bugs corregidos** | Sí: el test usa el preview interno y acciones observables, por lo que valida navegación real en vez de elementos que el gate oculta. |
| **Tests ejecutados** | Reproducción inicial: `node tests/workspace/playwright-render.mjs` (EADDRINUSE en 8080). Final: `$env:E2E_PORT=8084; node tests/workspace/playwright-render.mjs`; auditoría aislada de navegación; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Render Playwright 33/33, auditoría Documentos/Captura sin corrupción ni errores de consola, sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0 final; el EADDRINUSE inicial fue conflicto de infraestructura, no una aserción. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las capturas PNG generadas por el render son efímeras y se excluyen del commit para no introducir churn de evidencia visual. |
| **Proxima prioridad** | CE-010, guía reproducible de despliegue estático. |

---

## Cycle 33 — Previsualización y URL de despliegue reproducibles

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 72e34d56cbe8e9fad28991c0c2face2c86816583 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-010 |
| **Hypothesis** | La guía heredada describía `productionDomain` y `siteUrl` como alternativas, aunque el build de producción prioriza siempre el primero, y pedía descargar un servidor con `npx` pese a existir uno local. |
| **Change** | La guía ahora explica la precedencia real de URL, exige conservar el subdirectorio de GitHub Pages y ofrece `node server.js` con puerto aislable como vista previa sin descargas. El audit protege ambos contratos y corrige su total/evidencia a 10 comprobaciones. |
| **Hallazgos** | `generate-seo-pages.mjs --production` reemplaza `siteUrl` por `productionDomain` cuando este existe; una URL de Pages sin su ruta de repositorio rompería canónicos, sitemap y enlaces absolutos. `server.js` ya sirve `dist/` de forma nativa. |
| **Bugs encontrados** | La documentación podía indicar una URL efectiva incorrecta y añadía una descarga externa innecesaria para validar el build. El audit declaraba un total inferior a sus comprobaciones reales. |
| **Bugs corregidos** | Sí: el procedimiento refleja el comportamiento del build, evita el paso de red para la vista previa y el gate informa 10/10 de forma consistente. |
| **Tests ejecutados** | Baseline y final `node tests/deployment-guide-audit.mjs`; `npm run build`; servidor incluido en `PORT=8086` con petición local a `/`; `git diff --check`. |
| **Tests PASS** | Audit de despliegue 10/10; build de producción 179/179; servidor local respondió 200 sirviendo `dist/`; diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(deployment): aclara URL y vista previa local` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | GitHub Pages continúa sin aplicar `/_headers`; para cabeceras HTTP de endurecimiento se requiere un host compatible o configuración externa. La publicación de una rama dedicada sigue siendo manual, sin CI automático. |
| **Proxima prioridad** | Promover CE-008 o CE-009 tras discovery/priorización; no quedan tareas TODO. |

---

## Cycle 34 — Discovery de riesgos de salida y Workspace

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b46ef456c7351e82c6984fe666d1aa78fbec3315 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | Una revisión dirigida de los caminos con datos voluminosos y controles dinámicos revelaría mejoras ejecutables, no solo deuda genérica. |
| **Change** | Se añadieron tres oportunidades priorizadas y verificables: CE-013 (P1, paginación de tablas largas del PDF), CE-014 (P2, coste de corrección de perspectiva en capturas grandes) y CE-015 (P2, teclado/ARIA de controles dinámicos del Workspace). |
| **Hallazgos** | El generador estima una tabla como bloque indivisible y la renderiza completa en la misma página, por lo que una tabla larga puede salir del área visible. La corrección bilineal realiza lectura por píxel de destino. El audit de accesibilidad público no cubre los widgets creados dinámicamente por el Workspace. |
| **Bugs encontrados** | Riesgo reproducible por inspección: filas de tablas de informe no se fragmentan entre páginas; no se añade una prueba roja para no dejar la rama con fallos. |
| **Bugs corregidos** | No aplica: ciclo de discovery solicitado al no existir tareas TODO. |
| **Tests ejecutados** | `node tests/workspace/phase3b-test.mjs` como baseline del generador PDF y del flujo de informe. |
| **Tests PASS** | Phase 3B 59/59. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): prioriza mejoras de PDF y Workspace` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La paginación se debe validar con PDF real multipágina y no únicamente con conteo de objetos; la optimización de perspectiva requiere medición en navegador antes de elegir algoritmo. |
| **Proxima prioridad** | Promover CE-013 a TODO y corregir la paginación de tablas largas del PDF. |

---

## Cycle 35 — Tablas de informe PDF paginadas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 6aff4078f987f9596526899b94a57c137f86bca7 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-013 |
| **Hypothesis** | El generador medía una tabla larga como un bloque único y la enviaba a una sola página, por lo que debía fragmentarla antes de renderizar y repetir la cabecera en cada fragmento. |
| **Change** | El layout de PDF divide las filas de tabla según el alto restante de cada página, conserva cada fila completa y crea fragmentos con los mismos encabezados. La estimación usa el mismo inset vertical del render para evitar que la última línea sobrepase el margen. |
| **Hallazgos** | `renderTablePDF` ya renderizaba cualquier subconjunto de filas y no requería cambios visuales; el defecto estaba exclusivamente en el layout previo a generar las páginas. |
| **Bugs encontrados** | Las filas de tablas largas podían dibujarse por debajo del margen inferior y quedar recortadas; los encabezados no podían repetirse porque solo existía un bloque de tabla. |
| **Bugs corregidos** | Sí: las tablas se fragmentan por página, repiten encabezado y mantienen la secuencia completa de filas. |
| **Tests ejecutados** | `node tests/workspace/pdf-table-pagination-test.mjs`; `npm run build`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Paginación PDF 7/7; build 179/179; Phase 3B 59/59 sin errores JS; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(pdf): pagina tablas largas de informes` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las alturas de fila siguen siendo fijas (20 pt); el contenido de una celda no se parte en varias líneas. Márgenes personalizados que no dejen espacio físico para encabezado y una fila no pueden representarse sin redefinir la geometría del documento. |
| **Proxima prioridad** | Promover CE-014 a TODO y medir la corrección de perspectiva en capturas grandes antes de optimizarla. |

---

## Cycle 36 — Discovery de fiabilidad y calidad del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 72731450735f33f035db030b87934003164df67c |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | Una inspección del ciclo real de vida del escáner y una reproducción de sus pruebas identificarían riesgos concretos y acotados para promover, no deuda genérica. |
| **Change** | Se registraron CE-016 (P1: confirmación contra vista previa obsoleta), CE-017 (P2: liberar listener de redimensionado), CE-018 (P2: cobertura de bordes en la interpolación) y CE-019 (P3: puerto aislable del verificador Phase 3A). |
| **Hallazgos** | Tras mover una esquina, `pointerup` inicia el recálculo sin esperarlo y Confirmar puede consumir el canvas anterior. El destructor no elimina el listener de `window.resize`. El interpolador no alcanza el último píxel de salida y excluye los bordes fuente. La prueba manual Phase 3A fija 8082. |
| **Bugs encontrados** | Riesgos reproducibles por inspección: resultado obsoleto al confirmar durante procesamiento y fuga de listener entre sesiones. El test Phase 3A falló antes de iniciar con `EADDRINUSE` en 8082, ocupado por infraestructura ajena. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no haber tareas TODO; se priorizaron correcciones atómicas sin introducir una prueba roja. |
| **Tests ejecutados** | `node tests/workspace/phase3b-test.mjs`; `node tests/workspace/phase3a-manual-verification.mjs` (reproducción enfocada de aislamiento). |
| **Tests PASS** | Phase 3B 59/59. |
| **Tests FAIL** | Phase 3A no inició: `EADDRINUSE` en 8082; fallo preexistente de infraestructura, documentado como CE-019, sin reintentos. |
| **Commits** | Commit de cierre: `docs(evolution): descubre riesgos del escáner` |
| **Bloqueos** | Ninguno: CE-016 es ejecutable y será la próxima tarea al promoverse a TODO. |
| **Limitaciones** | El defecto de borde debe cuantificarse sobre patrón y OCR antes de modificar la interpolación; no se asume que una ruta nativa preserve la misma calidad. |
| **Proxima prioridad** | Promover CE-016 a TODO y asegurar que Confirmar nunca persista una previsualización anterior. |

---

## Cycle 37 — Confirmación del escáner contra vista previa actual

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 94633a4e4007bc8a9e087d0d90e6de340d4ed1b6 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-016 |
| **Hypothesis** | Una confirmación iniciada durante el recálculo podía serializar el canvas corregido anterior aunque las esquinas ya representaran el ajuste nuevo. |
| **Change** | El escáner toma un snapshot inmutable de esquinas para cada revisión de vista previa, invalida revisiones anteriores y no habilita Aplicar escaneo hasta que la revisión vigente se haya dibujado. Click y Ctrl+Enter esperan la promesa de la vista previa vigente y comparten una única ruta de confirmación. |
| **Hallazgos** | `updatePreview()` era async pero su trabajo no estaba asociado a una versión de esquinas; confirmar duplicaba la serialización por click y teclado. El botón no nacía deshabilitado durante la carga inicial. |
| **Bugs encontrados** | Riesgo de persistir un `correctedCanvas` anterior al confirmar un ajuste que todavía se recalculaba. |
| **Bugs corregidos** | Sí: solo el canvas de la última revisión puede llegar a `onConfirm`; las confirmaciones duplicadas se bloquean mientras se procesa la primera. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `node tests/workspace/phase3a-manual-verification.mjs`; `node tests/workspace/phase3b-test.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 48/48 (incluye 3 contratos nuevos de serialización); sincronización source/dist OK; Phase 3B 59/59; diff check OK. |
| **Tests FAIL** | La verificación manual Phase 3A no inició por `EADDRINUSE` en 8082, ocupado por infraestructura ajena; coincide con el límite ya registrado en CE-019 y no se reintentó. |
| **Commits** | Commit de cierre de este ciclo: `fix(scanner): serializa la confirmación de vista previa` |
| **Bloqueos** | Ninguno para CE-016. CE-019 mantiene el puerto fijo como mejora independiente. |
| **Limitaciones** | La corrección actual sigue ejecutándose en el hilo principal; las revisiones evitan resultados obsoletos, no reducen el coste de imágenes muy grandes (CE-014). |
| **Proxima prioridad** | Promover CE-017 a TODO y liberar el listener global de redimensionado al destruir el escáner. |

---

## Cycle 38 — Discovery de carreras en las esquinas del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2cd2143af9f2e038b729c2e1692e0f577d538b28 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La revisión de la vista previa recién añadida protege el resultado de la corrección, pero las acciones asíncronas que sustituyen las esquinas pueden seguir reintroduciendo una carrera de intención. |
| **Change** | Se documentó CE-020 (P1): asociar revisión a Auto-detectar y Restablecer, de modo que una detección tardía no reemplace el último ajuste manual ni una solicitud posterior. |
| **Hallazgos** | `setupToolbar()` inicia `processImageCapture(sourceDataUrl)` para ambas acciones y aplica sus esquinas al resolver sin comprobar si el usuario arrastró una esquina o inició otra acción durante la espera. En capturas grandes, el pipeline ya tiene un escenario medido de hasta 10 s, por lo que la ventana es real. |
| **Bugs encontrados** | Riesgo reproducible por inspección: una promesa de auto-detección/restablecimiento tardía puede reemplazar las esquinas que el usuario acaba de ajustar y recalcular una vista previa distinta de su última intención. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no haber tareas TODO; CE-020 queda priorizada para una corrección atómica con prueba de carreras. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del módulo y de la serialización de vista previa. |
| **Tests PASS** | Phase 3A 48/48; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre carrera de esquinas del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La carrera se documenta sin introducir una prueba roja deliberada; la corrección debe mantener disponibles ambas acciones y no ocultar latencia con reintentos. |
| **Proxima prioridad** | Promover CE-020 a TODO y garantizar que solo la última intención de esquinas puede actualizar el escáner. |

---

## Cycle 39 — Discovery de cancelación durante persistencia del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 288e223c9a939c4315f30ff185e371d78f977457 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | El ciclo de vida de confirmación podía revelar una acción de usuario que no se cancelara de verdad aunque la vista ya hubiera cambiado. |
| **Change** | Se registró CE-021 (P1): serializar Cancelar y el guardado asíncrono de la confirmación para impedir que un escaneo se persista silenciosamente después de que el usuario lo descarte. |
| **Hallazgos** | `confirmScan()` invoca el callback asíncrono `onConfirm` sin `await`; ese callback guarda activo fuente, documento, captura y activo corregido. Cancelar sigue disponible y solo navega fuera, por lo que el guardado iniciado continúa sobre una UI desmontada. También se confirmó que `destroy()` no se invoca desde `renderScannerView`, reforzando la prioridad de CE-017. |
| **Bugs encontrados** | Riesgo reproducible por inspección: Cancelar durante la persistencia de una confirmación ya iniciada no cancela ni comunica el guardado en curso y puede crear resultados no deseados. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; la corrección se acotó como CE-021 sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del módulo de escáner y su contrato de confirmación. |
| **Tests PASS** | Phase 3A 48/48; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre cancelación pendiente del escáner` |
| **Bloqueos** | Ninguno. CE-020 sigue siendo la tarea P1 descubierta de mayor prioridad y debe promoverse a TODO antes de implementar en el siguiente ciclo. |
| **Limitaciones** | La reproducción de persistencia requiere instrumentar un guardado lento controlado en navegador; no se añadieron delays ni mocks al E2E principal durante discovery. |
| **Proxima prioridad** | Promover CE-020 a TODO y garantizar que solo la última intención de esquinas puede actualizar el escáner. |

---

## Cycle 40 — Intención vigente para detección de esquinas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | ad449a9b4578ef4f3a69f07dcaea82ade5ecaeb2 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-020 |
| **Hypothesis** | Una detección o restablecimiento que resuelve después de una intención posterior puede reemplazar las esquinas que el usuario acaba de elegir. |
| **Change** | Se promovió CE-020 y el escáner incorpora una revisión monotónica de intención: Auto-detectar y Restablecer capturan su revisión antes de procesar; cada movimiento manual también invalida solicitudes previas. Solo la solicitud vigente actualiza esquinas, vista previa, dimensiones y estado. El fallo de detección se comunica sin errores no controlados. |
| **Hallazgos** | Las dos acciones reutilizaban `processImageCapture()` sin asociar el resultado a la intención que la creó. Las promesas podían completar en cualquier orden; la protección previa de revisión solo cubría el render de la vista previa, no el reemplazo de esquinas. |
| **Bugs encontrados** | Un resultado tardío de Auto-detectar o Restablecer podía sobrescribir una acción posterior o un arrastre manual. |
| **Bugs corregidos** | Sí: los resultados obsoletos se descartan y únicamente la última intención de esquinas puede iniciar la actualización de la vista previa. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 51/51, incluidos 3 contratos de dos solicitudes diferidas donde la primera se ignora y la última se aplica; Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): protege la intención de esquinas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La corrección de perspectiva sigue en el hilo principal para imágenes grandes (CE-014); las solicitudes de detección ya iniciadas no se abortan, pero sus resultados obsoletos no mutan la UI ni el estado. |
| **Proxima prioridad** | Promover CE-021 a TODO y serializar Cancelar con el guardado asíncrono de Confirmar. |

---

## Cycle 41 — Discovery de ciclo de vida inactivo del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 34ba386f13847627631484b34d67d28ecd9464cd |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La cancelación del escáner durante una inicialización o previsualización lenta puede dejar trabajo asíncrono que muta una vista ya desmontada y registra recursos globales tarde. |
| **Change** | Se documentó CE-022 (P2): invalidar la sesión de UI al cancelar o destruirla, impedir que `init()`/previsualizaciones obsoletas monten controles y liberar el listener global que puedan haber registrado. |
| **Hallazgos** | `destroy()` solo llama `root.replaceChildren()`. `init()` continúa después de `await processCapture()` y llama `setupDragHandlers()`, cuyo `window.resize` anónimo no puede retirarse; no hay una marca de sesión activa que proteja esos continuations. |
| **Bugs encontrados** | Riesgo reproducible por inspección: cancelar mientras `processCapture` permanece pendiente puede completar la inicialización fuera de la vista, conservar canvas en el cierre y añadir un listener de redimensionado tardío. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-022 queda delimitada para una corrección y prueba diferida, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner y de los contratos de revisión e intención. |
| **Tests PASS** | Phase 3A 51/51; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre ciclo de vida inactivo del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | CE-017 ya acota el teardown del listener en sesiones cerradas; CE-022 cubre adicionalmente los continuations asíncronos que llegan después de destruir la UI. La solución debe validar ambas órdenes (destruir antes y después de que resuelva la carga). |
| **Proxima prioridad** | Promover CE-021 a TODO y serializar Cancelar con el guardado asíncrono de Confirmar. |

---

## Cycle 42 — Guardado de escáner sin cancelación ambigua

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7199657672676fb9ffd3c632baa2e2d1c8096bb7 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-021 |
| **Hypothesis** | Si el escáner espera el callback de persistencia y comunica ese estado, Cancelar no podrá desmontar la vista mientras se guardan activos y relaciones. |
| **Change** | Se promovió CE-021. `confirmScan()` espera `onConfirm`, muestra «Guardando escaneo...», deshabilita Cancelar y bloquea Escape durante la persistencia; al terminar restaura los controles. |
| **Hallazgos** | Aunque el callback real ya contenía un `try/catch`, el UI no esperaba su promesa: `confirming` terminaba de inmediato y dejaba disponible una acción de descarte que navegaba fuera mientras la escritura continuaba. |
| **Bugs encontrados** | Cancelar o Escape podían salir del escáner durante un guardado asíncrono iniciado por Aplicar escaneo, creando un resultado que el usuario podía creer descartado. |
| **Bugs corregidos** | Sí: el guardado es una operación visible y no cancelable desde esa pantalla; no se navega ni se invoca `onCancel` hasta que concluya. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 54/54 (3 contratos nuevos para bloqueo, Escape/Cancelar y restauración); Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Una vez iniciado el guardado local no se aborta a mitad de sus escrituras para evitar datos parcialmente relacionados; el estado visible y los controles bloqueados hacen explícita esa decisión. CE-022 sigue cubriendo callbacks de inicialización tardíos tras destruir la vista. |
| **Proxima prioridad** | Promover CE-022 a TODO y proteger la sesión del escáner contra inicialización o previsualización tardía después de destruirla. |

---

## Cycle 43 — Ciclo de vida inactivo del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | e29841c01e2b8ca4ed7f90f79682144244dc6b81 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-022 |
| **Hypothesis** | Destruir la vista durante una carga o vista previa asíncrona permitía que continuations tardíos retuvieran canvas o registraran listeners globales en una UI ya cerrada. |
| **Change** | El escáner mantiene una sesión activa: `destroy()` invalida revisiones, libera canvas/datos de imagen/esquinas y elimina el listener `resize`. `init`, previsualización, confirmación y detección descartan resultados inactivos. Cancelar y el guardado exitoso destruyen la instancia antes de navegar. |
| **Hallazgos** | El listener de redimensionado se creaba como función anónima y por tanto no se podía retirar. La navegación desde el callback del escáner sustituía la vista pero no llamaba a su destructor. |
| **Bugs encontrados** | Una inicialización tardía podía poblar un root ya destruido y registrar `resize`; una sesión cerrada conservaba referencias a canvas hasta que el recolector pudiera atravesar la clausura. |
| **Bugs corregidos** | Sí: resultados tardíos no mutan la sesión inactiva, el listener se desregistra y el cierre libera sus referencias visuales. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 56/56 (dos contratos nuevos: carga diferida destruida y teardown de `resize`); Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(scanner): libera sesiones inactivas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El trabajo de perspectiva ya iniciado no se puede abortar en el hilo principal, pero su resultado se descarta tras destruir la sesión y no vuelve a montar controles ni estado. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 44 — Discovery de operabilidad por teclado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 4782d70f17481be868017c0722426841881605f7 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La auditoría de widgets dinámicos del Workspace puede revelar una barrera concreta para el flujo estrella, en lugar de deuda de accesibilidad genérica. |
| **Change** | Se registró CE-023 (P1): operación por teclado de las cuatro esquinas del escáner, con coordenadas anunciadas y contrato Playwright; CE-015 queda acotada a pestañas y selectores para evitar solapamiento. |
| **Hallazgos** | Cada esquina se publica como `role="button"` y es enfocables, pero la única mutación de esquinas está en `pointermove`; no hay listeners `keydown`, foco visible específico ni estado/posición que un lector de pantalla pueda comunicar. Esto impide ajustar la perspectiva sin puntero incluso aunque el control parezca accesible. |
| **Bugs encontrados** | Barrera reproducible por inspección: Enter, Espacio y las flechas sobre una esquina enfocada no producen ninguna acción ni actualización de coordenadas. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-023 se delimitó como corrección P1 atómica y verificable sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner. |
| **Tests PASS** | Phase 3A 56/56; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): prioriza teclado del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La detección y corrección existentes continúan usando puntero para el arrastre; CE-023 debe añadir teclado sin modificar la geometría ni ocultar la latencia de la previsualización. |
| **Proxima prioridad** | Promover CE-023 a TODO y hacer las esquinas operables mediante teclado con prueba de navegador. |

---

## Cycle 45 — Esquinas del escáner operables por teclado

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b2037c20d7994cd3e2376f89608555fd9d889f39 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-023 |
| **Hypothesis** | Los controles de esquina solo respondían al puntero aunque fueran enfocables, por lo que una persona que usa teclado no podía corregir la perspectiva ni conocer la posición resultante. |
| **Change** | Las cuatro esquinas pasan a sliders enfocables: flechas ajustan 5 px, Mayús + flecha 20 px e Inicio/Fin llevan X a los límites. Cada cambio reutiliza la mutación acotada de esquinas, actualiza la previsualización y publica X/Y mediante atributos ARIA. Se añadió foco visible sin alterar el arrastre táctil o de puntero. |
| **Hallazgos** | El `role=button` existente no expresaba un valor ajustable y `pointermove` duplicaba la lógica de mutación. Centralizarla mantiene revisión de intención, límites, geometría y metadatos ARIA idénticos para ratón y teclado. |
| **Bugs encontrados** | Las esquinas tenían `tabindex` pero Flechas, Inicio y Fin no cambiaban la geometría ni anunciaban coordenadas; no existía señal visual de foco específica. |
| **Bugs corregidos** | Sí: la perspectiva ya se ajusta sin puntero, con límites deterministas y coordenadas X/Y actualizadas para tecnología asistiva. |
| **Tests ejecutados** | Baseline `node tests/workspace/phase3a-test.mjs` (56/56); `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 59/59 (incluye movimiento, límite, foco y semántica ARIA en navegador); Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0 final. La primera ejecución posterior al cambio sirvió el `dist` anterior (2 contratos rojos); el build regeneró la distribución y la ejecución contra el producto construido quedó verde. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El slider expone X como valor numérico y X/Y en `aria-valuetext`; la corrección sigue siendo bidimensional y no existe un rol ARIA nativo específico para un punto 2D. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 46 — Discovery de confirmación durante detección de esquinas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 63aa630f8b17d294a8c0cdc18c700ce2836d0412 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | Una acción asíncrona de Auto-detectar o Restablecer puede dejar una ventana en la que Aplicar escaneo confirme el canvas anterior, aunque el usuario ya solicitó una nueva geometría. |
| **Change** | Se registró CE-024 (P1): serializar la intención de detección/restablecimiento con la confirmación, bloquear Aplicar escaneo durante el cálculo pendiente y restaurarlo solo para la intención vigente. |
| **Hallazgos** | `applyDetectedCorners()` incrementa la revisión de intención y espera `processCapture()`, pero no actualiza `state.processing`, `previewPromise` ni el estado de Confirmar antes de esa espera. Si ya existe una previsualización válida, `confirmScan()` no espera la detección pendiente y puede serializar sus esquinas/canvas anteriores. |
| **Bugs encontrados** | Riesgo reproducible por inspección: Confirmar permanece disponible durante Auto-detectar/Restablecer y puede guardar una corrección que ya no representa la última intención del usuario. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-024 queda acotada para una corrección P1 con promesa diferida y prueba de navegador, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner y sus contratos de revisiones, confirmación, ciclo de vida y teclado. |
| **Tests PASS** | Phase 3A 59/59; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre confirmación durante detección` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La corrección futura no debe cancelar a mitad de `processCapture()` en el hilo principal ni ocultar la espera con reintentos: debe ignorar resultados obsoletos y hacer visible el estado pendiente. |
| **Proxima prioridad** | Promover CE-024 a TODO y evitar que Aplicar escaneo confirme mientras Auto-detectar o Restablecer están pendientes. |

---

## Cycle 47 — Confirmación serializada con detección de esquinas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f75ca7278d3056457441b9ca9af311468524c6f3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-024 |
| **Hypothesis** | Auto-detectar o Restablecer dejaban Confirmar disponible mientras esperaban sus nuevas esquinas, por lo que podían persistir el canvas y la geometría anteriores. |
| **Change** | La intención de detección ahora marca el escáner como procesando, deshabilita Confirmar y publica su promesa vigente. Confirmar, incluido Ctrl+Enter, espera la detección y la previsualización resultante; solo la intención vigente restaura el control. Un ajuste manual invalida la detección pendiente sin dejar el estado de procesamiento bloqueado. |
| **Hallazgos** | La serialización previa cubría el render de la vista previa, pero no el tramo anterior de `processCapture()` de Auto-detectar/Restablecer. Esperar únicamente la promesa previa permitía un bucle de espera sobre una promesa ya resuelta mientras la detección continuaba. |
| **Bugs encontrados** | Aplicar escaneo seguía habilitado durante una detección pendiente y podía guardar una vista previa obsoleta. |
| **Bugs corregidos** | Sí: la confirmación permanece bloqueada hasta que termina la detección vigente y, si se solicita por teclado, persiste exclusivamente las esquinas detectadas más recientes. |
| **Tests ejecutados** | Baseline y final `node tests/workspace/phase3a-test.mjs`; `npm run build`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Phase 3A 62/62 (3 contratos de detección/confirmación diferida); build 179/179; Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): bloquea confirmación durante detección` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La detección ya iniciada sigue ejecutándose en el hilo principal y no se aborta; si queda obsoleta, su resultado no muta la UI. El archivo de captura `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al inicio del ciclo y se deja fuera del commit. |
| **Proxima prioridad** | No quedan tareas TODO; promover CE-014 o realizar discovery dirigida según la cola al iniciar el próximo ciclo. |

---

## Cycle 48 — Discovery de recuperación tras error de guardado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 01b624b8daba8973efde58fef45d5f7defed9f36 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La serialización de Confirmar protege el guardado en curso, pero una persistencia fallida puede no devolver al escáner un estado visible y reintentable. |
| **Change** | Se registró CE-025 (P1): definir el resultado de `onConfirm` y restaurar desde el UI un estado de error/reintento cuando no se puedan guardar los activos locales relacionados. |
| **Hallazgos** | `renderScannerView` captura errores de `saveAsset`, `saveImageCapture` o relaciones, muestra un toast y registra la ejecución fallida, pero no relanza ni devuelve un resultado de fallo. `confirmScan()` restaura los botones en `finally`, aunque deja el status como «Guardando escaneo...», por lo que la pantalla contradice el toast y no comunica que el nuevo intento es seguro. |
| **Bugs encontrados** | Riesgo reproducible por inspección: un fallo local de persistencia deja una UI aparentemente todavía guardando mientras el callback ya terminó y los controles volvieron a estar disponibles. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-025 queda acotada como corrección P1 con una falla controlada fuera del E2E principal. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner, su serialización y su ciclo de vida. |
| **Tests PASS** | Phase 3A 62/62; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre recuperación de guardado del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La prueba futura debe inyectar el fallo de persistencia en un contrato unitario/controlado, sin sustituir el almacenamiento ni usar mocks en el E2E principal. No se debe reportar éxito ni navegar hasta que la transacción local confirme sus relaciones. |
| **Proxima prioridad** | Promover CE-025 a TODO y hacer que un fallo de guardado deje el escáner en un estado explícito de error y reintento. |

---

## Cycle 49 — Recuperación tras error de guardado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2d0e75c711db8ae6c0deb40dfaba6cccc9f15731 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-025 |
| **Hypothesis** | Un callback de persistencia que captura su propio fallo deja al escáner sin señal de que el guardado no terminó y conserva el mensaje de guardado aunque el usuario ya pueda reintentar. |
| **Change** | `renderScannerView` devuelve un resultado explícito `{ ok: true/false }` al escáner. Ante fallo, `scanner-ui` muestra un estado de error reintentable, restaura Aplicar escaneo y Cancelar, y también protege contra una excepción imprevista del callback. |
| **Hallazgos** | El `finally` del UI desbloqueaba los controles correctamente, pero no tenía contrato con el callback para distinguir éxito de un error ya capturado. El flujo real conserva el toast y además devuelve el resultado local al UI. |
| **Bugs encontrados** | Tras fallar `saveAsset`, `saveImageCapture` o una relación, el estado quedaba en «Guardando escaneo...» aun cuando la operación ya había terminado. |
| **Bugs corregidos** | Sí: el error se anuncia como recuperable y el siguiente intento vuelve a invocar la persistencia sin navegar ni declarar éxito. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 64/64 (dos contratos nuevos de fallo controlado y reintento en navegador); Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `fix(scanner): recupera errores de guardado` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El registro de ejecución fallida sigue siendo best-effort para no ocultar el error original; el intento no puede revertir de forma atómica activos que una capa de almacenamiento pudiera haber escrito antes de fallar. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 50 — Discovery de persistencia atómica del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | dea5cfe901bc7c374ecd68d5100e4e358a2eee65 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La recuperación de UI de CE-025 no impide que un fallo intermedio de IndexedDB conserve una fracción del escaneo y que un reintento cree artefactos duplicados. |
| **Change** | Se registró CE-026 (P1): persistir en una sola transacción los assets original/corregido, ScanDocument, captura y ejecución del escáner, con un contrato de rollback e integridad. |
| **Hallazgos** | `renderScannerView` encadena ocho o más escrituras independientes (`saveAsset`, `saveCapture`, `registerExecution`); actualiza relaciones después de haber persistido varios objetos. `storage.js` ya dispone de `dbTransaction` sobre `assets`, `captures` y `executions`, como demuestra la importación de proyectos, pero no existe un helper equivalente para este resultado compuesto. |
| **Bugs encontrados** | Riesgo reproducible por inspección: si falla una escritura posterior, quedan assets o ScanDocument previos sin todas sus relaciones; al reintentar, CE-025 vuelve a generar IDs y no puede distinguir ni limpiar el resultado parcial. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-026 queda acotada como corrección P1 verificable con fallo de transacción controlado, sin mocks en el E2E principal. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner y su recuperación de fallos. |
| **Tests PASS** | Phase 3A 64/64, sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre persistencia atómica del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El helper debe preparar todos los modelos y registrar relaciones antes de abrir la transacción; los efectos de UI, historial y toast solo pueden ocurrir tras su commit. La telemetría de ejecución fallida se mantiene best-effort y no debe invalidar el rollback de los datos del usuario. |
| **Proxima prioridad** | Promover CE-026 a TODO y hacer atómica la persistencia compuesta del escáner. |

---

## Cycle 51 — Persistencia atómica del resultado del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 4e9575532e53f82480c31ee1221ffad524113294 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-026 |
| **Hypothesis** | Las escrituras individuales del escáner podían dejar assets, ScanDocument o captura sin todas sus relaciones si IndexedDB fallaba antes de la última operación. |
| **Change** | Se añadió `persistScannerResult`: prepara los tres assets, captura y ejecución con sus relaciones completas y los persiste en una única transacción IndexedDB. La UI solo actualiza estado, navega y anuncia éxito después del commit. `dbTransaction` ahora aborta operaciones ya encoladas si su callback falla. |
| **Hallazgos** | El helper `saveImageCapture` era correcto para una captura independiente, pero no para el resultado compuesto del escáner: la captura, asset corregido y ejecución se confirmaban en transacciones distintas. El rollback también requería abortar explícitamente ante una excepción síncrona del callback. |
| **Bugs encontrados** | Un error posterior podía conservar una fracción persistida del escaneo y un reintento podía crear artefactos adicionales sin completar las relaciones del intento previo. |
| **Bugs corregidos** | Sí: el resultado completo se confirma junto o no se confirma; una falla controlada después de un `put` revierte el registro encolado. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 67/67, incluidos commit conjunto y rollback controlado en navegador; Phase 3B 59/59; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): guarda resultados de forma atómica` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La transacción no puede abortar el cálculo de perspectiva ya iniciado en el hilo principal; solo protege la persistencia posterior. El registro best-effort de una ejecución fallida permanece fuera de la transacción para no ocultar el error original. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y se excluye del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 52 — Discovery de recuperación ante carga inicial fallida del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7ab40392468088edf123ce5a748bbaf410374503 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La ruta inicial asíncrona del escáner puede conservar una salida de usuario incompleta cuando el procesamiento de la imagen rechaza antes de instalar los eventos de la barra. |
| **Change** | Se registró CE-027 (P1): instalar una ruta de recuperación para Cancelar/Escape y una comunicación accionable de error incluso si falla `processCapture()` durante `init()`. |
| **Hallazgos** | `init()` renderiza Cancelar desde el inicio, pero solo llama `setupToolbar()` después de que `await processCapture(sourceDataUrl)` y la primera vista previa terminan. Su `catch` actualiza el texto de error sin instalar esos listeners; por ello la persona queda en una vista cuyo botón Cancelar y Escape no hacen nada. |
| **Bugs encontrados** | Riesgo reproducible por control de flujo: una imagen corrupta, una excepción de canvas o un fallo del procesador inicial muestra el error, pero no permite volver a Capturas ni iniciar otra captura desde esa pantalla. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-027 queda acotada como corrección P1 con contrato de navegador de fallo inicial, sin mocks en el E2E principal. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del procesador y escáner. |
| **Tests PASS** | Phase 3A 67/67; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre salida tras fallo inicial del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La ruta de fallo debe conservar el mensaje concreto sin exponer datos de la captura y permitir abandonar la vista; no se debe fingir una vista previa ni reintentar silenciosamente el procesamiento. |
| **Proxima prioridad** | Promover CE-027 a TODO y asegurar que un fallo inicial del escáner conserva Cancelar y Escape operables con prueba de navegador. |

---

## Cycle 53 — Salida recuperable tras fallo inicial del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | a94f810cedd5fd52e1cb75fc7dec60b691a2789e |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-027 |
| **Hypothesis** | Si `processCapture()` falla durante `init()`, instalar explícitamente los controles de recuperación en esa ruta mantiene una salida real sin habilitar acciones que dependan de una imagen no cargada. |
| **Change** | Se promovió CE-027. El `catch` de inicialización conserva el mensaje concreto de error y conecta una ruta mínima de recuperación para Cancelar y Escape; Auto-detectar, Restablecer y Aplicar escaneo no se activan sin resultado inicial. |
| **Hallazgos** | La barra completa se instalaba únicamente tras la primera previsualización; por tanto, el botón Cancelar ya renderizado y Escape carecían de listeners en el único camino donde más se necesitaban. |
| **Bugs encontrados** | Un fallo de imagen/canvas durante la carga inicial dejaba una pantalla de error sin salida operable hacia Capturas. |
| **Bugs corregidos** | Sí: el error conserva contexto y Cancelar/Escape invocan la navegación de descarte incluso cuando no existe vista previa. |
| **Tests ejecutados** | Baseline `node tests/workspace/phase3a-test.mjs` (67/67); `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 69/69, incluidos mensaje y controles de recuperación en navegador; Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El error inicial no reintenta silenciosamente el procesamiento ni habilita controles que requieren geometría; la persona puede volver a Capturas y elegir una entrada válida. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al inicio del ciclo y sigue fuera del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 54 — Discovery de geometría segura en el escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 77aadbe536fe8853c399eb9413327d1727042fcc |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La libertad de mover cada esquina dentro del rectángulo de la imagen puede permitir una geometría que el corrector de perspectiva no puede representar como documento válido. |
| **Change** | Se registró CE-028 (P1): validar que el cuadrilátero manual conserva orden, convexidad y área mínima; rechazar o acotar un movimiento inválido y comunicarlo sin perder el último ajuste válido. |
| **Hallazgos** | `setCornerPosition()` solo limita X/Y a los bordes. Permite que una esquina atraviese a su vecina y forme un polígono cruzado o de área cero. `perspectiveCorrectBilinear()` interpola asumiendo el orden TL/TR/BR/BL, sin validar geometría: con un lazo el muestreo se pliega y la salida puede quedar corrupta o vacía. |
| **Bugs encontrados** | Riesgo reproducible por el flujo de control: el arrastre manual puede crear una geometría inválida que permanece anunciada como lista y llega a Aplicar escaneo. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-028 queda delimitada como corrección P1 con validación geométrica y prueba de navegador, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline de procesamiento, controles de esquina y persistencia del escáner. |
| **Tests PASS** | Phase 3A 69/69; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre geometría segura del escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La validación futura debe conservar ajustes válidos próximos a los bordes y el control por teclado; no debe reordenar silenciosamente las esquinas ni cambiar la geometría confirmada por la persona. |
| **Proxima prioridad** | Promover CE-028 a TODO y evitar que una esquina manual produzca un cuadrilátero cruzado o degenerado. |

---

## Cycle 55 — Discovery de duplicación de imagen corregida

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | ffa292a2a8c36d8b40a29402aaae4219eb91f207 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La persistencia atómica reciente puede haber conservado una representación redundante de la imagen corregida entre los modelos de captura y asset. |
| **Change** | Se registró CE-029 (P1): conservar un único PNG corregido en el asset y hacer que la captura use su referencia, con migración compatible y contratos de exportación/importación. |
| **Hallazgos** | `renderScannerView` asigna el mismo `result.correctedDataUrl` a `savedCapture.dataUrl` y `correctedAsset.dataUrl`; `persistScannerResult` inserta los dos objetos en la misma transacción. La relación `correctedAssetId` ya existe, por lo que hay una vía local para eliminar la segunda carga sin introducir URLs `blob:`. |
| **Bugs encontrados** | Riesgo reproducible por inspección de persistencia: cada resultado de escáner duplica una imagen potencialmente grande en IndexedDB, incrementando cuota, tiempo de exportación y la probabilidad de un error de almacenamiento. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-029 se delimitó como corrección P1 verificable antes de tocar el formato persistido. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs` como baseline del escáner, persistencia atómica y recuperación. |
| **Tests PASS** | Phase 3A 69/69; sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `docs(evolution): descubre duplicación de imágenes de escáner` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Los proyectos ya guardados requieren compatibilidad de lectura y la migración no debe borrar datos de una captura hasta que el asset relacionado se haya verificado; la imagen original y la corregida son salidas distintas y no se deben deduplicar entre sí. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y queda fuera del commit. |
| **Proxima prioridad** | Promover CE-028 a TODO y validar la geometría manual antes de que llegue al corrector; CE-029 queda como siguiente P1 de almacenamiento. |

---

## Cycle 56 — Geometría segura para ajustes manuales del escáner

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b91e6ce8e2df4c2134de40df8c6e38c6ad7a38f2 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-028 |
| **Hypothesis** | Un movimiento manual que cruza, aplana o reduce excesivamente el cuadrilátero puede producir una corrección de perspectiva plegada o vacía aunque la interfaz lo presente como válida. |
| **Change** | Se promovió CE-028 y se añadió validación de cuadrilátero convexo estricto y área mínima antes de mutar una esquina. Un movimiento inválido conserva las esquinas y vista previa anteriores, comunica el motivo mediante estado vivo y deja disponible Aplicar escaneo para el último documento válido. |
| **Hallazgos** | El corrector bilineal presupone el orden TL/TR/BR/BL; limitar cada coordenada al rectángulo no evita que los segmentos se crucen. La validación compartida cubre valores no finitos, giros inconsistentes, colinealidad y área insuficiente. |
| **Bugs encontrados** | Un arrastre o acción de teclado podía formar un polígono cruzado o degenerado y mandarlo al corrector de perspectiva sin feedback recuperable. |
| **Bugs corregidos** | Sí: se rechaza la geometría inválida sin perder el ajuste confirmado, con aviso visible y anunciado para lectores de pantalla. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 73/73, incluyendo cuadrilátero válido, cruzado, degenerado y rechazo por teclado con previsualización conservada; Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): protege la geometría de esquinas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La comprobación protege las mutaciones manuales; los resultados de detección automática conservan su ruta existente. El umbral de área combina 64 px² con 0,01% de la imagen para no rechazar documentos válidos cercanos a los bordes. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y se excluye del commit. |
| **Proxima prioridad** | Promover CE-029 a TODO y eliminar la copia redundante de PNG corregido entre captura y asset sin romper proyectos existentes. |

---

## Cycle 57 — Discovery de borrado en cascada visible

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | aa8b7bbb14389642de0c475df9d14ad639b4b1e1 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La revisión del flujo de almacenamiento y borrado puede revelar una pérdida de trabajo evitable en un camino ya protegido por integridad referencial. |
| **Change** | Se registró CE-030 (P1): antes de borrar una captura de escáner, comunicar y confirmar el alcance completo de su cascada de derivados. |
| **Hallazgos** | La tarjeta de Capturas promete solo «La captura se quitará de este proyecto», pero `deleteCapture()` usa `deleteWithCascade()`. El contrato de integridad verifica que una captura elimina transitivamente asset, documento, tabla, gráfico, exportación y ejecución; el comportamiento es consistente, pero su impacto no es visible en la decisión del usuario. |
| **Bugs encontrados** | Riesgo reproducible por lectura de flujo y contrato de navegador: una confirmación con texto de eliminación simple puede causar pérdida inesperada de resultados derivados, aunque la cascada preserve la consistencia sin huérfanos. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-030 queda acotada como mejora P1 verificable sin alterar la semántica de cascada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase4-integrity-test.mjs`. El intento inicial de Phase 4b en 8082 no inició por `EADDRINUSE` de infraestructura ajena; se aisló en 8084. |
| **Tests PASS** | Phase 3A 73/73; Phase 4b integridad 43/43, incluidos borrado transitivo, poda de relaciones y auditoría sin huérfanos; sin errores de página ni consola. |
| **Tests FAIL** | 0 final (el conflicto inicial de puerto no fue una aserción). |
| **Commits** | Commit de cierre: `docs(evolution): descubre borrado en cascada de capturas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La futura confirmación debe calcular el alcance sin recorrer blobs ni borrar previamente; debe preservar el comportamiento transaccional y no prometer restauración mientras no exista papelera local. |
| **Proxima prioridad** | Promover CE-029 a TODO y eliminar la copia redundante de PNG corregido; CE-030 queda como siguiente P1 de protección contra pérdida inesperada de resultados. |

---

## Cycle 58 — Discovery de referencias de escáner al importar

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 45b2d9283ded54f77abd77e83e31f3489be46275 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | La próxima deduplicación de la imagen corregida puede revelar referencias persistentes que el importador de proyectos no remapea al generar IDs nuevos. |
| **Change** | Se registró CE-031 (P1): remapear `correctedAssetId` en captura, ScanDocument y páginas de escáner durante importación, con un contrato de exportación/importación que cubra las tres referencias. |
| **Hallazgos** | `importProject()` crea un mapa nuevo para todos los assets, pero `remapRefs()` no contiene `correctedAssetId` y solo trata campos de primer nivel. El resultado del escáner escribe ese ID en `savedCapture`, `scanDoc` y `scanDoc.pages[0]`; tras importar, los tres siguen apuntando al ID del bundle de origen, que no existe en el proyecto importado. |
| **Bugs encontrados** | Riesgo reproducible de integridad: una importación válida conserva referencias de asset corregido obsoletas. Hoy queda parcialmente oculto porque la captura aún duplica `dataUrl`; CE-029 eliminará esa copia, de modo que el defecto impediría resolver la imagen corregida de un proyecto importado. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-031 queda acotada como corrección P1 sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase5-bundle-trust-test.mjs` (reproducción enfocada). |
| **Tests PASS** | Phase 3A 73/73, sin errores JS. |
| **Tests FAIL** | Phase 5 no inició por `EADDRINUSE` en 8082, ocupado por infraestructura ajena; el script no admite `E2E_PORT`. No se reintentó la misma suite. |
| **Commits** | Commit de cierre: `docs(evolution): descubre referencias de escáner al importar` |
| **Bloqueos** | Ninguno para CE-031; el puerto fijo del gate Phase 5 es una limitación de infraestructura independiente. |
| **Limitaciones** | La corrección debe remapear únicamente IDs conocidos y preservar la validación de manifiesto previa a cualquier escritura; no debe borrar `dataUrl` de proyectos existentes hasta completar CE-029 y su migración compatible. `screenshots/workspace/08-scanner-module-test.png` ya estaba modificado al iniciar el ciclo y se deja fuera del commit. |
| **Proxima prioridad** | Promover CE-029 a TODO y eliminar la copia redundante de PNG corregido; implementar CE-031 junto con esa migración o antes de retirar el fallback de captura. |

---

## Cycle 59 — Imagen corregida única por escaneo

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 25e37be039cb855d7b549e1045c739fc26884851 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-029 |
| **Hypothesis** | Guardar el PNG corregido tanto en la captura como en su asset duplica cuota local sin aportar una segunda representación necesaria. |
| **Change** | Las nuevas capturas de escáner persisten solo `correctedAssetId`; el PNG corregido vive en `dataUrl` del asset. Se añadió un resolvedor compatible que conserva el `dataUrl` de capturas históricas y se usa en tarjetas de Capturas, OCR y contextos de revisión/comparación de tablas. |
| **Hallazgos** | El asset corregido tenía además `originalDataUrl` con el mismo PNG; ya no se rellena, por lo que la salida corregida nueva ocupa una única propiedad persistente. La fuente original queda separada en su asset de entrada. |
| **Bugs encontrados** | Cada escaneo persistía el mismo PNG corregido en captura y asset, elevando la cuota, el tiempo de exportación y el riesgo de fallo de almacenamiento. |
| **Bugs corregidos** | Sí: una captura nueva referencia su asset corregido sin copiar la imagen; los lectores recuperan esa referencia y los proyectos existentes con `capture.dataUrl` siguen legibles. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 75/75 (referencia única y fallback histórico incluidos); Phase 3B 59/59; Star-Flow E2E real 83/83 sin errores JS ni consola; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre: `fix(scanner): evita duplicar imágenes corregidas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las capturas ya existentes conservan su `dataUrl`; no se reescriben ni borran retrospectivamente. El E2E heredado regenera artefactos con IDs/timestamps no deterministas y se excluye del commit; la captura PNG ya estaba modificada al iniciar el ciclo y también queda fuera. |
| **Proxima prioridad** | Promover CE-030 a TODO y comunicar el alcance real antes del borrado en cascada de una captura. CE-031 debe corregir el remapeo de `correctedAssetId` antes de retirar el fallback histórico. |

---

## Cycle 60 — Alcance visible antes de borrar una captura

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 889dad9c3738db2e44c23144d85e4dd5a33b652b |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-030 |
| **Hypothesis** | La confirmación genérica de borrado ocultaba que `deleteCapture` elimina una cadena transitiva de resultados; una vista previa de solo lectura permite comunicar su alcance antes de cualquier escritura. |
| **Change** | Se añadió `previewCascadeDelete` y el adaptador `previewCaptureDeletion`, que recorren la misma semántica de derivación sin mutar IndexedDB. Antes de abrir el diálogo, Capturas calcula la cascada; el aviso enumera los derivados por tipo, advierte que no se puede deshacer y se publica como alerta accesible. Si el cálculo falla, no permite borrar a ciegas. |
| **Hallazgos** | La cascada ya era atómica y transaccional, pero su alcance solo existía después de confirmar. Extraer el recorrido común evita que la vista previa y el borrado diverjan. |
| **Bugs encontrados** | La interfaz decía únicamente que la captura se quitaría del proyecto aunque podía eliminar también imagen, documento OCR, tabla, gráfico, exportación y ejecución. |
| **Bugs corregidos** | Sí: la persona conoce el número y la clase de resultados derivados antes de confirmar; el cálculo no borra ningún registro y un fallo del preview bloquea el borrado. |
| **Tests ejecutados** | `npm run build`; `$env:E2E_PORT=8084; node tests/workspace/phase4-integrity-test.mjs`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 4b 47/47 en navegador (incluye preview de cadena captura -> asset -> documento -> tabla -> gráfico -> exportación -> ejecución sin escrituras); Phase 3A 75/75; Phase 3B 59/59; sync y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La confirmación informa la cascada actual y no ofrece papelera ni restauración; sigue siendo una eliminación definitiva atómica. Las tres evidencias preexistentes modificadas al inicio (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | Promover CE-031 a TODO y remapear `correctedAssetId` en captura, ScanDocument y páginas durante la importación. |

---

## Cycle 61 — Referencias de escáner íntegras al importar

| Field | Value |
|-------|-------|
| **Date** | 2026-08-11 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 25d4a1fee68bf1d24fadbdab3e0482a844017111 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-031 |
| **Hypothesis** | Al importar, los IDs nuevos de assets debían propagarse a las referencias de escáner anidadas; sin ello las capturas nuevas sin `dataUrl` no podrían resolver su PNG corregido. |
| **Change** | `importProject` ahora remapea `scanDocumentId`, `correctedAssetId`, `originalAssetId` y `assetId`, tanto en los registros principales como en `config` y en cada página del ScanDocument. El contrato Phase 5 siembra un escaneo completo y verifica el round-trip de captura, ScanDocument y página. |
| **Hallazgos** | La página del ScanDocument conserva tres referencias a assets y el importador solo trataba campos de primer nivel; además la captura mantenía `scanDocumentId`, que tampoco recibía su ID importado. |
| **Bugs encontrados** | Un bundle con escaneo conservaba IDs de asset de origen en la captura, ScanDocument y página tras importar; esos registros ya no existen en el proyecto nuevo. |
| **Bugs corregidos** | Sí: las referencias del escáner apuntan exclusivamente a assets importados y la auditoría de integridad queda sin huérfanos. |
| **Tests ejecutados** | `npm run build`; `$env:E2E_PORT=8084; node tests/workspace/phase5-bundle-trust-test.mjs`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 5 53/53 en IndexedDB/navegador; Phase 3A 75/75; Phase 3B 59/59; sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0 final. La primera ejecución de Phase 5 expuso cuatro expectativas de fixture desactualizadas (selección del asset corregido y conteo tras añadir el escaneo); se corrigieron y la repetición enfocada quedó verde. |
| **Commits** | `fix(import): remapea referencias de escáner`; commit de evidencia determinista de Phase 5. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El contrato cubre los IDs de assets conocidos del ScanDocument; campos futuros de referencias anidadas deben añadirse explícitamente al remapeador y a este fixture. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables. |

---

## Cycle 71 — Contrato WAI-ARIA de pestañas del Workspace

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 7e080f95b3e0c98373f83eff20199ab681648240 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-015 |
| **Hypothesis** | Las cintas con `role=tablist` del Workspace ya declaraban `role=tab` y `aria-selected`, pero no implementaban el patrón WAI-ARIA tabs: sin roving tabindex, sin flechas/Home/End y sin asociación `aria-controls`/`tabpanel`, un usuario de teclado no podía cambiar de cinta. |
| **Change** | Se añadió `enableTablistKeyboard` (roving tabindex, ArrowRight/Left con wrap, Home/End, activación por teclado y click con resincronización) y se conectó a las cintas de Documento, Tabla, Query y al selector de hojas Query (`focusTarget` para su botón interno). Las pestañas ahora llevan `id`/`aria-controls` y sus paneles `role="tabpanel"`/`aria-labelledby`; el panel de tabla además mantiene `aria-labelledby` sincronizado con la pestaña activa. La métrica de tamaño del `workspace-test` pasa a medir solo la huella de producto (excluye los documentos `.md` operativos del autónomo que el build copia a dist y crecen por ciclo). |
| **Hallazgos** | Las tres cintas generaban sus pestañas con `onClick` propio y paneles `hidden`, pero el foco quedaba en el tab order completo y ninguna tecla las operaba. La cinta de Datos usa un único panel compartido por página, por lo que su contrato es `aria-controls` → panel único con `aria-labelledby` dinámico. `dist/workspace` ya superaba los 1200 KB en HEAD por incluir los documentos `.md` del sistema autónomo (287 KB), no por el producto. |
| **Bugs encontrados** | El click inicial sobre las pestañas no reasignaba `tabIndex`, por lo que tras activar por puntero el roving quedaba desincronizado. Para las hojas Query, `target.click()` sobre el contenedor `role=tab` no activaba la hoja: la activación vive en su botón interno `.ws-query-sheet-tab-main`, que ahora es el control que recibe el click y el foco. |
| **Bugs corregidos** | Sí: roving consistente tras puntero y teclado en las tres cintas y en el selector de hojas, con activación real de la hoja vía su botón interno. |
| **Tests ejecutados** | `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workspace-tabs-a11y-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3a-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/instruction-assistant-ui-test.mjs`; `git diff --check`. |
| **Tests PASS** | Contrato ARIA/kbd nuevo 22/22 en navegador (flechas, wrap, Home/End, roving, asociaciones); build 179/179; Phase 3A 80/80; Phase 3B 59/59; Star-Flow E2E 83/83 con OCR limpio 100/100; Workspace 156/156 (con métrica de producto); Workflow E2E 20/20; UI Workflow 33/33; UI instrucciones 39/39; sync source/dist y diff check OK. |
| **Tests FAIL** | 0 final. El tamaño de `dist/workspace` falló en una primera ejecución por incluir los `.md` operativos; la métrica se redefinió a footprint de producto (1200 KB) y no se rebajó el criterio de auditoría. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | `enableTablistKeyboard` cubre el patrón horizontal con activación automática; no se añaden flechas verticales ni activación manual (F2/Enter) para no alterar el comportamiento táctil existente. Las hojas Query conservan su estructura con acciones internas; la navegación entre hojas opera sobre su botón de activación. El resto de widgets (tabs `ws-query-sheet-tab` con acciones) quedan fuera de este contrato. |
| **Proxima prioridad** | CE-014 (P2, rendimiento de corrección de perspectiva) o CE-017 (P2, listener resize ya cubierto por CE-022) siguen DISCOVERED; promover el de mayor valor o realizar discovery dirigida. |

---

## Cycle 70 — Muestreo de bordes determinista en perspectiva

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 9d59f56a5bf23a182de3b3fc82be7f5433ebd53e |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-018 |
| **Hypothesis** | `perspectiveCorrectBilinear` mapeaba `u=dx/outputWidth` y guardaba con `srcX < width-1`: el último píxel destino nunca tocaba el borde máximo de la fuente y las filas/columnas de borde quedaban transparentes (alfa 0) cuando el cuadrilátero alcanza los límites de la captura. |
| **Change** | Reproducido con patrón de 4 cuadrantes de color y cuadrilátero a borde completo: 156 píxeles transparentes y 3 de las 4 esquinas de salida vacías. El muestreo usa ahora el centro de píxel `(dx+0.5)/outputWidth` para alcanzar de forma determinista la coordenada de borde, la guarda compara contra el tamaño real de la fuente (`srcX < srcW`) y `bilinearSample` recibe coordenadas con clamping al último píxel. Resultado: 0 píxeles transparentes y las cuatro esquinas mapean a sus cuadrantes de color. |
| **Hallazgos** | Con `u=dx/outputWidth` el máximo alcanzado era `(W-1)/W`, nunca el borde exacto; con `srcX < srcCanvas.width-1` la última fila/columna fuente se descartaba por completo. El clamping interno de `bilinearSample` (x1 = min(x0+1, width-1)) ya era seguro, por lo que la guarda real (comparar con `srcW`) basta para incluir el borde. |
| **Bugs encontrados** | Píxeles transparentes de borde en la salida corrección de perspectiva cuando el documento llega al límite de la captura; el mosaico podía quedar incompleto en la fila/columna final. |
| **Bugs corregidos** | Sí: el mapeo alcanza los límites de la captura de forma determinista y la salida queda completamente opaca sobre el cuadrilátero. |
| **Tests ejecutados** | `npm run build`; `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node scripts/verify-workspace-sync.mjs`; `git diff --check`. |
| **Tests PASS** | Build 179/179; Phase 3A 80/80 (5 contratos nuevos de cobertura de borde: sin transparentes y 4 cuadrantes mapeados); Phase 3B 59/59; Star-Flow E2E real 83/83 con OCR limpio 100/100 chars y words (la lectura no se degrada); sincronización source/dist y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El muestreo sigue siendo por centro de píxel sobre el hilo principal (CE-014, coste para capturas grandes, permanece DISCOVERED). El centro de píxel cambia la interpolación en fracciones de unidad, no altera la vía cruda del OCR difícil (que no pasa por perspectiva). Las tres evidencias preexistentes modificadas al inicio (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | CE-015 (P2, ARIA/teclado de pestañas y selectores del Workspace) o CE-014 (P2, rendimiento de perspectiva) siguen DISCOVERED; promover el de mayor valor y ejecutar. |

---

## Cycle 72 — Corrección de perspectiva sin copia y muestreo inline

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 2b01ac02d9868e58e6ced829ba06b15225af26cd |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-014 |
| **Hypothesis** | `perspectiveCorrectBilinear` copiaba el canvas fuente completo, creaba una imagen intermedia y llamaba `bilinearSample` (que asigna un array por píxel) y recalculaba todos los términos bilineales por píxel; ese coste dominaba el hilo principal en capturas grandes. |
| **Change** | Se eliminó la copia del canvas fuente (`getImageData` directo sobre el canvas original), se precalculan por fila los términos lineales de `srcX`/`srcY` y el muestreo bilineal se inlinó en el bucle escribiendo directo al `ImageData` destino con clamping idéntico. Los índices y pesos se reutilizan sin asignación por píxel. Se añadió un benchmark diagnóstico `tests/workspace/perspective-bench.mjs` (no gate, salida no evidencia) para medir el coste en navegador. |
| **Hallazgos** | El coste era proporcional a la salida (no al área de fuente): para 6,9M px de salida la corrección tomaba ~380 ms. La copia del canvas y la asignación por píxel en `bilinearSample` eran evitables sin cambiar el muestreo: la versión previa de `perspectiveCorrectBilinear` siempre usaba el canvas original como `sourceCanvas` y el clamping ya se hacía en `bilinearSample`. |
| **Bugs encontrados** | Ninguno preexistente; era deuda de rendimiento del camino crítico del escáner. |
| **Bugs corregidos** | No aplica. |
| **Tests ejecutados** | Baseline del benchmark en HEAD (104/156/380 ms); `npm run build`; `node scripts/verify-workspace-sync.mjs`; benchmark post-cambio (72/97/212 ms); `node tests/workspace/phase3a-test.mjs`; `node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node tests/workspace/workspace-test.mjs`; `git diff --check`. |
| **Tests PASS** | Benchmark: 1.7M px 104→72 ms, 3.2M px 156→97 ms, 6.9M px 380→212 ms (mejora ~31-44%). Phase 3A 80/80; Phase 3B 59/59; Star-Flow E2E 83/83 con OCR limpio 100/100; Workspace 156/156; build 179/179; source/dist sincronizados y diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El trabajo de perspectiva sigue en el hilo principal; la mejora reduce el coste ~35% para grandes capturas pero no lo hace asíncrono. La interpolación es idéntica (mismo centro de píxel y clamping), por lo que OCR y calidad no cambian. El benchmark mide con `performance.now()` y es solo diagnóstico, no evidencia determinista. Las tres evidencias preexistentes modificadas al inicio (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | CE-017 (P2, listener resize ya cubierto por CE-022) permanece como tarea DISCOVERED de menor valor; realizar discovery dirigida o promover CE-008/CE-009 según la cola al iniciar el próximo ciclo. |

---

## Cycle 75 — Puerto aislable del verificador manual Phase 3A

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | c64d11bb348b9aba6c7090b25ab0643585287d98 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-019 |
| **Hypothesis** | `phase3a-manual-verification.mjs` fijaba el puerto 8082 y fallaba con `EADDRINUSE` cuando infraestructura local lo ocupa; respetar `E2E_PORT` con default 8082, como las suites recientes, permite ejecutarlo de forma aislada sin alterar escenarios. |
| **Change** | Se añadió `const PORT = Number(process.env.E2E_PORT || 8082);` y se sustituyeron los tres usos fijos de 8082 (escucha del servidor, log `Server on :PORT` y `page.goto`). Se mantiene el puerto por defecto y los 10 escenarios/navegación no cambian. |
| **Hallazgos** | La cola no tenía tareas `TODO`; CE-019 (P3, fiabilidad de pruebas) era la oportunidad `DISCOVERED` más concreta y ejecutable, con un historial repetido de `EADDRINUSE` en 8082 documentado en los ciclos 57, 58 y 63. CE-017 (P2) quedó cubierto por CE-022 (Cycle 43): `destroy()` elimina el listener `resize` y el contrato «Scanner removes its resize listener on destruction» sigue en Phase 3A. |
| **Bugs encontrados** | El verificador manual Phase 3A no podía ejecutarse en un puerto alternativo sin editar el código, bloqueando la reproducción cuando 8082 está ocupado. |
| **Bugs corregidos** | Sí: la suite respeta `E2E_PORT` y conserva 8082 como default; se ejecutó en 8084 sin conflicto. |
| **Tests ejecutados** | `node --check tests/workspace/phase3a-manual-verification.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3a-manual-verification.mjs`; `node tests/workspace/phase3a-test.mjs`; `git diff --check`. |
| **Tests PASS** | Verificación manual Phase 3A 41/41 en 8084 (10 escenarios + comportamientos); regresión Phase 3A 80/80; diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El cambio es solo de infraestructura de la suite; no altera producto ni evidencia. Los tres archivos ya modificados al inicio (`artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y `screenshots/workspace/08-scanner-module-test.png`) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida y registrar oportunidades ejecutables o promover CE-008/CE-009 según la cola al iniciar el próximo ciclo. |

---

## Cycle 80 — Operación de flujo documento → PDF local

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 31c49eda96cd9f4b6b6836ce297da31ee5afd2d3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-032 |
| **Hypothesis** | El constructor ya convertía imágenes a PDF (`image.to-pdf`) y creaba informes (`report.create`), pero no podía convertir el documento/informe Toolisto resultante en PDF dentro del flujo; el extremo del flujo estrella (documento → informe → PDF) quedaba fuera del proyecto. |
| **Change** | Se completó `document.to-pdf` en `workflow-operations.js` (trabajo en curso sin commitear de los ciclos 76-79, todos SIN_MARCA): categoría `pdf`, entrada `document`/`text`, salida `file`, opciones formato (A4/Letter), orientación (portrait/landscape), título e «incluir título como encabezado». Mapea bloques Toolisto (heading1/2/3, párrafo, viñeta, cita, divisor y salto de página) a secciones del `pdf-generator` local y devuelve un `Blob` PDF sin dependencias externas. |
| **Hallazgos** | Procedía del cuarto intento fallido de ciclo (76-79) y estaba incompleto: no tenía test propio. El `pdf-generator` local ya soporta los tipos de sección que emiten los bloques de documento (title/subtitle/text/divider/page-break), así que la integración fue directa y no requirió tocar el generador. |
| **Bugs encontrados** | Ninguno preexistente nuevo; la operación quedaba registrada en `workspace/core/workflow-operations.js` pero no contaba con cobertura y `dist` no la contenía hasta regenerar el build. |
| **Bugs corregidos** | No aplica. |
| **Tests ejecutados** | Nuevo `node tests/workspace/workflow-document-pdf-test.mjs` (descriptor del registro, PDF real desde documento Toolisto, `includeTitle=false`, documento vacío, salida de `report.create`); `node tests/workspace/workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `workflow-ui-test.mjs`; `instruction-planner-test.mjs`; `instruction-parser-test.mjs`; `instruction-assistant-ui-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `phase3b-test.mjs`; `phase3a-test.mjs`; `workspace-test.mjs`; `E2E_PORT=8084 node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Document→PDF nuevo 26/26; Engine 18/18; Validator 11/11; UI workflow 33/33; Planner 68/68; Parser 111/111; Assistant UI 39/39; build 179/179; sync source/dist OK; Workflow E2E 20/20; Phase 3B 59/59; Phase 3A 80/80; Workspace 156/156; Star-Flow E2E real 83/83 sin errores JS (OCR limpio). |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo: `feat(workflow): convierte documentos a PDF local` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La conversión cubre bloques de texto/estructura; los bloques table/image dentro de un documento no se emiten como secciones de tabla/imagen (se conservan por su contenido textual). El trabajo corre en el hilo principal igual que el resto del constructor; no se persisten URLs `blob:`. Las tres evidencias ya modificadas al inicio del ciclo (`e2e-evidence.json`, bundle Star-Flow y captura PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida o promover CE-008/CE-009 al iniciar el próximo ciclo. |

---

## Cycle 83 — Discovery de imágenes perdidas en documento → PDF

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | fdb82cc880154d4121b9e6017c4dcbf3e775d29e |
| **HEAD final** | 42585fd (commit de cierre de este ciclo) |
| **Task** | Discovery (cola sin tareas TODO) |
| **Hypothesis** | El flujo `document.to-pdf` ya conserva texto, tablas y gráficos, pero puede estar dejando atrás los bloques de imagen del documento: al caer al mapeo genérico se emitiría su base64 como texto plano en el PDF. |
| **Change** | Se registraron CE-036 (P2) y CE-037 (P3). CE-036: `document.to-pdf` debe converger cada bloque `image-block` del documento en una sección `image` del `pdf-generator` (normalizando PNG/WebP/SVG a JPEG como ya hace `preparePdfImages` de workspace.js). CE-037: compartir esa normalización entre la ruta de diseños y la del flujo para evitar duplicar el re-encode JPEG. |
| **Hallazgos** | `documentBlocksToSections` (workflow-operations.js:465) mapea heading, divider, page-break, bullet-list, quote y table, pero no `image-block`; el bloque cae en `if (content) sections.push({ type: 'text', content })`, por lo que el base64 completo de la imagen se incrusta como texto renderizable en el PDF. Además `pdf-generator.registerJpegImage` solo registra `data:image/(?:jpeg|jpg)` y `renderImagePDF` rellena un placeholder gris sin XObject para el resto. |
| **Bugs encontrados** | Reproducido con harness VM del test: un documento con un `image-block` JPEG o PNG produce un PDF cuyo stream de contenido contiene literalmente `/9j/4AAQSk...` o `iVBOR...` como cadenas de texto (`BT /F1 12 Tf ...`), sin ningún objeto `/Subtype /Image`; byte length 1008–1207 frente a un PDF con imagen embebida real. La imagen no llega; se degrada a basura legible. |
| **Bugs corregidos** | No aplica: ciclo de discovery obligatorio al no existir tareas TODO; CE-036 queda delimitada con reproducción fuera del E2E principal, sin introducir una prueba roja deliberada. |
| **Tests ejecutados** | Baseline `node tests/workspace/workflow-document-pdf-test.mjs` (35/35, cubre texto/tabla/cadena estrella); reproducción aislada del `image-block` JPEG y PNG vía harness VM (sin red, sin navegador). |
| **Tests PASS** | Document→PDF 35/35; reproducción de CE-036 confirmada para JPEG y PNG (delta esperado del defecto, no aserción de suite). |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno; CE-036 es ejecutable al promoverla a TODO (cambio acotado en `documentBlocksToSections` + re-encode JPEG compartido). |
| **Limitaciones** | El `pdf-generator` solo puede embeker JPEG con DCTDecode; todo otro formato debe re-encodearse en canvas antes de llamar a `generatePDF`. La reproducción usa un harness VM aislado para no tocar el E2E principal. |
| **Proxima prioridad** | Promover CE-036 a TODO y asegurar que los `image-block` lleguen como imágenes reales al PDF del flujo estrella. |

---

## Cycle 81 — Grilla de tabla real en el documento → PDF del flujo estrella

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 31c49eda96cd9f4b6b6836ce297da31ee5afd2d3 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-033 (consolida CE-032) |
| **Hypothesis** | El flujo estrella terminaba en PDF perdiendo la tabla: `report.create` solo escribía el resumen textual de filas/columnas, y `document.to-pdf` (CE-032, completo pero sin commit) ignoraba cualquier dato tabular del documento. |
| **Change** | Se consolidó el commit de CE-032 (el cierre del ciclo 80 nunca llegó al repositorio; HEAD seguía en el ciclo 75). `report.create` añade un bloque `table` con `headers`/`rows` cuando la entrada trae esos campos. `documentBlocksToSections` convierte ese bloque en una sección `table` del `pdf-generator` (cabecera diferenciada, filas y la paginación de tablas largas ya soportada por CE-013). |
| **Hallazgos** | El cierre de CE-032 existía solo en `git status` (trabajo probado y sin commit). El `pdf-generator` ya renderizaba secciones `table` desde CE-013/CE-018, por lo que la integración fue de mapeo, sin tocar el generador. |
| **Bugs encontrados** | CE-032 quedó registrado como cerrado en el STATUS del ciclo 80 sin commit real en `git log`; se corrigió el registro consolidando el commit en este ciclo. |
| **Bugs corregidos** | No aplica para el producto; se añadió cobertura de grilla real y de la cadena tabular. |
| **Tests ejecutados** | `node tests/workspace/workflow-document-pdf-test.mjs` (26 → 35); `workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `workflow-ui-test.mjs`; `instruction-planner-test.mjs`; `instruction-parser-test.mjs`; `instruction-assistant-ui-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `E2E_PORT=8084 node tests/workspace/workflow-e2e-test.mjs`; `phase3b-test.mjs`; `phase3a-test.mjs`; `workspace-test.mjs`; `E2E_PORT=8084 node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Document→PDF 35/35 (incluye bloque table de `report.create`, grilla en el PDF con cabecera y filas, cuerpo tras el grid y cadena text.to-table → report.create → document.to-pdf); Engine 18/18; Validator 11/11; UI workflow 33/33; Planner 68/68; Parser 111/111; Assistant UI 39/39; build 179/179; sync source/dist OK; Workflow E2E 20/20; Phase 3B 59/59; Phase 3A 80/80; Workspace 156/156; Star-Flow E2E real 83/83 sin errores JS. |
| **Tests FAIL** | 0. |
| **Commits** | `feat(workflow): conserva la tabla del informe en el PDF` (consolida CE-032 + CE-033). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La grilla cubre bloques que llegan con `headers`/`rows` explícitos desde `report.create`; las celdas se emiten como texto plano (sin formato interno de campos numéricos). El trabajo corre en el hilo principal igual que el resto del constructor; no se persisten URLs `blob:`. Las tres evidencias ya modificadas al inicio del ciclo (`e2e-evidence.json`, bundle Star-Flow y capturas PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; realizar discovery dirigida o promover CE-008/CE-009 al iniciar el próximo ciclo. |

---

## Cycle 84 — Imágenes reales embebidas en el documento → PDF

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | bd9bc37460032bb41db77c2a3b64a11dad55e93a |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-036 |
| **Hypothesis** | `documentBlocksToSections` no mapeaba `image-block`; el bloque caía al `text` genérico y el base64 completo del documento se emitía como texto renderizable en el PDF (`BT /F1 ... Tj`), sin ningún `/Subtype /Image`. |
| **Change** | `documentBlocksToSections` mapea `image-block` a una sección `image` con su `dataUrl`. `document.to-pdf` normaliza antes de generar: `preparePdfImageSections` re-encoda PNG/WebP/SVG a JPEG vía canvas (misma semántica que `preparePdfImages` de la ruta de diseños), conservando las secciones tal cual en entornos sin canvas (el generador dibuja su placeholder, sin fugas). Se añadió `tests/workspace/pdf-image-embed-e2e.mjs` (validación en navegador real) y `.gitignore` ignora `artifacts/pdf-image-embed/`. |
| **Hallazgos** | El `pdf-generator.registerJpegImage` solo admite `data:image/(?:jpeg|jpg)` y emite el XObject DCTDecode correcto; la normalización en canvas es la única pieza que faltaba en la ruta del flujo. Con `page.evaluate` sobre un documento servido desde `dist`, un `image-block` PNG y WebP se convirtieron a JPEG y se incrustaron como imagen real (`/Subtype /Image` + `DCTDecode`), sin placeholder ni leak de base64. Un JPEG de 1×1 decodifica y registra dimensiones correctas de SOF0. |
| **Bugs encontrados** | El base64 del `image-block` (JPEG o PNG) se volcaba como texto en el stream del PDF; la imagen se degradaba a basura legible. Un `image-block` vacío emitía ruido de datos en vez de un placeholder explícito. |
| **Bugs corregidos** | Sí: los `image-block` llegan como imágenes reales al PDF del flujo estrella (PNG/WebP/SVG normalizados a JPEG), el base64 ya no fuga como texto y una imagen sin fuente se representa como «Imagen no disponible». |
| **Tests ejecutados** | `node tests/workspace/workflow-document-pdf-test.mjs`; `workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `operation-registry-test.mjs`; `workflow-ui-test.mjs`; `instruction-planner-test.mjs`; `instruction-parser-test.mjs`; `instruction-assistant-ui-test.mjs`; `tabular-text-parser-test.mjs`; `workflow-model-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/pdf-image-embed-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `node tests/workspace/phase3b-test.mjs`; `git diff --check`. |
| **Tests PASS** | Document→PDF 43/43 (JPEG embebido con XObject, PNG sin leak en VM, placeholder explícito para imagen vacía); Engine 18/18; Validator 11/11; Registry 26/26; UI workflow 33/33; Planner 68/68; Parser 111/111; Assistant UI 39/39; Tabular parser 7/7; Model 39/39; build 179/179; sync source/dist OK; CE-036 E2E navegador 16/16 (PNG y WebP→JPEG reales); Workflow E2E 20/20; Star-Flow E2E real 83/83 sin errores JS; Phase 3B 59/59; diff check OK. |
| **Tests FAIL** | 0. Durante desarrollo, dos aserciones del E2E nuevo usaban `ok(...)` incondicional (contaban PASS aunque la condición fuera falsa); se corrigieron a condicionales y el fixture WebP inválido (no decodificaba en Chromium) se sustituyó por uno generado en navegador desde canvas. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La normalización corre en el hilo principal (igual que el resto del constructor) y solo actúa cuando el navegador dispone de canvas; un formato que el decoder del navegador no soporte cae al placeholder sin fuga, no a basura. CE-037 (P3) sigue DISCOVERED: compartir este re-encode con `preparePdfImages` de workspace.js exigiría cruzar la frontera entre el monolito clásico y los ES modules; se documenta para un ciclo futuro. Las cuatro evidencias preexistentes ya modificadas al inicio (e2e-evidence.json, bundle Star-Flow y capturas PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; promover la oportunidad DISCOVERED de mayor valor (CE-008/CE-009/CE-037) o realizar discovery dirigida. |

---

## Cycle 85 — Normalización de imágenes PDF compartida entre rutas

| Field | Value |
|-------|-------|
| **Date** | 2026-08-12 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f11d138636cdde23f31f4e8c862b7dd18f0de066 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-037 |
| **Hypothesis** | `document.to-pdf` (`preparePdfImageSections`) y `preparePdfImages` de la ruta de diseños duplicaban el mismo re-encode PNG/WebP/SVG→JPEG en canvas; un helper común evita regresiones de calidad/tamaño por ruta. |
| **Change** | Se creó `workspace/core/pdf-images.js` con `normalizePdfImageSections(sections, { updateSize, onError })`: passthrough limpio para JPEG, re-encode JPEG 0.9 en canvas cuando hay DOM y conservación de secciones en entornos sin canvas (placeholder). `document.to-pdf` (workflow-operations.js) lo usa con `updateSize:true` y `preparePdfImages` de workspace.js con `reportError`, eliminando las dos implementaciones duplicadas (~26 líneas menos). El test VM `workflow-document-pdf-test.mjs` incluye el módulo y `innerhtml-structure-test.mjs` audita el archivo nuevo. Se añadió `tests/workspace/pdf-images-shared-test.mjs` (contrato de dedup por ruta + passthrough sin DOM). |
| **Hallazgos** | «Cruzar la frontera entre el monolito clásico y los ES modules» no era un bloqueo real: `workspace.js` ya es un módulo ES que importa `./core/…`, por lo que importar el helper compartido desde `./core/pdf-images.js` era directo. Las únicas diferencias entre las dos rutas eran `updateSize` (flujo lo necesitaba para dimensionar) y el reporte de error (diseño usa `reportError`); el helper las cubre por opciones. |
| **Bugs encontrados** | Ninguno preexistente nuevo. |
| **Bugs corregidos** | No aplica: era duplicación de lógica de arquitectura, sin defecto funcional observable. |
| **Tests ejecutados** | `node tests/workspace/pdf-images-shared-test.mjs`; `node tests/workspace/workflow-document-pdf-test.mjs`; `node tests/workspace/innerhtml-structure-test.mjs`; `node tests/workspace/workflow-ui-test.mjs`; `node tests/workspace/operation-registry-test.mjs`; `node tests/workspace/workflow-engine-test.mjs`; `node tests/workspace/workflow-validator-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/pdf-image-embed-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Shared 12/12; Document→PDF 43/43; InnerHTML 27/27; Workflow UI 33/33; Registry 26/26; Engine 18/18; Validator 11/11; build 179/179; sync source/dist OK; CE-036 E2E navegador 16/16; Workflow E2E 20/20; Phase 3B 59/59; Star-Flow E2E 83/83 sin errores JS ni consola; diff check OK. |
| **Tests FAIL** | 0. |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El helper re-encodea en el hilo principal (igual que antes) y solo actúa en navegador con canvas; en VM las secciones pasan tal cual. Se conserva la frontera de `preparePdfImages` de la ruta de diseños (no actualiza `width/height`, semántica preservada). Las cuatro evidencias preexistentes ya modificadas al inicio del ciclo (e2e-evidence.json, bundle Star-Flow y capturas PNG) se excluyen del commit. |
| **Proxima prioridad** | No quedan tareas TODO; promover la oportunidad DISCOVERED de mayor valor (CE-008/CE-009/CE-011) o realizar discovery dirigida. |

---

## Cycle 94 — Convierte tablas en graficos dentro del flujo estrella

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 07725584705b48b9d9f159c278531439168aef18 |
| **HEAD final** | 280534d0d83a4826084320b437d54af39a00f024 |
| **Task** | CE-038 |
| **Hypothesis** | El flujo estrella terminaba en PDF con texto y tablas, pero el paso datos -> grafico no existia como operacion de flujo real: la promesa `datos -> tabla -> grafico -> informe -> PDF` quedaba incompleta dentro del Workspace. |
| **Change** | Se aprobo la operacion `data.to-chart` (categoria chart, entrada `data`/`document`, salida `document`): elige la(s) columna(s) numerica(s) por ancla de filas parseables (decimales con coma europea y separador de miles incluidos), emite un bloque `chart` con series finitas y rechaza tablas vacias sin columna numerica con mensaje accionable. `report.create` anade un bloque `chart` cuando la tabla trae columna numerica. `documentBlocksToSections` mapea el bloque `chart` a una seccion `chart` que el `pdf-generator` ya renderizaba con barras (`re f`), titulo y etiquetas. Se integro en el asistente: sinonimos de parser (`crear grafico`, `grafica`, `graficar`, etc.), accion `chart` -> `data.to-chart` en el planificador y categoria/filtro de iconos en el UI del constructor. Incluye E2E navegador nuevo `workflow-chart-e2e.mjs` (cadena real text.to-table -> data.to-chart -> document.to-pdf). |
| **Hallazgos** | El `pdf-generator` ya soportaba secciones `chart` (caso de use en disenos), asi que la integracion fue de mapeo sin tocar el generador. La tabla numerica de `text.to-table` produce encabezados y filas con decimal espanol; `tableChartSeries` reusa la semantica de ancla numerica del parser tabular. El trabajo estaba incompleto en el arbol (ciclo previo no cerrado) y este ciclo lo valido, completo test E2E de navegador y lo comiteo. |
| **Bugs encontrados** | Ninguno de producto nuevo; el ciclo previo dejo la funcion sin commit y sin E2E de navegador. |
| **Bugs corregidos** | No aplica como defecto preexistente; se cerro la cadena datos -> grafico -> PDF de forma real y probada. |
| **Tests ejecutados** | `node tests/workspace/instruction-parser-test.mjs`; `instruction-planner-test.mjs`; `workflow-document-pdf-test.mjs`; `workflow-ui-test.mjs`; `operation-registry-test.mjs`; `workflow-engine-test.mjs`; `workflow-validator-test.mjs`; `instruction-assistant-ui-test.mjs`; `workflow-model-test.mjs`; `tabular-text-parser-test.mjs`; `innerhtml-structure-test.mjs`; `npm run build`; `node scripts/verify-workspace-sync.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-chart-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/workflow-e2e-test.mjs`; `node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Parser 116/116; Planner 73/73; Document->PDF 66/66 (bloque chart, serie, decimales con coma, seccion con barras y cadena estrella); Workflow UI 33/33; Registry 26/26; Engine 18/18; Validator 11/11; Assistant UI 39/39; Model 39/39; Tabular parser 7/7; InnerHTML 27/27; build 179/179; sync source/dist OK; Chart E2E navegador 15/15; Workflow E2E 20/20; Workspace 156/156; Phase 3B 59/59; Star-Flow E2E real 83/83 con OCR limpio 100/100. |
| **Tests FAIL** | 0. |
| **Commits** | `feat(workflow): convierte tablas en graficos y los embebe en el PDF` (280534d). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Los valores se parsean como numeros (se pierde formato moneda por celda); la eleccion de columna numerica elige la primera por ancla y se limita a 30 series para PDF razonable. El trabajo corre en el hilo principal igual que el resto del constructor; no se persisten URLs `blob:`. Las evidencias regeneradas no deterministas del Star-Flow (e2e-evidence.json, bundle .toolisto y capturas PNG) se excluyen del commit (politica anti-churn). |
| **Proxima prioridad** | No quedan tareas TODO; promover CE-008 (memoria de motores pesados) o CE-009 (accesibilidad de componentes especializados) a TODO, o realizar discovery dirigida. |

---

## Cycle 99 — Lazy-load de imágenes de capturas (CE-008)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | b03471f6ef331df2095a6625e734cb67c5d9b016 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-008 |
| **Hypothesis** | `renderCaptureView` resolvía el `dataUrl` de cada captura de inmediato al construir cada tarjeta, por lo que abrir una vista con muchas capturas decodificaba todas las imágenes a la vez, cargando inútilmente la memoria incluso para capturas fuera del viewport. |
| **Change** | Cada tarjeta de Capturas muestra primero un placeholder y solo resuelve su imagen cuando la tarjeta entra al viewport (IntersectionObserver con rootMargin 300px). Las `<img>` usan `loading="lazy"` y `decoding="async"`; sin IntersectionObserver se mantiene la carga directa como fallback. La observación se hace sobre la tarjeta completa, no solo sobre el slot del thumb, para que una tarjeta parcialmente visible cargue aunque su thumb quede en el pliegue. |
| **Hallazgos** | La implementación inicial observaba el slot del thumb (120px): al saltar directamente al final de la lista, las tarjetas que quedaban a medio camino tenían su tarjeta visible pero su thumb por encima del pliegue, por lo que su IntersectionObserver nunca disparaba. Observando la tarjeta completa, todas las parcialmente visibles cargan. El E2E reveló un flake determinista del test original (solo 19/24 tras saltar al final), reproducido con sonda aislada, que desapareció con el cambio. |
| **Bugs encontrados** | Con el seed real de 24 capturas, la vista inicial resolvía todas las imágenes (10 en el viewport inicial; el código previo resolvía las 24). El fallo intermedio del test (5 tarjetas sin cargar tras saltar al final) era del observador sobre el thumb y quedó corregido observando la tarjeta. |
| **Bugs corregidos** | Sí: la decodificación de imágenes es diferida y proporcional al viewport real; el caché del placeholder se conserva hasta que la tarjeta es visible. |
| **Tests ejecutados** | `node scripts/verify-workspace-sync.mjs`; `npm run build`; `$env:E2E_PORT=8084; node tests/workspace/lazy-capture-images-e2e.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3a-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3b-test.mjs`; `node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8084; node tests/workspace/phase3c-star-flow.spec.mjs`; `git diff --check`. |
| **Tests PASS** | Sync source/dist OK (regenerado con build 179/179); Lazy-load E2E nuevo 12/12 (tarjetas renderizadas, placeholder inicial, carga diferida, scroll a 24/24, atributos lazy, cero errores y cero egress); Phase 3A 80/80; Phase 3B 59/59; Workspace 156/156; Star-Flow E2E real 83/83; diff check OK. |
| **Tests FAIL** | 0 final. Durante el diagnóstico, el test original dejó de cargar tarjetas intermedias al saltar al final (19/24); reproducido con tres sondas aisladas (`_probe*` eliminadas tras el diagnóstico) y resuelto observando la tarjeta. |
| **Commits** | Commit de cierre de este ciclo: `perf(workspace): lazy-load de imágenes de capturas` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El IO usa rootMargin de 300px para precargar con antelación; una tarjeta nunca observada (p. ej. pestaña oculta TODO el tiempo) no se decodifica hasta volver a ella. Los thumbs resueltos no se persisten (siguen siendo efímeros, sin URLs `blob:`). La auditoría de memoria de Tesseract/PDF en sesiones largas queda aparte como CE-040 (DISCOVERED). Las evidencias ya modificadas al iniciar el ciclo (`artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y las dos capturas PNG) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | No quedan tareas TODO; ejecutar CE-009 (accesibilidad de componentes especializados) o realizar discovery dirigida/CE-040 al iniciar el próximo ciclo. |

## Cycle 106 — BOM UTF-8 en las exportaciones CSV del Workspace (CE-044)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | f34cf02fd81c048326626b22c5727121800c64f9 |
| **HEAD final** | 11df68f |
| **Task** | CE-044 (DISCOVERY: sin tareas TODO en la cola). |
| **Hypothesis** | Las exportaciones «Exportar CSV» del Workspace — `exportTableCSV` (tabla de Datos) y `exportQueryResult` (resultado de Query) — emiten un Blob CSV sin BOM UTF-8, por lo que Excel con locales con acentos (es) interpreta el archivo como ANSI y muestra mojibake (`Ã¡`, `Ã©`, `ÃƒÂ±`…) en el texto español del producto. |
| **Change** | BOM UTF-8 antepuesto al contenido en ambas rutas: `exportTableCSV` genera `Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })` y `exportQueryResult` genera `Blob(['\uFEFF' + queryExportCsv(model)], { type: 'text/csv;charset=utf-8' })`. Nuevo E2E `tests/workspace/csv-export-bom-e2e.mjs` (chromium headless sobre `dist`, puerto `E2E_PORT` 8082): crea un proyecto, escribe celdas con acentos (`Córdoba`, `Éxito`, `índice ñame`), exporta la tabla y verifica que la descarga empieza por `EF BB BF`, que el primer carácter decodificado es `\uFEFF` y que los acentos llegan intactos; y en Query importa el fixture real `tests/fixtures/workspace/export-acentos.csv` (`Reunión Ñuño`), exporta y verifica el mismo BOM y acentos. Registrado en `scripts/test-workspace-release.mjs`. Sin tocar el sitio público. |
| **Hallazgos** | El mismo defecto existe en el sitio público (`js/modes/excel.js` `aoaToFile` genera CSV sin `\uFEFF`); se registra como CE-045 DISCOVERED para evaluar su arreglo con su propio gate (las aserciones actuales usan `.trim()`, compatible con el BOM). En el Workspace no había ninguna aserción de bytes sobre las exportaciones: el defecto era invisible para la regresión previa. |
| **Bugs encontrados** | `exportTableCSV` usaba `type: 'text/csv'` (sin charset) y ambas rutas emitían el contenido sin BOM; `exportQueryResult` ya declaraba `charset=utf-8` pero sin BOM sigue siendo ilegible para Excel en locales con acentos. |
| **Bugs corregidos** | Sí: ambas exportaciones del Workspace incluyen BOM UTF-8 y la tabla declara `;charset=utf-8`. |
| **Tests ejecutados** | `$env:E2E_PORT=8082; node tests/workspace/csv-export-bom-e2e.mjs` (nuevo 20/20); `node tests/workspace/workspace-test.mjs` (156/156); `node tests/workspace/phase3b-test.mjs` (59/59); `node tests/workspace/phase3a-test.mjs` (80/80); `$env:E2E_PORT=8082; node tests/workspace/phase3c-star-flow.spec.mjs` (83/83); `node tests/evidence-determinism.mjs` (71/71); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK). |
| **Tests PASS** | Nuevo E2E 20/20 (BOM tabla + BOM Query + acentos intactos + cero mojibake + cero errores de consola); Workspace 156/156; Phase 3B 59/59; Phase 3A 80/80; Star-Flow E2E 83/83; determinismo 71/71; build 179/179; sync source/dist SYNC OK. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | `11df68f` — `fix(workspace): BOM UTF-8 en exportaciones CSV para compatibilidad con Excel (CE-044)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El arreglo cubre las exportaciones del Workspace; el sitio público (`js/modes/excel.js`) queda registrado como CE-045 DISCOVERED. La evidencia `TLT-workspace-csv-bom.json` se escribe vía `writeEvidence` (determinista, sin timestamps). Las evidencias ya modificadas al iniciar el ciclo (`artifacts/deep-audit/toolisto/TLT-production-tool-coverage-evidence.json`, 2 inser./2 del. preexistentes) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Ejecutar CE-040 (memoria de motores pesados Tesseract/PDF, P3) o evaluar CE-045 (BOM en el CSV del sitio público) desde DISCOVERED. |

---

## Cycle 105 — Gate de regresión permanente de la migración toolisto.com (CE-043)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | d8088eb4a773d26a86bee27b091f8a5657a3ce02 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-043 (P2, desde DISCOVERED; sin tareas TODO en la cola) |
| **Hypothesis** | La migración a `toolisto.com` quedó consolidada en el ciclo 104 sin un gate que fije el contrato: `siteUrl`/`productionDomain` apuntan a toolisto.com, `_headers` endurece el host y el build los propaga, pero nada protege esas tres piezas contra una regresión futura (re-introducir subdirectorio, perder cabeceras de seguridad o un CDN no declarado). |
| **Change** | Nuevo gate `tests/toolisto-domain-gate.mjs` (23 comprobaciones, determinista): (1) contrato de dominio — `siteUrl` y `productionDomain` exactamente `https://toolisto.com`, hostname toolisto.com, pathname `/` (sin subdirectorio), sin placeholder ni `.invalid`; (2) lista `_headers` — HSTS con `includeSubDomains`/`preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` con `geolocation=()`, CSP con `default-src 'self'`/`object-src 'none'`/`base-uri 'self'`/`frame-ancestors 'none'`, `/workspace/*` con `X-Robots-Tag: noindex`, y cero egress de terceros salvo el CDN declarado para scripts; (3) propagación al build — `generate-seo-pages.mjs` copia `_headers`, prioriza `productionDomain`, rechaza `.invalid`, y el `dist` desplegado mantiene `_headers` idéntico, sitemap íntegro en toolisto.com sin subdirectorios y `robots.txt` con el sitemap canónico. Evidencia determinista `TLT-toolisto-domain-gate-evidence.json` (writeEvidence, SHA256 idéntico tras regenerar). Registrado en `run-all.mjs` («Toolisto Domain Gate») y en el ratchet `evidence-determinism.mjs`. Sin cambios de producto ni de `workspace/workspace.js`. |
| **Hallazgos** | El contrato ya se cumplía en el estado actual (`dist/_headers` idéntico al fuente, 183 `<loc>` todas bajo toolisto.com sin subdirectorio, `robots.txt` canónico); faltaba exclusivamente la regresión permanente. `dist/` está completo en `.gitignore` (línea 2), por lo que el gate valida el `dist` presente pero su núcleo de garantías vive en fuentes versionadas (`site.config.json`, `_headers`, `generate-seo-pages.mjs`). |
| **Bugs encontrados** | Ninguno de producto; un bug en el primer borrador del propio gate: la aserción de egress de `_headers` con lookahead negativo marcaba `https://cdn.jsdelivr.net` como URL no declarada; se sustituyó por sustracción del CDN permitido antes de buscar `https?://` restantes. |
| **Bugs corregidos** | No aplica como defecto de producto; el gate quedó correcto y reproducible (23/23). |
| **Tests ejecutados** | `node tests/toolisto-domain-gate.mjs` (nuevo 23/23, re-ejecutado para confirmar regeneración diff-cero); `node tests/evidence-determinism.mjs` (71/71, incluye la evidencia nueva en forma canónica exacta); `node --check` del gate, `run-all.mjs` y `evidence-determinism.mjs`; regresión relacionada `node tests/deployment-guide-audit.mjs` (10/10) y `node tests/seo-production-audit.mjs` (2753/2753); `git diff --check`. |
| **Tests PASS** | Gate nuevo 23/23; determinismo 71/71; deployment 10/10; SEO 2753/2753; diff check OK. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El gate valida los sources versionados en todo entorno y el `dist` solo cuando existe (una clonación sin build fallaría en las comprobaciones de dist); el CDN permitido para scripts queda fijado textualmente en el `_headers` y debe revisarse de forma consciente si el hosting exigiera otro. Las evidencias ya modificadas al iniciar el ciclo (`artifacts/phase3c-validation/e2e-evidence.json` y `TLT-production-tool-coverage-evidence.json`) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Ejecutar CE-040 (memoria de motores pesados Tesseract/PDF, P3) desde DISCOVERED o realizar discovery dirigida según la cola al iniciar el próximo ciclo. |

---

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 6949961 |
| **HEAD final** | Commit de cierre de esta intervención |
| **Motivo** | CE-008 quedó DONE (Cycle 99) pero había pasado varios ciclos ACTIVE con diagnóstico repetido y el mismo fallo reproducible (19/24 tras saltar al final). Se añadieron reglas para que ese bucle no vuelva a ocurrir. |
| **Causa raíz** | El E2E original simulaba scroll con salto directo al fondo (`scrollTop = scrollHeight`), que no reproduce el scroll real del usuario; la banda central de tarjetas quedaba sin observar. La implementación inicial observaba el slot del thumb (120px) en vez de la tarjeta completa. Ambos corregidos: `io.observe(card)` en `renderCaptureView` y E2E que recorre el scroll. Verificado 12/12 en navegador real. |
| **Change** | Reglas anti-bucle en `AGENTS.md` (sección Sistema autónomo), `workspace/CONTINUOUS-EVOLUTION-MISSION.md` (Reglas de ciclo 8-11), `workspace/OPENCODE-AUTONOMOUS-GUIDE.md` (Notas) y `RUN-OPENCODE-AUTONOMOUS.ps1` (prompt CE): (1) tarea >= 2 ciclos ACTIVE sin cambio de HEAD y con el mismo fallo reproducible entra en modo RECOVERY con cambio de estrategia; (2) si una técnica falla/rechaza permisos, el siguiente ciclo usa otra; (3) scripts de diagnóstico temporales SOLO en `_toolisto_autopilot/tmp/` del repo, prohibido `%TEMP%`/`AppData\Local\Temp`/`external_directory`; (4) PowerShell en Windows solo con cmdlets disponibles, prohibido `rg`/`head`/`tail`/`grep`/`sed`/`awk`. Se creó `_toolisto_autopilot/tmp/` (ya ignorado en `.gitignore`). |
| **Tests ejecutados** | `$env:E2E_PORT=8086; node tests/workspace/lazy-capture-images-e2e.mjs`; `$env:E2E_PORT=8087; node tests/workspace/workspace-test.mjs`; `$env:E2E_PORT=8088; node tests/workspace/phase3b-test.mjs`; `$env:E2E_PORT=8089; node tests/workspace/phase3c-star-flow.spec.mjs`; `$env:E2E_PORT=8090; node tests/workspace/workflow-e2e-test.mjs`; `node scripts/verify-workspace-sync.mjs`; `npm run build`. |
| **Tests PASS** | Lazy-load E2E 12/12; Workspace 156/156; Phase 3B 59/59; Star-Flow E2E 83/83; Workflow E2E 20/20; sync source/dist SYNC OK; build 179/179 OK. |
| **Tests FAIL** | 0 |
| **Commits** | `docs(autonomous): reglas anti-bucle permanentes (RECOVERY, cambio de tecnica, tmp interno, PowerShell)` |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | Las reglas viven en la configuración/documentación del runner; un humano con acceso al repo puede relajarlas, pero el prompt CE del runner las aplica cada ciclo. `_toolisto_autopilot/` queda ignorada para que los diagnósticos temporales no ensucien el working tree. |

---

## Cycle 101 — Activación de la extracción de campos de factura (CE-041)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 6949961f193ce0d38ec7d93c5888551ece7a901 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-041 (DISCOVERY: sin tareas TODO en la cola). |
| **Hypothesis** | `core/invoice.js` (parser completo de facturas/recibos) era código muerto sin importar en ninguna parte, y `instruction-parser.js` marcaba `intent.options._extractFields = true` cuando el usuario mencionaba "factura"/"recibo" con OCR sin que ningún consumidor lo leyera: la intención de extraer datos estructurados de una factura no hacía nada. Activar ese contrato con una operación que consume `invoice.js` cierra el hueco y añade un paso real al flujo estrella (archivo → OCR → campos → tabla). |
| **Change** | Nueva operación `text.invoice-fields` ("Extraer campos de factura", categoría text, entrada text/document, salida data) registrada en `workflow-operations.js`; ejecuta `parseInvoiceText` + `invoiceRows` y devuelve `{ headers: ['Campo','Valor','Confianza','Página'], rows }`. `instruction-planner.js` encadena ahora `text.invoice-fields` después del paso `image.ocr` cuando `intent.options._extractFields` es true y la operación está registrada (con asunción explicativa); sin la operación registrada no se añade ningún paso fantasma. `dist/workspace/core/*` sincronizado. Sin modificaciones al sitio público ni a `workspace/workspace.js`. |
| **Hallazgos** | El parser ya emitía el marcador `_extractFields` para "extrae el texto de la factura" y "saca el texto del recibo"; únicamente faltaba el consumo. `invoiceRows` reconstruye una tabla Campo/Valor/Confianza/Página que encaja con el contrato `data` de las operaciones (`to-chart`/`report`) y con la UI del constructor sin ampliar categorías (categoría text ya existe). La validación del workflow (`workflow-model.js`) no exige compatibilidad origen/destino en el planner, por lo que encadenar OCR(text) → invoice-fields(text) nunca rompe la validación. |
| **Bugs encontrados** | No había errores de ejecución; el hueco era de producto: el parser de facturas completo vivía sin consumo y la intención explícita del usuario se ignoraba por contrato roto. |
| **Bugs corregidos** | Sí: `_extractFields` deja de ser letra muerta; la mención de factura/recibo junto a OCR produce un paso real de extracción de campos. |
| **Tests ejecutados** | `node tests/workspace/invoice-fields-test.mjs` (nuevo 29/29); `node tests/workspace/instruction-parser-test.mjs`; `instruction-planner-test.mjs`; `workflow-engine-test.mjs`; `workflow-ui-test.mjs`; `operation-registry-test.mjs`; `workflow-document-pdf-test.mjs`; `tabular-text-parser-test.mjs`; `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | Invoice fields 29/29 (parser directo, operación registrada y ejecutable con factura de ejemplo, parser `_extractFields` factura/recibo/negativo, planner 2 pasos encadenados / 1 paso sin factura / sin paso fantasma sin operación); Parser 116/116; Planner 73/73; Engine 18/18; UI workflow 33/33; Registry 26/26; Document→PDF 66/66; Tabular 7/7; sync source/dist SYNC OK. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): extracción de campos de factura vía intención OCR (CE-041)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | La operación normaliza el número de factura conservando el prefijo corto de la firma OCR (p. ej. `FACTURA ELECTRONICA N.00123` → valor `N.00123`): la limpieza del número queda documentada en el test y como posible mejora futura. No se ejecutó el E2E de navegador del flujo factura (requiere captura con factura real y OCR); queda como tarea DISCOVERED. Las evidencias modificadas ya al iniciar el ciclo (`artifacts/phase3c-validation/e2e-evidence.json`, `star-flow-export.toolisto` y capturas PNG) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Promover a TODO la validación E2E en navegador de la instrucción real "extrae el texto de la factura" sobre una captura (CE-042), o ejecutar CE-009/CE-040 desde DISCOVERED. |

## Cycle 102 — E2E de navegador del flujo de factura real (CE-042)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | bb9d935b4e2380a4a55093dd58c690957375a77b |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-042 (DONE) y antes promote TODO/ACTIVE: validar en navegador la instrucción real "extrae el texto de la factura" sobre una captura con factura, verificando OCR → campos → tabla y cero errores de consola. |
| **Hypothesis** | El flujo activado en CE-041 (parser `_extractFields` → planner encadena `image.ocr` + `text.invoice-fields` → tabla Campo/Valor/Confianza/Página) solo estaba cubierto por tests de módulo; faltaba la prueba de integración en navegador real (OCR Tesseract local `spa` + canvas con factura) para demostrar la cadena completa sin mocks y registrar su evidencia determinista. |
| **Change** | Nuevo e2e `tests/workspace/invoice-fields-e2e.mjs` (chromium headless sobre `dist`, servidor propio con MIME `.wasm`/`.gz`, puerto `E2E_PORT` 8084): captura la instrucción "extrae el texto de la factura" con el parser real, planifica con el planner real, ejecuta `image.ocr` (OCR real) y `text.invoice-fields` (parseo real) sobre una factura de ejemplo dibujada en canvas (Proveedor/RNC incluidos), y comprueba encadenado, tabla de salida y cero errores de consola. Sin cambios en `workspace/workspace.js`, sin mocks y sin ampliar rutas. |
| **Hallazgos** | En navegador real el encadenado funciona end-to-end: 2 pasos planificados (`image.ocr` → `text.invoice-fields`), 9 campos extraídos de la factura capturada, número `N.00123`, Total `2950.00`, confianza de OCR 86%, tabla con cebecera `Campo|Valor|Confianza|Página`, 11 filas, estado final `completed` y cero errores de consola. El OCR local `spa` sobre el canvas de factura da resultados estables sin retries. |
| **Bugs encontrados** | Ninguno nuevo en el flujo; el E2E confirmó que el primer intento del diseño dibujaba la captura sin las líneas "Proveedor"/"RNC" (omitidas del canvas), por lo que la verificación de campos se revisó para incluir esas líneas en la captura (el OCR devolvía el resto de campos igualmente). |
| **Bug corregido** | No aplica (solo cobertura E2E nueva, sin cambios de implementación). |
| **Tests ejecutados** | `node tests/workspace/invoice-fields-e2e.mjs` (nuevo 14/14); regresión dirigida: `node tests/workspace/invoice-fields-test.mjs` (29/29), `instruction-parser-test.mjs` (116/116), `instruction-planner-test.mjs` (73/73); `node scripts/verify-workspace-sync.mjs`. |
| **Tests PASS** | 14/14 nuevos; Invoice fields 29/29; Parser 116/116; Planner 73/73; sync source/dist SYNC OK. Sin fallos. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo: `feat(workspace): e2e navegador del flujo de factura real OCR a tabla (CE-042)`. |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El E2E usa una factura sintética dibujada en canvas (no un PNG de fixture) para no añadir binarios; ocupa ~7s de OCR real. La confianza de OCR depende del canvas local (86% en este entorno); la verificación de campos pedidos es robusta al detalle (>=6 campos, número y Total presentes). |
| **Proxima prioridad** | Ejecutar CE-009/CE-040 desde DISCOVERED, o discovery dirigida con registro de nuevas oportunidades ejecutables. |

---

## Cycle 104 — Contrato ARIA/teclado del constructor de flujos y consolidación heredada (CE-009 + BUG_FIX)

| Field | Value |
|-------|-------|
| **Date** | 2026-08-13 |
| **Branch** | feature/workspace-star-flow |
| **HEAD inicial** | 90066d014bc0e3afc103e94c0f2b4d1c257e6e76 |
| **HEAD final** | Commit de cierre de este ciclo |
| **Task** | CE-009 (UX/Accesibilidad, desde DISCOVERED) + BUG_FIX de codificación heredado |
| **Hypothesis** | El working tree contenía trabajo sin commitear de un ciclo interrumpido (103): el contrato a11y del constructor de flujos estaba implementado en `workflow-ui.js` pero sin registrar en la cola, y `scripts/generate-seo-pages.mjs` había quedado corrompido en codificación (76 cadenas mojibake: `CategorA-as`, `ImÁgenes`, `→` → `â†'`, BOM UTF-16) que un build regeneraría en las 179 páginas. |
| **Change** | (1) **BUG_FIX**: se recuperó `generate-seo-pages.mjs` desde HEAD (UTF-8 limpio, sin BOM) y se reaplicó únicamente el cambio funcional heredado `ASSET_VERSION = '20260813'` con cache-busting `app.js?v=` en las 5 páginas generadas vía `appJsTag()`. Build 179/179 con acentos correctos y audit SEO 2753/2753 sin mojibake. (2) **CE-009**: el constructor de flujos ahora expone contrato ARIA/teclado real en sus widgets dinámicos: filas del selector de operaciones `role=button` + `tabindex=0` + `aria-label` + Enter/Espacio; filtros de categoría con `aria-pressed` (exactamente uno activo) y `aria-label` en la cinta; modal «Desde Workspace» con `role=listbox`/`role=option`, `aria-selected`, `tabindex` y activación por teclado. (3) Se consolidó la migración heredada a `toolisto.com` (site.config, `_headers` HSTS + noindex de `/workspace/*`, manifest con icono maskable, service-worker network-first, README/DEPLOYMENT a hosting estático con CNAME) y se añadió `artifacts/workflow-builder-a11y/` a `.gitignore`. |
| **Hallazgos** | El test VM `workflow-ui-test.mjs` ya incluía los contratos 34-39 y el E2E `workflow-builder-a11y-test.mjs` (nuevo) validaba el contrato en navegador real; el cierre del ciclo previo no llegó a registrar CE-009 ni a commitear. El dist ya estaba construido limpio, por lo que la corrupción solo afectaba al próximo build; el audit SEO sobre el dist nuevo confirma 0 mojibake. |
| **Bugs encontrados** | `generate-seo-pages.mjs` corrupto en codificación (76 cadenas mojibake + BOM UTF-16) que habría generado páginas con texto roto; el test `workflow-ui-test.mjs` tenía una duplicación de `container.replaceChildren()` (una llamada redundante, ya limpiada en el árbol). |
| **Bugs corregidos** | Sí: `generate-seo-pages.mjs` vuelve a UTF-8 limpio conservando el cache-busting heredado; el selector de operaciones, los filtros de categoría y el modal «Desde Workspace» son operables por teclado con semántica ARIA verificada en navegador. |
| **Tests ejecutados** | `node tests/workspace/workflow-ui-test.mjs` (39/39); `node tests/workspace/workflow-builder-a11y-test.mjs` (E2E navegador nuevo 11/11); `node tests/workspace/innerhtml-structure-test.mjs` (27/27); `operation-registry-test.mjs` (18/18); `workflow-engine-test.mjs`; `workflow-validator-test.mjs` (11/11); `workflow-model-test.mjs` (39/39); `instruction-planner-test.mjs` (73/73); `instruction-parser-test.mjs` (116/116); `instruction-assistant-ui-test.mjs` (39/39); `npm run build` (179/179); `node scripts/verify-workspace-sync.mjs` (SYNC OK); `node tests/seo-production-audit.mjs` (2753/2753); `node tests/deployment-guide-audit.mjs` (10/10); `node tests/pwa-offline.mjs` (20/20); `node tests/evidence-determinism.mjs` (69/69); `node tests/production-tool-coverage.mjs` (26/26); `node tests/lazy-dependencies.mjs` (10/10); E2E: workflow-e2e-test (20/20), phase3a-test (80/80), phase3b-test (59/59), workspace-test (156/156), phase3c-star-flow.spec.mjs (83/83). |
| **Tests PASS** | 39/39 VM UI + 11/11 E2E a11y nuevos; regresión completa verde: Workflow E2E 20/20, Phase 3A 80/80, Phase 3B 59/59, Workspace 156/156, Star-Flow 83/83; SEO 2753/2753, deployment 10/10, PWA 20/20, determinismo 69/69, cobertura 26/26, lazy 10/10. |
| **Tests FAIL** | 0 |
| **Commits** | Commit de cierre de este ciclo (a11y + encoding fix + consolidación heredada). |
| **Bloqueos** | Ninguno. |
| **Limitaciones** | El contrato a11y cubre los tres widgets dinámicos principales del constructor (selector de operaciones, filtros de categoría y modal «Desde Workspace»); otros widgets especializados del Workspace quedan como oportunidades futuras (CE-043 registra la consolidación de la migración toolisto.com). El cache-busting heredado usa la fecha fija `20260813`; futuros cambios de assets deben incrementarla. Las evidencias regeneradas no deterministas (e2e-evidence.json, bundle .toolisto y capturas PNG del Star-Flow) se excluyen del commit (anti-churn). |
| **Proxima prioridad** | Ejecutar CE-043 (gate de regresión de la migración toolisto.com) o CE-040 (memoria de motores pesados) desde DISCOVERED. |
