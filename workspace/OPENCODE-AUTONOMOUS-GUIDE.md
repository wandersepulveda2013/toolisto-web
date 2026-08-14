# OPENCODE-AUTONOMOUS-GUIDE.md — Guia del sistema autonomo de Toolisto

> Orquestador local de ciclos autonomos de OpenCode sobre el repositorio real de Toolisto.
> Mision: **Evolucion Continua** (etapa previa: Production Readiness).
> El sistema NO se detiene al terminar tareas: solo se detiene por orden humana, limite de ciclos
> explicito o fallo grave de la infraestructura del runner.

## Iniciar (modo continuo, recomendado)

```powershell
.\RUN-OPENCODE-AUTONOMOUS.ps1 -Unlimited
```

`-Unlimited` / `MaxCycles 0` = sin limite artificial de ciclos. Al aparecer
`workspace/PRODUCTION_READINESS_DONE`, el runner transiciona solo a CONTINUOUS_EVOLUTION y sigue.

## Iniciar con limites

```powershell
.\RUN-OPENCODE-AUTONOMOUS.ps1 -MaxCycles 20 -PauseSeconds 60
```

## Estado

```powershell
.\STATUS-OPENCODE-AUTONOMOUS.ps1
```

Muestra modo (PR/CE), estado, PID + uptime, ciclo actual, backoff (fallos consecutivos y proximo
reintento), ultimo ciclo, HEAD, working tree, productividad de los ultimos 20 ciclos, regla de
salud, y la cola activa (TODO/ACTIVE/BLOCKED/DONE/DISCOVERED/DEFERRED).

## Detener

```powershell
.\STOP-OPENCODE-AUTONOMOUS.ps1
```

Crea `AUTONOMOUS_STOP`; el runner termina el ciclo actual y se detiene. Solo el humano detiene el
sistema: el backlog vacio y el DONE de Production Readiness NO lo detienen.

## Reanudar

```powershell
.\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume -Unlimited
```

Elimina `AUTONOMOUS_STOP` y comienza de nuevo en modo continuo.

## Watchdog (ciclos colgados)

```powershell
.\WATCHDOG-OPENCODE-AUTONOMOUS.ps1 -KillStale -CleanStale
```

Reporta (sin matar procesos sanos) y, con las opciones explicitas, termina el proceso opencode de
un ciclo colgado (log sin crecer en 180 min) y limpia un lock stale. Escribe en
`artifacts/autonomous-logs/watchdog.log`. Puede programarse cada 15-30 min.

## Arranque automatico al iniciar sesion (opcional)

```powershell
.\INSTALL-OPENCODE-AUTO-START.ps1 -Install
```

Registra una tarea de Windows que lanza el runner `-Unlimited -Resume` al iniciar sesion. Si ya hay
un runner activo, la tarea no crea una segunda instancia (mutex). Para quitar:
`.\INSTALL-OPENCODE-AUTO-START.ps1 -Uninstall`. El estado de la tarea:
`.\INSTALL-OPENCODE-AUTO-START.ps1 -Status`.

LIMITACION real: si el PC se suspende, OpenCode deja de trabajar mientras dure la suspension.

## Validacion sin lanzar ciclos

```powershell
.\RUN-OPENCODE-AUTONOMOUS.ps1 -DryRun
```

Construye y muestra el modo/mision/queue del proximo ciclo sin adquirir el mutex ni lanzar
OpenCode. Puede usarse con un runner activo.

## Recuperacion automatica (auto-recovery)

- Fallo de proveedor/red (exit code != 0): backoff 1/5/15/30 min y reintento automatico.
- Tarea que falla repetidamente: OpenCode la marca BLOCKED (o BLOCKED_FLAKY) con causa y sigue con otra.
- Ciclo colgado: lo detecta el watchdog y, con `-KillStale`, termina solo ese proceso hijo.
- Fallo grave de la propia infraestructura del runner (opencode desaparece, repo corrupto): STOP
  por seguridad. Es la unica causa de detencion automatica.

## Archivos del sistema

