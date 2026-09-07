# WORKSPACE-AUTONOMOUS-RUNNER.md — Runner autonoma de Evolucion Continua (estado y validacion)

> Documento canónico del orquestador local de ciclos de OpenCode sobre el repositorio real de
> Toolisto. Complementa `workspace/OPENCODE-AUTONOMOUS-GUIDE.md` (uso) con el estado verificado,
> los controles del runner, el esquema de estado persistido y la validacion controlada de 2 ciclos.

## Estado actual: VERIFICADO (2026-09-06)

2-CYCLE TEST: **PASS** — cadena completa probada end-to-end en produccion:

| ciclo | inicio | fin | duracion | exit | resultado | bucket | head_from | head_to | outcome |
|-------|--------|-----|----------|------|-----------|--------|-----------|---------|---------|
| 1 | 2026-09-06 20:14:40 | 20:18:13 | 213 s | 2 | SIN_MARCA | OTHER | 7e9a271 | b73c2a2 | LOOP_INTERRUPTED |
| 2 | 2026-09-06 20:19:19 | 20:23:00 | 221 s | 0 | ARCHITECTURE_IMPROVEMENT | PRODUCT_CHANGE | b73c2a2 | 0bdaf16 | SUCCESS |

- El ciclo 1 commiteo infraestructura real (b73c2a2: binario real de opencode, stdio del
  supervisor, agente big-pickle, estado por ciclo) y luego el guard de bucles lo interrumpio
  (NARRATION_LOOP CONSECUTIVE_INTENTS). El ciclo 2, con contexto de recovery antepuesto, cerro
  T1/T2 en QUEUE/STATUS (0bdaf16) y termino con `RESULTADO_CICLO: ARCHITECTURE_IMPROVEMENT`.
- **Relanzamiento automatico demostrado**: el ciclo 2 arranco solo 66 s despues del fin del ciclo 1
  (backoff 1 min del runtime + PauseSeconds 5) sin intervencion externa.
- Estado final persistido: `RUN-20260906201438-18664`, status `completed_ok`, last_exit_code 0,
  current_head 0bdaf16.

## Controles del runner

| Parametro | Default | Funcion |
|-----------|---------|---------|
| `-MaxCycles N` | **20** | Limite finito de ciclos por run (0/`-Unlimited` = sin limite; uso recomendado para produccion) |
| `-TestCycles` | off | Modo prueba controlada: scope <= 15 min, sin tocar producto, mejora minima del sistema autonomo o estado, cierra con `RESULTADO_CICLO` |
| `-PhaseTimeoutMinutes N` | **120** | Timeout de fase del supervisor (STALL solo para hijos muertos; politica runtime: 2 h) |
| `-PauseSeconds N` | 60 | Espera entre ciclos |
| `-Agent "..."` | (default_agent) | `opencode run` NO soporta `--agent` en CLI 1.18.18; se usa el default de `opencode.json` |
| `-Model "..."` | `opencode/big-pickle` | Modelo valido comprobado en produccion |
| `-OcCommand "..."` | auto | Ruta explicita al binario real de opencode (ver resolucion) |
| `-DryRun` | off | Valida modo/mision/QUEUE sin mutex ni lanzar ciclos |
| `-Resume` / `-Unlimited` | off / off | Borra `AUTONOMOUS_STOP` y sigue / sin limite de ciclos |

### Resolucion del binario opencode (Windows)

1. `-OcCommand` explicito (prevalece).
2. `Get-Command opencode`. Si resuelve a un shim `*.cmd/.bat/.ps1/.sh` de npm, se reemplaza
   SIEMPRE por el `.exe` real: `node_modules\opencode-ai\bin\opencode.exe` (o el paquete de
   plataforma `opencode-windows-x64`). Un shim `.cmd` NO es ejecutable por node con `shell:false`
   (ENOENT) ni por CreateProcess directo (EFTYPE). En esta maquina el binario real verificado:
   `C:\Users\wsepulveda\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe`
   (`opencode-ai@1.18.18`).

### Supervisor (AI_AUTONOMY/supervisor.mjs)

- Spawn con `stdio: ['ignore','pipe','pipe']` (stdin cerrado). **Requisito critico**: si el stdin
  queda como pipe abierto, `opencode run` se bloquea leyendolo en silencio (0 lineas, proceso vivo)
  y el supervisor lo mata como STALL al agotar el presupuesto de fase.
