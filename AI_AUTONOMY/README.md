# AI_AUTONOMY — Runtime de supervision del sistema autonomo de OpenCode

Subsistema que hace **observable y recuperable** la ejecucion de cada ciclo
autonomo. Es la respuesta estructural (no de prompt) al sintoma "el agente dijo
`Let me read the QUEUE` indefinidamente": la narracion no es progreso; la
ejecucion lo es, y aqui se mide y se persiste.

> Modulos ESM `.mjs`, sin dependencias, deterministicos y unit-testables.

## Por que existe

El launcher/lock del runner historico observaba SOLO eventos a nivel de proceso:
codigo de salida y `LastWriteTime` del log. Como la narracion tambien escribe en
el log, `LastWriteTime` avanzaba aunque el modelo se repitiera "voy a leer el
QUEUE" sin ejecutar NADA. Ese bucle era invisible para el launcher y para el
watchdog. Este runtime cierra ese hueco con una senal maquina-comprobable.

## Modulos

- `guard.mjs` — motor puro de deteccion de bucle de narracion (intents vs eventos
  verificados; repeticion verbatim; ratio; consecutivos sin progreso) y scoring
  de tareas (P0>P1>P2>P3 con ajuste por encaje de producto).
- `state.mjs` — modelo de checkpoint persistente (`state.json`) + log de eventos
  estructurados (`events.jsonl`), con maquina de estados de tarea
  (PENDING->RUNNING->IMPLEMENTED->TRACKERS->FINISHED / FAILED) y escritura
  atomica (tmp+rename) para sobrevivir a un crash.
- `runner.mjs` — capa de supervision: `resolvePaths`, `planCycle` (escala de
  recuperacion FRESH / RESUME / COMPLETE_TRACKERS / RECOVERY / FRESH-bump),
  orchestrator (loop guard + verified), supervisor (verify/finish/fail/safeCommit).
- `lock.mjs` — lock de instancia unica por PID con deteccion de stale; un segundo
  runner se niega a arrancar mientras un PID vivo tenga el lock.
- `commit-guard.mjs` — guard de propiedad: el ciclo declara archivos propios;
  rechaza archivos fuera de scope y raices duras de bloqueo (`git add .` / `-A`
  prohibidos explicitamente).
- `queue.mjs` — espejo estructurado de la cola Markdown (`queue.json`) + scoring
  y reconciliacion (la MD es la autoridad; entradas solo-JSON se marcan
  `DONE_MISSING`).

## Progreso verificado (la regla de oro)

Un evento `verified` SOLO se escribe cuando una herramienta/side-effect real
corre (p. ej. `edit:workspace.js`, `node:test`, `git:commit`). El guard cuenta
`intents` (lo que el modelo DICE) frente a `verified` (lo que REALMENTE hizo):

- `>= repetidas de la misma narracion` => `REPETITION`
- `>= intents consecutivos sin un verified intercalado` => `CONSECUTIVE_INTENTS`
- `>= intents con 0 verified` => `RATIO_ZERO_VERIFIED`

Cuando se dispara, `evaluateCycleOutput` devuelve `{interrupt:true, reason}` y el
runner interrumpe el ciclo en vez de dejar que gire.

## Recuperacion ante crash (escala del checkpoint)

`planCycle(checkpoint)` decide al (re)iniciar:

| checkpoint             | accion            |
|------------------------|-------------------|
| `null`/vacio           | `FRESH` (ciclo 1) |
| `RUNNING` mid-cycle    | `RESUME` (misma tarea) |
| `IMPLEMENTED`/`TRACKERS` | `COMPLETE_TRACKERS` (no re-implementar) |
| `FAILED`               | `RECOVERY` (ciclo+1, otra tecnica) |
| `finished`             | `FRESH` (ciclo+1) |

## Integracion con el watchdog

`WATCHDOG-OPENCODE-AUTONOMOUS.ps1` ahora lee `AI_AUTONOMY/events.jsonl`: si el log
de texto crece pero no llega ningun evento `verified`, senala
`SOSPECHA DE BUCLE DE NARRACION` (parametro `-LoopSuspectMinutes`, default 60).
Sigue siendo aditivo y no mata procesos sanos.

## Pruebas

- `tests/ai-autonomy-orchestrator-test.mjs` -> 85 checks (guard, state machine,
  recovery ladder, ownership, queue, lock, supervisor e2e, determinismo).
- `tests/ai-autonomy-resilience-simulation.mjs` -> 17 checks / 6 escenarios
  (A: verified vs narracion; B: crash+restart; C: bucle; D: archivo extrano;
  E: determinismo; F: lock instancia unica).

Ambas estan registradas en `tests/run-all.mjs`.

## Como integrar el runner en el launcher PS1 (proximo paso)

El runner aun no reemplaza el bucle de `RUN-OPENCODE-AUTONOMOUS.ps1`. Para
usarlo como supervisor por ciclo, el launcher deberia:

1. `node AI_AUTONOMY/...` para `planCycle` y decidir FRESH/RESUME/RECOVERY.
2. Lanzar `opencode run` como hijo y conectar su stdout a `guard.createLoopDetector`.
3. Llamar `verify(step...)` solo cuando una herramienta real corra.
4. `safeCommit` con los archivos declarados como propios del ciclo.
5. `finish(result)` al terminar; `fail(reason)` si el guard interrumpio.

El codigo de supervision y de pruebas ya esta listo y validado.