| Archivo | Funcion |
|---------|---------|
| `RUN-OPENCODE-AUTONOMOUS.ps1` | Runner v2: lock, modos PR/CE, transicion DONE->CE, backoff, metricas, logs |
| `STOP-OPENCODE-AUTONOMOUS.ps1` | Crea `AUTONOMOUS_STOP` (parada suave, solo humano) |
| `STATUS-OPENCODE-AUTONOMOUS.ps1` | Estado: modo, PID+uptime, ciclo, backoff, productividad, cola |
| `WATCHDOG-OPENCODE-AUTONOMOUS.ps1` | Vigila runner/ciclo colgado y lock stale (sin matar procesos sanos) |
| `INSTALL-OPENCODE-AUTO-START.ps1` | Tarea programada opcional al iniciar sesion |
| `workspace/PRODUCTION-READINESS-MISSION/STATUS/QUEUE.md` | Etapa PR (se cierra con DONE) |
| `workspace/CONTINUOUS-EVOLUTION-MISSION/STATUS/QUEUE.md` | Mision permanente CE |
| `workspace/PRODUCTION_READINESS_DONE` | Senal de transicion PR->CE (no es senal de parada) |
| `workspace/AUTONOMOUS_MODE` | Modo actual persistente (PR/CE) |
| `artifacts/autonomous-logs/cycle-*.log` | Output completo de cada ciclo |
| `artifacts/autonomous-logs/metrics.tsv` | Resultado/HEAD/duracion por ciclo (productividad) |
| `artifacts/autonomous-logs/watchdog.log` | Hallazgos del watchdog |
| `.opencode/agents/toolisto-autonomous.md` | Agente con permisos (deny destructivo) |
| `.opencode/commands/toolisto-cycle.md` | Comando manual `/toolisto-cycle` |
| `opencode.json` | Config: default_agent, instructions, permisos globales |

## Como funciona el ciclo

1. El runner comprueba lock (mutex Windows + lock file), STOP y modo.
2. Construye el prompt del ciclo segun el modo (MISSION/STATUS/QUEUE de PR o CE).
3. Lanza `opencode run --agent toolisto-autonomous --title "Toolisto PR/CE Cycle N" <prompt>`.
4. Guarda el log completo y el exit code; ante fallo aplica backoff 1/5/15/30 min.
5. Registra metricas (resultado, bucket, HEAD, duracion) en `metrics.tsv`.
6. Comprueba STOP y la transicion PR->CE (DONE). Espera `PauseSeconds` y lanza el siguiente.
7. El sistema termina SOLO con `AUTONOMOUS_STOP`, limite de ciclos explicito o fallo grave.

## Notas

- Cada ciclo usa una sesion nueva de OpenCode; la memoria entre ciclos vive en
  MISSION/STATUS/QUEUE/git/evidencias.
- Los permisos del agente bloquean `git push/merge/rebase/reset/clean/branch -D/checkout --` y
  borrados recursivos/forzados. El runner nunca hace push.
- Regla de salud: si >50% de los ultimos 10 ciclos fueron AUDIT_ONLY, el siguiente ciclo debe ser
  una mejora de producto (salvo P0/P1).
- Politica de evidencia anti-churn: solo se commitea evidencia afectada y determinista; no se
  regenera evidencia sin cambio funcional.
- Anti-bucle de tareas ACTIVE: tarea >= 2 ciclos ACTIVE sin cambio de HEAD y con el mismo fallo
  reproducible obliga al ciclo siguiente a entrar en modo RECOVERY: cambiar de estrategia de
  diagnostico, demostrar la causa raiz con evidencia y cerrar o degradar la tarea. Un ciclo con
  HEAD sin cambio y el mismo fallo NO cuenta como progreso.
- Cambio de tecnica obligatorio: si una tecnica falla o rechaza permisos, el siguiente ciclo usa
  otra; no reintentar la misma ruta esperando otro resultado.
- Scripts diagnosticos temporales SOLO en `_toolisto_autopilot/tmp/` del repositorio; PROHIBIDO
  `%TEMP%`, `AppData\Local\Temp` y `external_directory` para debugging.
- PowerShell en Windows: solo comandos disponibles (Get-Content, Select-String, Select-Object,
  Get-ChildItem, Where-Object, Measure-Object); PROHIBIDO `rg`/`head`/`tail`/`grep`/`sed`/`awk`.