- Verdictos: 0 supervisor `SUCCESS`; no-cero y cerrado solo = `CRASH`; vivo sin progreso verificado
  (HEAD/owned) al llegar `phaseTimeoutMs` = `STALL`; spawn fallido = `CONFIG_ERROR`; guard de
  narracion = `LOOP_INTERRUPTED`.
- Tras un `LOOP_INTERRUPTED`, `STALL` o `CRASH`, el runner antepone al siguiente prompt el contexto
  de recovery compacto (ciclo, tarea, motivo, ultimo HEAD verificado, proxima accion del runtime).
- El runner corre el supervisor como proceso hijo y muestra un **heartbeat de consola** cada 60 s
  mientras el ciclo vive (duracion, tamano del log del ciclo y su delta, HEAD actual) para que una
  consola con inherit del ciclo no parezca congelada. El veredicto JSON del supervisor se captura
  de `_toolisto_autopilot\tmp\cycle-N.supervise.out.json`.
- `Start-Process` en PowerShell 5.1 no cita los elementos de `-ArgumentList`; los valores (comando,
  `--args`, rutas) se entrecomillan a mano para que node reciba argv sin romper (verificado: `--args`
  llega como un solo token `run --model ... --title ...`).

### Modelo del agente

`.opencode/agents/toolisto-autonomous.md` usa `model: opencode/big-pickle`. Verificado en
produccion: `opencode run --model opencode/big-pickle` responde y cierra en segundos. El modelo
anterior `opencode/deepseek-v4-flash-free` devuelve `Unexpected server error` del proveedor
`opencode/` y hace colgar el child (STALL), por lo que fue reemplazado.

## Estado persistido por run

`artifacts/autonomous-runs/workspace-runner-state.json` (sobrescrito por `Write-RunnerState`):

```json
{
  "run_id": "RUN-<yyyymmddHHmmss>-<pid>",
  "current_cycle": 2,
  "max_cycles": 2,
  "started_at": "2026-09-06 20:14:39",
  "last_cycle_started_at": "2026-09-06 20:19:19",
  "last_cycle_finished_at": "2026-09-06 20:23:01",
  "last_exit_code": 0,
  "status": "completed_ok",
  "initial_head": "7e9a271",
  "current_head": "0bdaf16"
}
```

- `status`: `running`, `stopped`, `safe_mode`, `blocked_owner`, `critical_error`, `completed_ok`,
  `completed_failed`.
- Ademas se persiste una copia por ciclo: `artifacts/autonomous-runs/workspace-cycle-NNN.log` al
  cerrar cada ciclo (independiente de `artifacts/autonomous-logs/cycle-*.log`).
- Los conteos de commits/cambios por ciclo en `Write-CycleHistory` son reales
  (`git rev-list --count $headFrom..$headTo` y `git diff --name-only`).

## Bugs encontrados y corregidos (2026-09-06)

1. `spawn ENOENT`: el runner pasaba `opencode` (shim) que node no puede ejecutar con `shell:false`
   → se resuelve al `.exe` real (ver Resolucion).
2. `spawn EFTYPE`: la logica anterior conservaba el `.cmd` al existir → CreateProcess
   ERROR_BAD_EXE_FORMAT → resolucion corregida (siempre `.exe` real del npm global).
3. STALL silencioso de 45 min: stdin abierto del child → `stdio: ['ignore','pipe','pipe']`.
4. `--title "Toolisto ... Cycle N"` con espacios corrompia el prompt (split whitespace en cli.mjs)
   → titulo sin espacios `Toolisto-CE-Cycle-N`.
5. `Get-CycleResult` leia UTF-16 (`-Encoding Unicode`) un log UTF-8 → siempre `SIN_MARCA`
   → `-Encoding UTF8`.
6. `MaxCycles` default ilimitado → default finito 20 (con `-Unlimited`/0 para sin limite).
7. `Write-CycleHistory` registraba `--commits 0 --files-changed 0` ficticios → reales.

## Limitaciones documentadas

- `opencode run` en esta CLI no soporta `--agent`; el agente se controla vía `default_agent` de
  `opencode.json` y el `model:` del frontmatter.
- El flujo necesita `E2E_PORT`/puertos de loopback solo en suites Node (8081); el runner no toca
  la config de producto.
- Si el PC se suspende, los ciclos se pausan (limitacion conocida de la evolucion continua local).
- El runner hace commits locales; nunca push (remoto presente pero prohibido).

## Verificacion rapida

```powershell
.\RUN-OPENCODE-AUTONOMOUS.ps1 -DryRun
.\STATUS-OPENCODE-AUTONOMOUS.ps1
Get-Content .\artifacts\autonomous-runs\workspace-runner-state.json
```