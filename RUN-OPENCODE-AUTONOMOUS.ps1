#Requires -Version 5.1
<#
.SYNOPSIS
  Runner autonomo de OpenCode para Toolisto — Evolucion Continua.

.DESCRIPTION
  Lanza ciclos consecutivos de `opencode run` sobre el repositorio real, con:
  - lock de mutex Windows (una unica instancia activa)
  - modo dual: PRODUCTION_READINESS -> (al aparecer workspace/PRODUCTION_READINESS_DONE)
    -> CONTINUOUS_EVOLUTION. El DONE NO detiene el runner: transiciona y continua.
  - parada SOLO por: flag AUTONOMOUS_STOP (humano), limite de ciclos explicito con
    MaxCycles > 0 sin -Unlimited, o fallo grave de la propia infraestructura del runner.
    Un backlog vacio o un DONE NUNCA detienen el sistema.
  - auto-recovery: ante fallo de proveedor/red aplica backoff 1/5/15/30 min y reintenta.
  - watchdog integrado ligero: limpia hijos huerfanos entre ciclos y escribe runner.cycle
    para que WATCHDOG-OPENCODE-AUTONOMOUS.ps1 detecte ciclos colgados sin matar procesos sanos.
  - metricas por ciclo (resultado, bucket, HEAD, duracion) en artifacts/autonomous-logs/metrics.tsv
  - -Unlimited / MaxCycles 0 = sin limite artificial de ciclos
  - -DryRun valida prompt/modo sin lanzar opencode y sin adquirir el mutex
  - -Resume elimina AUTONOMOUS_STOP y reanuda

.EXAMPLE
  .\RUN-OPENCODE-AUTONOMOUS.ps1 -Unlimited

.EXAMPLE
  .\RUN-OPENCODE-AUTONOMOUS.ps1 -MaxCycles 20 -PauseSeconds 60

.EXAMPLE
  .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume -Unlimited

.EXAMPLE
  .\RUN-OPENCODE-AUTONOMOUS.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [int]$MaxCycles = 20,
  [switch]$Unlimited,
  [int]$PauseSeconds = 60,
  [int[]]$BackoffMinutes = (1, 5, 15, 30),
  [switch]$Resume,
  [switch]$DryRun,
  [switch]$TestCycles,
  [int]$PhaseTimeoutMinutes = 120,
  [string]$Agent = "",
  [string]$Model = "opencode/big-pickle",
  [string]$OcCommand = "",
  [string]$LogDir = "",
  [int]$StaleMinutes = 180
)

# Continue: los comandos nativos pueden escribir en stderr sin abortar el runner.
$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8

# Raiz resuelta por ubicacion del propio script (portable).
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $LogDir) { $LogDir = Join-Path $ProjectRoot "artifacts\autonomous-logs" }
$null = New-Item -ItemType Directory -Force -Path $LogDir

$StopFlag    = Join-Path $ProjectRoot "AUTONOMOUS_STOP"
$PrDoneFile  = Join-Path $ProjectRoot "workspace\PRODUCTION_READINESS_DONE"
$ModeFile    = Join-Path $ProjectRoot "workspace\AUTONOMOUS_MODE"
$CycleFile   = Join-Path $LogDir "runner.cycle"
$BackoffFile = Join-Path $LogDir "runner.backoff"
$LockFile    = Join-Path $LogDir "runner.lock"
$MetricsFile = Join-Path $LogDir "metrics.tsv"
$WatchLog    = Join-Path $LogDir "watchdog.log"

# Artefactos del runner por ciclo y estado (los lee STATUS y la entrega final):
# artifacts/autonomous-runs/workspace-cycle-NNN.log + workspace-runner-state.json
$RunDir      = Join-Path $ProjectRoot "artifacts\autonomous-runs"
$RunState    = Join-Path $RunDir "workspace-runner-state.json"
$RunId       = "RUN-$((Get-Date -Format 'yyyyMMddHHmmss'))-$PID"

# Estado del runner (spec de la validez del orquestador): unica fuente de verdad
# legible para STATUS/verificacion. Se reescribe entero en cada punto del ciclo.
function Write-RunnerState {
  param(
    [string]$Status = "running",
    [int]$Cycle = 0,
    [string]$StartedAt = "",
    [string]$FinishedAt = "",
    [int]$Exit = -1,
    [string]$HeadTo = ""
  )
  try {
    $null = New-Item -ItemType Directory -Force -Path $RunDir
    if (-not $RunnerStartedTs) { $script:RunnerStartedTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss" }
    $state = [ordered]@{
      run_id                 = $RunId
      current_cycle          = $Cycle
      max_cycles             = $MaxCycles
      started_at             = $RunnerStartedTs
      last_cycle_started_at  = $StartedAt
      last_cycle_finished_at = $FinishedAt
      last_exit_code         = $Exit
      status                 = $Status
      initial_head           = $InitialHead
      current_head           = $HeadTo
    }
    Set-Content -LiteralPath $RunState -Value ($state | ConvertTo-Json) -Encoding UTF8 -ErrorAction SilentlyContinue
  } catch { }
}

function Write-Log {
  param([string]$Msg)
  $ts = Get-Date -Format "HH:mm:ss"
  Write-Host ("[{0}] {1}" -f $ts, $Msg)
}

function Write-WatchLog {
  param([string]$Msg)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $WatchLog -Value ("[{0}] {1}" -f $ts, $Msg) -Encoding UTF8 -ErrorAction SilentlyContinue
}

# Modo actual: CONTINUOUS_EVOLUTION si ya existe DONE, si no, PRODUCTION_READINESS.
function Resolve-Mode {
  if (Test-Path -LiteralPath $PrDoneFile) { return "CONTINUOUS_EVOLUTION" }
  if (Test-Path -LiteralPath $ModeFile) {
    $m = ((Get-Content -LiteralPath $ModeFile -Raw -ErrorAction SilentlyContinue) -replace '\s','')
    if ($m -eq "CONTINUOUS_EVOLUTION") { return "CONTINUOUS_EVOLUTION" }
  }
  return "PRODUCTION_READINESS"
}

function Get-ModeFiles {
  param([string]$Mode)
  if ($Mode -eq "CONTINUOUS_EVOLUTION") {
    return @{
      Mission = Join-Path $ProjectRoot "workspace\CONTINUOUS-EVOLUTION-MISSION.md"
      Status  = Join-Path $ProjectRoot "workspace\CONTINUOUS-EVOLUTION-STATUS.md"
      Queue   = Join-Path $ProjectRoot "workspace\CONTINUOUS-EVOLUTION-QUEUE.md"
    }
  }
  return @{
    Mission = Join-Path $ProjectRoot "workspace\PRODUCTION-READINESS-MISSION.md"
    Status  = Join-Path $ProjectRoot "workspace\PRODUCTION-READINESS-STATUS.md"
    Queue   = Join-Path $ProjectRoot "workspace\PRODUCTION-READINESS-QUEUE.md"
  }
}

# Mapea el resultado fino del ciclo al bucket grueso para la metrica de salud.
function Get-CoarseBucket {
  param([string]$Result)
  switch ($Result) {
    { $_ -in @('FEATURE', 'BUG_FIX', 'PERFORMANCE_IMPROVEMENT', 'UX_IMPROVEMENT', 'ARCHITECTURE_IMPROVEMENT', 'SECURITY_FIX', 'PRODUCT_CHANGE') } { return 'PRODUCT_CHANGE' }
    { $_ -in @('MEANINGFUL_TEST_COVERAGE', 'TEST_CHANGE') } { return 'TEST_ONLY' }
    'DOCUMENTED_BLOCKER' { return 'BLOCKER' }
    'AUDIT_ONLY' { return 'AUDIT_ONLY' }
    default { return 'OTHER' }
  }
}

# Lee el marcador RESULTADO_CICLO del log (escrito como UTF-8).
function Get-CycleResult {
  param([string]$LogPath)
  try {
    $content = Get-Content -LiteralPath $LogPath -Encoding UTF8 -Raw -ErrorAction Stop
  } catch {
    return "SIN_MARCA"
  }
  if ($content -match 'RESULTADO_CICLO\s*[:=]\s*([A-Z_]+)') { return $Matches[1].ToUpper() }
  return "SIN_MARCA"
}

# CE-068: invoca el runtime (AI_AUTONOMY/cli.mjs) y devuelve el JSON parseado.
# El runtime es la UNICA fuente de verdad del state machine / recuperacion; este
# runner CONSUME sus decisiones y persiste el estado a traves de reinicios.
# Devuelve $null si el CLI no produce JSON valido.
function Invoke-Runtime {
  param([string[]]$Args2)
  $json = ""
  try {
    $json = & node (Join-Path $ProjectRoot "AI_AUTONOMY\cli.mjs") @Args2 2>$null
  } catch {
    Write-WatchLog "Runtime CLI no disponible: $($_.Exception.Message)"
    return $null
  }
  try { return ($json | ConvertFrom-Json) } catch { return $null }
}

# Consulta al runtime si es seguro arrancar/proseguir el ciclo actual.
function Get-RuntimeBoot {
  return Invoke-Runtime @('boot')
}

# CE-070: registra el ciclo terminado en la historia estructurada del runtime
# (AI_AUTONOMY/history.jsonl) para el sistema evidence-driven: outcome ya
# clasificado por el runtime, senales de valor/loop/stall/recovery y tamano de
# prompt (fresh vs recovery) para deteccion de context bloat.
function Write-CycleHistory {
  param(
    [int]$Cycle,
    [string]$ModeShort,
    [string]$TaskId,
    [string]$Outcome,
    [string]$Result,
    [string]$NextAction,
    [int]$Exit,
    [int]$DurationS,
    [string]$HeadFrom,
    [string]$HeadTo,
    [int]$PromptChars,
    [int]$RecoveryChars,
    [int]$Commits = 0,
    [int]$Files = 0,
    [switch]$SafeMode,
    [switch]$EnvFailure
  )
  $hArgs = @('history', '--record', '--cycle', ([string]$Cycle), '--ce', $ModeShort, '--task', $TaskId,
             '--task-type', $Result, '--outcome', $Outcome, '--verdicts', $Outcome,
             '--duration-s', ([string]$DurationS), '--commits', ([string]$Commits), '--files-changed', ([string]$Files),
             '--retries', '0', '--crashes', '0', '--loops', '0', '--stalls', '0', '--recoveries', '0',
             '--prompt-size', ([string]$PromptChars), '--recovery-size', ([string]$RecoveryChars),
             '--from-state', 'TODO', '--to-state', ($(if ($Exit -eq 0) { 'DONE' } else { 'FAILED' })))
  if ($SafeMode) { $hArgs += @('--safe-mode', 'true') }
  if ($EnvFailure) { $hArgs += @('--env-failure', 'true') }
  if ($NextAction) { $hArgs += @('--strategies', $NextAction) }
  $null = Invoke-Runtime $hArgs
}

# CE-069: construye el contexto de RECOVERY compacto tras un fallo supervisado
# (mision §11 / §12): solo lo necesario (Cycle, CE, state, task, last verified,
# reason, recovery count, siguiente accion, prohibicion de repetir trabajo).
# El launcher lo antepone al prompt del proximo intento para que OpenCode sepa
# exactamente que hacer sin cargar el historial completo.
function Format-RecoveryPrompt {
  param(
    [int]$Cycle,
    [string]$ModeShort,
    [string]$Outcome,
    [string]$Reason,
    [string]$NextAction,
    [string]$LastHead = ""
  )
  $headLine = if ($LastHead) { "LAST VERIFIED: HEAD $LastHead" } else { "LAST VERIFIED: (ninguno en este ciclo)" }
  return @"
RECOVERY CONTEXTO COMPACTO (ciclo anterior fallo bajo supervision)
CYCLE: $Cycle
CE: CE-069
STATE: TRACKERS/RUNNING
FAILURE: $Outcome
REASON: $Reason
$headLine
RUNTIME NEXT ACTION: $NextAction
NEXT ACTION: retoma SOLO el paso pendiente (actualiza QUEUE y STATUS del ciclo, y el commit).
DO NOT repeat work ya completado ni vuelvas a caer en el bucle de narracion que causo la interrupcion.
Ejecuta de forma directa y verificable: un commit real o un cambio de archivo propio antes de terminar.
"@
}

# Inicializacion
if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
  Write-Error "opencode no esta en el PATH. Instala OpenCode y reintenta."
  exit 1
}
# Resolucion del binario REAL de opencode. El CLI se lanza supervisado con
# shell:false (node) y NUNCA ejecuta un .cmd/.bat del shim de npm (ENOENT).
# Preferimos el exe real de la instalacion y permitimos override (-OcCommand).
if (-not $OcCommand) {
  $ocG = Get-Command opencode -ErrorAction SilentlyContinue
  if ($ocG) { $OcCommand = $ocG.Source }
  # Un shim .cmd/.bat/.ps1/.sh de npm NUNCA es ejecutable por node (shell:false).
  # Si resuelve a un script, buscamos SIEMPRE el exe real de la instalacion.
  if ($OcCommand -match '\.(cmd|bat|ps1|sh)$') {
    $cand = ($OcCommand -replace '\.(cmd|bat|ps1|sh)$', '.exe')
    if (-not (Test-Path -LiteralPath $cand)) {
      $npmRoot = (& npm root -g 2>$null | Select-Object -First 1)
      if ($npmRoot) {
        $cand = Join-Path $npmRoot "opencode-ai\bin\opencode.exe"
        if (-not (Test-Path -LiteralPath $cand)) { $cand = Join-Path $npmRoot "opencode-windows-x64\bin\opencode.exe" }
      }
    }
    if (Test-Path -LiteralPath $cand) { $OcCommand = $cand }
  }
  if (-not $OcCommand) { $OcCommand = "opencode" }
}
Write-Log "Ruta del binario opencode: $OcCommand"
$head = git rev-parse --short HEAD 2>$null
if (-not $head) {
  Write-Error "$ProjectRoot no parece ser un repositorio git."
  exit 1
}

if ($Resume) {
  if (Test-Path -LiteralPath $StopFlag) {
    Remove-Item -LiteralPath $StopFlag -Force
    Write-Log "AUTONOMOUS_STOP eliminado. Reanudando."
  } else {
    Write-Log "No existia flag AUTONOMOUS_STOP. Reanudando directamente."
  }
}

$isUnlimited = ($Unlimited -or $MaxCycles -le 0)

# -DryRun no adquiere el mutex (no lanza opencode, no compite con un runner activo).
if ($DryRun) {
  $Mode = Resolve-Mode
  $mf = Get-ModeFiles -Mode $Mode
  Write-Log "[DRY RUN] Modo resuelto: $Mode"
  Write-Log "[DRY RUN] MaxCycles=$MaxCycles Unlimited=$Unlimited (efectivo ilimitado: $isUnlimited)"
  Write-Log "[DRY RUN] Mission=$($mf.Mission)"
  Write-Log "[DRY RUN] Status=$($mf.Status)"
  Write-Log "[DRY RUN] Queue=$($mf.Queue)"
  Write-Log "[DRY RUN] Mision/status/queue de CE presentes:"
  Write-Log "   CE Mission: $(Test-Path -LiteralPath (Join-Path $ProjectRoot 'workspace\CONTINUOUS-EVOLUTION-MISSION.md'))"
  Write-Log "   CE Status : $(Test-Path -LiteralPath (Join-Path $ProjectRoot 'workspace\CONTINUOUS-EVOLUTION-STATUS.md'))"
  Write-Log "   CE Queue  : $(Test-Path -LiteralPath (Join-Path $ProjectRoot 'workspace\CONTINUOUS-EVOLUTION-QUEUE.md'))"
  Write-Log "[DRY RUN] DONE presente: $(Test-Path -LiteralPath $PrDoneFile) | STOP presente: $(Test-Path -LiteralPath $StopFlag)"
  Write-Log "[DRY RUN] Validacion completa. No se lanzo opencode."
  exit 0
}

# Lock: mutex Windows (primario) + lock file con PID y timestamp (para STATUS/uptime).
$hashBytes = [System.Security.Cryptography.MD5]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($ProjectRoot))
$hashHex = [System.BitConverter]::ToString($hashBytes).Replace('-', '')
$MutexName = 'Local\ToolistoAutonomous_' + $hashHex
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($false, $MutexName, [ref]$createdNew)
if (-not $createdNew) {
  Write-Host "Ya existe una instancia autonoma activa de Toolisto."
  Write-Host "Usa .\STATUS-OPENCODE-AUTONOMOUS.ps1 para ver el PID o .\STOP-OPENCODE-AUTONOMOUS.ps1 para detenerla."
  exit 1
}

# Marca de referencia del run (estado del runner).
$InitialHead = $head
$RunnerStartedTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$FinalStatus = "running"

try {
  Set-Content -LiteralPath $LockFile -Value ("PID=$PID Timestamp=$((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) Root=$ProjectRoot") -Encoding UTF8
} catch { }

try {
  $Mode = Resolve-Mode
  try { Set-Content -LiteralPath $ModeFile -Value $Mode -Encoding UTF8 } catch { }
  $mf = Get-ModeFiles -Mode $Mode

  if ((Test-Path -LiteralPath $PrDoneFile) -and $Mode -eq "CONTINUOUS_EVOLUTION") {
    Write-Log "workspace/PRODUCTION_READINESS_DONE existe. Modo: CONTINUOUS EVOLUTION. El sistema continua."
  }
  if (Test-Path -LiteralPath $StopFlag) {
    Write-Log "AUTONOMOUS_STOP presente. Usa .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume para reanudar."
    return
  }

  Write-Log "Runner iniciado. Modo=$Mode Unlimited=$isUnlimited MaxCycles=$MaxCycles PauseSeconds=$PauseSeconds Root=$ProjectRoot"
  Write-Log "HEAD inicial: $head"

  # Limpieza de huerfanos: un ciclo anterior pudo dejar opencode colgado sin limpiar.
  if (Test-Path -LiteralPath $CycleFile) {
    $oldCycle = Get-Content -LiteralPath $CycleFile -Raw -ErrorAction SilentlyContinue
    if ($oldCycle -match 'Title=(.+?) Started=') {
      $orphanTitle = $Matches[1]
      $orphan = Get-CimInstance Win32_Process -Filter "Name='opencode.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$orphanTitle*" } | Select-Object -First 1
      if ($orphan) {
        Write-WatchLog "Huerfano detectado al arrancar ($orphanTitle, PID $($orphan.ProcessId)). Terminando."
        Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
    Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue
  }

  # Continuidad: continua la numeracion de ciclos desde el maximo log existente
  # (evita reiniciar en 001 y confundir STATUS/metricas con los ciclos historicos).
  $startCycle = 0
  Get-ChildItem -Path $LogDir -Filter "cycle-*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -match 'cycle-(\d+)-') {
      $n = [int]$Matches[1]
      if ($n -gt $startCycle) { $startCycle = $n }
    }
  }
  Write-Log "Numeracion de ciclos: continuando desde el ciclo $startCycle."

  $cycle = $startCycle
  $consecutiveFailures = 0
  $lastExit = 0
  # CE-069: estado de recuperacion por ciclo. $recoveryPrompt contiene el contexto
  # compacto del ciclo anterior fallido y se antepone SOLO al proximo prompt; se
  # limpia tras su consumo (no contamina ciclos posteriores). $taskId es la
  # identidad estable del ciclo actual para supervisor/recuperacion.
  $recoveryPrompt = ""
  $recoveryPromptChars = 0
  $taskId = $null

  while ($isUnlimited -or $cycle -lt $MaxCycles) {
    $cycle++

    if (Test-Path -LiteralPath $StopFlag) {
      Write-Log "AUTONOMOUS_STOP detectado antes del ciclo $cycle. Deteniendo (solo el humano detiene el sistema)."
      $FinalStatus = "stopped"
      break
    }
    if ($Mode -eq "PRODUCTION_READINESS" -and (Test-Path -LiteralPath $PrDoneFile)) {
      Write-Log "TRANSICION detectada antes del ciclo ${cycle}: Production Readiness completa -> CONTINUOUS EVOLUTION."
      $Mode = "CONTINUOUS_EVOLUTION"
      $mf = Get-ModeFiles -Mode $Mode
      try { Set-Content -LiteralPath $ModeFile -Value $Mode -Encoding UTF8 } catch { }
    }

    # Parada critica por seguridad: si el directorio dejo de ser un repositorio
    # git valido no se lanza ningun ciclo mas (condicion de parada del orquestador).
    $treeOk = git rev-parse --is-inside-work-tree 2>$null
    if ($treeOk -ne "true") {
      Write-Log "CRITICO: el directorio dejo de ser un repositorio git valido. Deteniendo el runner por seguridad."
      Write-WatchLog "CRITICO: git no valido al inicio del ciclo $cycle; stop por seguridad."
      $FinalStatus = "critical_error"
      break
    }

    $modeShort = if ($Mode -eq "CONTINUOUS_EVOLUTION") { "CE" } else { "PR" }
    $titleArg = "Toolisto-$modeShort-Cycle-$cycle"
    $missionF = $mf.Mission
    $statusF  = $mf.Status
    $queueF   = $mf.Queue

    # Estado del runner: ciclo en curso.
    $headFrom = git rev-parse --short HEAD 2>$null
    $startedTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-RunnerState -Status "running" -Cycle $cycle -StartedAt $startedTs -Exit $lastExit -HeadTo $headFrom

    # CE-068: el runtime gobierna este ciclo. Consulta persistente de estado antes
    # de lanzar opencode. SAFE_MODE / BLOCKED_OWNER detienen el runner (no se lanza).
    $boot = Get-RuntimeBoot
    if ($boot -and $boot.action -eq "SAFE_MODE") {
      Write-Log "RUNTIME SAFE_MODE en ciclo $cycle ($($boot.reason)). El estado persistente manda SAFE_MODE; deteniendo el runner (requiere intervencion humana)."
      Write-WatchLog "SAFE_MODE en ciclo ${cycle}: $($boot.reason)"
      $FinalStatus = "safe_mode"
      break
    }
    if ($boot -and $boot.action -eq "BLOCKED_OWNER") {
      Write-Log "RUNTIME BLOCKED_OWNER en ciclo ${cycle}: otra instancia activa tiene el estado persistente. Deteniendo (single-instance)."
      Write-WatchLog "BLOCKED_OWNER en ciclo $cycle"
      $FinalStatus = "blocked_owner"
      break
    }
    # CE-069: identidad estable del ciclo desde el runtime (boot -> start-cycle).
    # taskId del boot es el planificado/fuente de verdad; start-cycle puede
    # confirmarlo. Conservamos el de mayor autoridad y lo pasamos al supervisor.
    if ($boot -and $boot.taskId) { $taskId = $boot.taskId }
    # Seed RUNNING en el runtime (FRESH/RESUME/COMPLETE_TRACKERS continuan igual).
    $scResp = Invoke-Runtime @('start-cycle', '--cycle', ($cycle.ToString()))
    if ($scResp -and $scResp.taskId) { $taskId = $scResp.taskId }
    # Heartbeat: snapshot persistente de liveness para el watchdog externo (fallback).
    $null = Invoke-Runtime @('heartbeat')

    if ($Mode -eq "CONTINUOUS_EVOLUTION") {
      $prompt = @"
TOOLISTO AUTONOMOUS CONTINUOUS EVOLUTION - CYCLE $cycle

Raiz del repositorio REAL: $ProjectRoot
Trabaja directamente sobre este repositorio. No clones, no uses otro workspace.

Lee obligatoriamente, en orden:
1. AGENTS.md
2. workspace/CONTINUOUS-EVOLUTION-MISSION.md
3. workspace/CONTINUOUS-EVOLUTION-STATUS.md
4. workspace/CONTINUOUS-EVOLUTION-QUEUE.md
5. Si existe workspace/WORKSPACE-AUTONOMOUS-NIGHT-REPORT.md, leelo al final: resume la productividad reciente del sistema autonomo (ultimo reporte nocturno).

Despues revisa: git status, git rev-parse HEAD, git log --oneline -5, y los tests relacionados con la tarea seleccionada.

Selecciona la tarea ejecutable de mayor prioridad de CONTINUOUS-EVOLUTION-QUEUE.md (P0 > P1 > P2 > P3)
y cambiala a ACTIVE. Si no hay tareas TODO: dedica el ciclo a DISCOVERY y genera oportunidades
nuevas (P1/P2/P3) como DISCOVERED en la cola. Nunca digas "no hay nada que hacer".

Orientacion del esfuerzo: ~45% mejora funcional de producto, ~25% bugs/fiabilidad/seguridad,
~15% rendimiento, ~10% UX/movil/accesibilidad, ~5% auditoria/documentacion/evidencia.

Ciclo obligatorio: AUDITAR -> REPRODUCIR -> IMPLEMENTAR -> PROBAR -> CORREGIR -> REGRESION -> DOCUMENTAR -> COMMIT.
- Produce una MEJORA REAL: FEATURE, BUG_FIX, PERFORMANCE_IMPROVEMENT, UX_IMPROVEMENT,
  ARCHITECTURE_IMPROVEMENT, SECURITY_FIX, MEANINGFUL_TEST_COVERAGE o DOCUMENTED_BLOCKER.
- Las nuevas herramientas estan permitidas solo si cumplen las 4 preguntas y 5 criterios del MISSION.
- Anti-ciclo-vacio: un ciclo que solo regenera evidencia o audita sin cambio es INVALIDO.
- Politica de evidencia (anti-churn): toca solo la evidencia afectada; salidas deterministas
  (sin timestamps absolutos, sin orden aleatorio); si regenerar produce contenido identico, NO lo
  commitees; nunca commitees un diff de +50k/-50k de JSON de evidencia sin cambio funcional.
- Tests con flake: reproduce enfocada, diagnostica. Maximo ~3 intentos enfocados; si sigue sin
  causa, marca la tarea BLOCKED_FLAKY con diagnostico y elige otra. No repitas la misma suite horas.
- Anti-bucle de tareas ACTIVE: si una tarea lleva >= 2 ciclos ACTIVE sin cambio de HEAD y conserva
  el mismo fallo reproducible, este ciclo DEBE entrar en modo RECOVERY de esa tarea: cambia de
  estrategia de diagnostico (no repitas el mismo analisis ni la misma tecnica que ya fallo),
  demuestra la causa raiz con evidencia en navegador real cuando corresponda y cierrala o degradala
  con un plan concreto. NO lo consideres progreso si HEAD no cambio y el fallo es identico.
- Cambio de tecnica obligatorio: si una tecnica falla o rechaza permisos en un ciclo, el siguiente
  ciclo usa otra estrategia; no reintentes la misma ruta exacta esperando otro resultado.
- Scripts diagnosticos temporales: crealos EXCLUSIVAMENTE en _toolisto_autopilot/tmp/ dentro del
  repositorio. PROHIBIDO usar %TEMP%, AppData\\Local\\Temp, directorios externos o pedir
  external_directory para debugging.
- PowerShell en Windows: usa solo comandos disponibles (Get-Content, Select-String, Select-Object,
  Get-ChildItem, Where-Object, Measure-Object). PROHIBIDO rg/head/tail/grep/sed/awk y pipes Unix.
- Regla de salud: si >50% de los ultimos 10 ciclos fueron AUDIT_ONLY, este ciclo (salvo P0/P1) DEBE
  ser una mejora de producto.
- Cadencia de regresion: regresion integral solo en cambios transversales, cada N ciclos, codigo
  compartido critico o hitos. No ejecutes run-all tras un cambio aislado de copy.
- Actualiza workspace/CONTINUOUS-EVOLUTION-STATUS.md (ciclo N, fecha, HEAD inicial/final, tareas,
  hallazgos, bugs, tests PASS/FAIL, commits, bloqueos, limitaciones, proxima prioridad).
- Actualiza workspace/CONTINUOUS-EVOLUTION-QUEUE.md (TODO/ACTIVE/BLOCKED/DONE/DISCOVERED/DEFERRED).
- Revisa git diff y git status. Crea un commit descriptivo y pequeno si hay cambios validos.
  No hagas commits vacios. Nunca hagas push.

PROHIBIDO: git push/merge/rebase/reset/clean/branch -D/checkout --, rm -rf, Remove-Item
recursivo/forzado, clonar el repositorio, modificar el remoto, introducir claves o pagos.

Al terminar, cierra tu respuesta final con una linea exacta: RESULTADO_CICLO: <TIPO>
"@
    } else {
      $prompt = @"
TOOLISTO AUTONOMOUS PRODUCTION READINESS - CYCLE $cycle

Raiz del repositorio REAL: $ProjectRoot
Trabaja directamente sobre este repositorio. No clones, no uses otro workspace.

Lee obligatoriamente, en orden:
1. AGENTS.md
2. workspace/PRODUCTION-READINESS-MISSION.md
3. workspace/PRODUCTION-READINESS-STATUS.md
4. workspace/PRODUCTION-READINESS-QUEUE.md

Despues revisa: git status, git rev-parse HEAD, git log --oneline -5, y los tests relacionados con la tarea seleccionada.

Selecciona la tarea ejecutable de mayor prioridad de PRODUCTION-READINESS-QUEUE.md (P0 > P1 > P2 > P3).
Cambiala a ACTIVE en la cola y ejecutala. No preguntes al usuario que hacer.

Ciclo obligatorio: AUDITAR -> REPRODUCIR -> IMPLEMENTAR -> PROBAR -> CORREGIR -> REGRESION -> DOCUMENTAR -> COMMIT.
- Implementa cambios reales; no te limites a analizar. Si encuentras un bug corregible, corrigelo.
- Ejecuta tests enfocados y regresion relacionada; anade regresion nueva cuando corresponda.
- Anti-ciclo-vacio: un ciclo que solo regenera evidencia o audita sin cambio es INVALIDO.
- Politica de evidencia (anti-churn): toca solo la evidencia afectada; salidas deterministas;
  si regenerar produce contenido identico, NO lo commitees.
- Tests con flake: reproduce enfocada, diagnostica; maximo ~3 intentos; luego BLOCKED_FLAKY y otra tarea.
- Actualiza workspace/PRODUCTION-READINESS-STATUS.md (ciclo N, fecha, HEAD inicial/final, tareas,
  hallazgos, bugs, tests PASS/FAIL, commits, bloqueos, limitaciones, proxima prioridad).
- Actualiza workspace/PRODUCTION-READINESS-QUEUE.md (TODO/ACTIVE/BLOCKED/DONE).
- Documenta evidencia en artifacts/ SOLO si aporta a la tarea. Revisa git diff y git status.
  Crea un commit descriptivo y pequeno si hay cambios validos. No hagas commits vacios.
- Si la etapa Production Readiness esta REALMENTE terminada (criterios de DONE del MISSION):
  ejecuta la validacion final (build, regresion completa, git status limpio, docs) y SOLO entonces
  crea workspace/PRODUCTION_READINESS_DONE. No lo crees por agotamiento de ciclos.
  El DONE NO detiene el sistema: el runner transicionara automaticamente a CONTINUOUS EVOLUTION.

PROHIBIDO: git push/merge/rebase/reset/clean/branch -D/checkout --, rm -rf, Remove-Item
recursivo/forzado, clonar el repositorio, modificar el remoto.

Al terminar, cierra tu respuesta final con una linea exacta: RESULTADO_CICLO: <TIPO>
"@
    }

    # Scope de PRUEBA del orquestador: ciclos acotados que NO tocan producto; solo
    # trabajo real minimo de la infraestructura autonomia (docs/estado/verificacion)
    # para certificar el relanzamiento sin intervencion. Sistema NO productivo.
    if ($TestCycles) {
      $prompt += @"

=== MODO PRUEBA DEL ORQUESTADOR (TestCycles) ===
Este run es la PRUEBA CONTROLADA del runner autonomo (relanzamiento automatico entre ciclos, logs, estado, lock, exit-code). Objetivo exclusivo de este ciclo:
- NO modifiques producto, NO anadas modulos/herramientas, NO ejecutes regresion integral.
- Produce una mejora minima REAL y verificable del sistema autonomo o del estado: verifica determinismo/consistencia del estado del runner (artifacts/autonomous-runs), corrige un documento de mision/estado/cola si hay algo factualmente incorrecto, o registra una observacion honesta con valor; con un commit local pequeno que acredite el progreso verificado.
- Tiempo objetivo: <= 15 minutos. Cierra rapido y limpio.
- Cierra tu respuesta final con la linea exacta RESULTADO_CICLO: <TIPO>
"@
    }

    # CE-069 §11/§12: si el ciclo anterior fallo bajo supervision, anteponemos el
    # contexto de RECOVERY compacto al prompt de ESTE intento (un solo uso) y lo
    # limpiamos de inmediato para no contaminar ciclos posteriores.
    if (-not [string]::IsNullOrWhiteSpace($recoveryPrompt)) {
      $prompt = "$recoveryPrompt`r`n`r`n$prompt"
      $recoveryPromptChars = $recoveryPrompt.Length
      Write-Log "Recovery context del ciclo anterior antepuesto al prompt de este ciclo ($recoveryPromptChars chars)."
      $recoveryPrompt = ""
    }

    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $logFile = Join-Path $LogDir ("cycle-{0:D3}-{1}.log" -f $cycle, $ts)
    $headFrom = git rev-parse --short HEAD 2>$null
    # Invocacion real: sin --agent (flag no soportado en esta CLI; el agente se
    # resuelve por default_agent de opencode.json), titulo sin espacios (el
    # puente cli supervise divide --args por whitespace).
    $ocArgs = "run"
    if ($Agent) { $ocArgs += " --agent $Agent" }
    if ($Model) { $ocArgs += " --model $Model" }
    $ocArgs += " --title $titleArg"
    $cmdLine = "$OcCommand $ocArgs <prompt> (supervisado cli supervise)"
    $header = @"
================================================================
Cycle: $cycle
Mode: $Mode
Timestamp: $startedTs
Comando: $cmdLine
Root: $ProjectRoot
Log: $logFile
================================================================

PROMPT:
$prompt

================================================================
OUTPUT:
"@
    Set-Content -LiteralPath $logFile -Value $header -Encoding UTF8
    Set-Content -LiteralPath $CycleFile -Value "Cycle=$cycle Mode=$Mode Title=$titleArg Started=$startedTs Log=$logFile Supervisor=live" -Encoding UTF8

    # CE-069: OpenCode se lanza SUPERVISADO via `cli supervise`. El supervisor
    # (AI_AUTONOMY/supervisor.mjs) es la UNICA autoridad sobre el proceso vivo:
    # detecta bucle de narracion / stall, reevalua progreso verificado, interrumpe
    # de forma graceful y, si es necesario, termina el process tree completo, sin
    # dejar huerfanos. PowerShell solo ORQUESTA ciclos (no vigila el mismo PID).
    # La sesion OpenCode corre sincronamente bajo el supervisor: el launcher espera
    # el veredicto JSON y deja que el runtime decida la recuperacion.
    Write-Log "Cycle $cycle ($ModeShort) - lanzando opencode SUPERVISADO (cli supervise). El supervisor controla el proceso vivo."
    $promptFile = Join-Path $ProjectRoot "_toolisto_autopilot\tmp\cycle-$cycle.prompt.txt"
    try { $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $promptFile) } catch { }
    try { Set-Content -LiteralPath $promptFile -Value $prompt -Encoding UTF8 } catch { }

    # Start-Process en PS 5.1 NO cita los elementos del array; entrecomillamos a mano
    # los valores (--args, comando, rutas) para que node reciba argv sin romper. El
    # PRIMER argumento debe ser el script node (AI_AUTONOMY/cli.mjs); sin el, node
    # interpreta `supervise` como modulo y muere con MODULE_NOT_FOUND (out.json vacio).
    $supCli = Join-Path $ProjectRoot "AI_AUTONOMY\cli.mjs"
    $spArgs = @(('"' + $supCli + '"'), 'supervise', '--cmd', ('"' + $OcCommand + '"'), '--args', ('"' + $ocArgs + '"'),
                '--prompt-file', ('"' + $promptFile + '"'), '--stdout-log', ('"' + $logFile + '"'),
                '--cycle', ([string]$cycle))
    if ($PhaseTimeoutMinutes -gt 0) { $spArgs += @('--phase-timeout-ms', ([string]($PhaseTimeoutMinutes * 60 * 1000))) }
    if ($taskId) { $spArgs += @('--task', $taskId) }
    $supResp = $null
    $supJsonFile = Join-Path $ProjectRoot "_toolisto_autopilot\tmp\cycle-$cycle.supervise.out.json"
    $supErrFile = Join-Path $ProjectRoot "_toolisto_autopilot\tmp\cycle-$cycle.supervise.err.txt"
    try { $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $supJsonFile) } catch { }
    try { Set-Content -LiteralPath $supJsonFile -Value '' -Encoding UTF8 } catch { }
    try {
      $sp = Start-Process -FilePath "node" -ArgumentList $spArgs -PassThru -NoNewWindow `
        -RedirectStandardOutput $supJsonFile -RedirectStandardError $supErrFile
      # Heartbeat: para que la consola no parezca detenida durante un ciclo largo sin
      # cambiar, mostramos periodicamente la duracion, el crecimiento del log del ciclo
      # y el HEAD actual. Todo el progreso detallado vive en el log del ciclo.
      $hbLast = 0
      $hbStart = Get-Date
      while (-not $sp.HasExited) {
        Start-Sleep -Seconds 60
        $logSize = 0
        try { $logSize = (Get-Item -LiteralPath $logFile -ErrorAction Stop).Length } catch { }
        $deltaKB = [Math]::Round(($logSize - $hbLast) / 1KB, 1)
        $min = [Math]::Round(((Get-Date) - $hbStart).TotalMinutes, 1)
        $headNow = git rev-parse --short HEAD 2>$null
        Write-Log ("  [en marcha] Cycle {0}: {1} min | log {2} KB (+{3} KB) | HEAD {4}" -f $cycle, $min, [Math]::Round($logSize / 1KB, 1), $deltaKB, $headNow)
        $hbLast = $logSize
      }
      $supJsonRaw = Get-Content -LiteralPath $supJsonFile -Raw -ErrorAction SilentlyContinue
      if ($supJsonRaw) { try { $supResp = $supJsonRaw | ConvertFrom-Json } catch { $supResp = $null } }
    } catch {
      $supResp = $null
      Write-Log "FALLO GRAVE de infraestructura del runner al invocar el supervisor: $($_.Exception.Message)"
      Write-WatchLog "FALLO GRAVE al invocar cli supervise: $($_.Exception.Message)"
    }

    # Fallback de supervisor (mision §14): si el supervisor falla (sin JSON valido),
    # NO volvemos silenciosamente al modo no supervisado. Preservamos el checkpoint
    # y dejamos que el runtime decida el retry seguro.
    if (-not $supResp -or -not $supResp.ok) {
      $supReason = if ($supResp -and $supResp.reason) { $supResp.reason } else { 'supervisor internal failure (no JSON)' }
      # Diagnostico: si el supervisor murio sin veredicto, volcar su stderr (p.ej.
      # MODULE_NOT_FOUND o un stack trace) para no adivinar la causa.
      try {
        if (Test-Path -LiteralPath $supErrFile) {
          $errSnippet = (Get-Content -LiteralPath $supErrFile -TotalCount 6 -ErrorAction SilentlyContinue | Where-Object { $_ -and $_.Trim() }) -join ' | '
          if ($errSnippet) { Write-Log "Supervisor stderr: $errSnippet" }
        }
      } catch { }
      Write-Log "SUPERVISOR FAILURE en el ciclo ${cycle}: $supReason. Preservando checkpoint; el runtime decide el retry seguro (sin volver al modo no supervisado)."
      Write-WatchLog "SUPERVISOR FAILURE ciclo ${cycle}: $supReason. Checkpoint preservado."
      $null = Invoke-Runtime @('fail', '--outcome', 'CONFIG_ERROR', '--reason', $supReason)
      $rec = Invoke-Runtime @('recover')
      $exit = 5
      $nextAction = if ($rec -and $rec.ok) { $rec.action } else { 'RETRY_DIRECT' }
      $delayMin = 1
      if ($rec -and $rec.ok -and $rec.backoffMinutes -gt 0) { $delayMin = $rec.backoffMinutes }
      # CE-070: registrar el ciclo en la historia estructurada (fallo de infra,
      # no penalizado como fallo de calidad de la tarea -> EnvFailure).
      Write-CycleHistory -Cycle $cycle -ModeShort $modeShort -TaskId $taskId -Outcome 'CONFIG_ERROR' -Result 'SIN_MARCA' -NextAction $nextAction -Exit 5 -DurationS 0 -HeadFrom $headFrom -HeadTo $headFrom -PromptChars $prompt.Length -RecoveryChars 0 -EnvFailure
      if ($nextAction -eq 'SAFE_MODE') {
        Write-Log "RUNTIME SAFE_MODE tras SUPERVISOR FAILURE del ciclo $cycle. Deteniendo (requiere intervencion humana)."
        Write-WatchLog "SAFE_MODE tras SUPERVISOR FAILURE ciclo $cycle."
        $FinalStatus = "safe_mode"
        break
      }
      $nextRetry = (Get-Date).AddMinutes($delayMin).ToString("yyyy-MM-dd HH:mm:ss")
      try { Set-Content -LiteralPath $BackoffFile -Value ("Level=Runtime DelayMinutes=$delayMin NextRetry=$nextRetry ConsecutiveFailures=1 Next=$nextAction") -Encoding UTF8 } catch { }
      Write-Log "Esperando $delayMin min (supervisor failure) antes del proximo ciclo..."
      Start-Sleep -Seconds ($delayMin * 60)
      continue
    }

    # Veredicto del supervisor (ya persistido en el runtime por cli supervise).
    $outcome = if ($supResp.outcome) { $supResp.outcome } else { 'CRASH' }
    $supReason = if ($supResp.reason) { $supResp.reason } else { $outcome }
    $exit = switch ($outcome) {
      'SUCCESS' { 0 }
      'CRASH'   { if ($supResp.exitCode) { [int]$supResp.exitCode } else { 1 } }
      'LOOP_INTERRUPTED' { 2 }
      'STALL'   { 3 }
      'TIMEOUT' { 4 }
      'CONFIG_ERROR' { 5 }
      default   { 1 }
    }
    $lastExit = $exit
    $finishedTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $headTo = git rev-parse --short HEAD 2>$null

    # Metrica del ciclo
    $result = Get-CycleResult -LogPath $logFile
    $bucket = Get-CoarseBucket -Result $result
    $startObj = [datetime]::ParseExact($startedTs, "yyyy-MM-dd HH:mm:ss", $null)
    $endObj = [datetime]::ParseExact($finishedTs, "yyyy-MM-dd HH:mm:ss", $null)
    $durSec = [int]($endObj - $startObj).TotalSeconds
    $metricsHeader = "cycle`tmode`tstarted`tfinished`tduration_s`texit`tresult`tbucket`thead_from`thead_to`toutcome"
    if (-not (Test-Path -LiteralPath $MetricsFile)) {
      Set-Content -LiteralPath $MetricsFile -Value $metricsHeader -Encoding UTF8
    }
    Add-Content -LiteralPath $MetricsFile -Value ("{0}`t{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}`t{8}`t{9}`t{10}" -f $cycle, $Mode, $startedTs, $finishedTs, $durSec, $exit, $result, $bucket, $headFrom, $headTo, $outcome) -Encoding UTF8
    Add-Content -LiteralPath $logFile -Value "`n================================================================`nSUPERVISOR OUTCOME: $outcome`nEXIT CODE: $exit`nRESULTADO CICLO: $result (bucket $bucket) HEAD $headFrom -> $headTo`n================================================================`n" -Encoding UTF8
    Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue

    # Artefactos por ciclo: copia del log completo + actualizacion del estado del runner.
    $cycleLogCopy = Join-Path $RunDir ("workspace-cycle-{0:D3}.log" -f $cycle)
    try { $null = New-Item -ItemType Directory -Force -Path $RunDir; Copy-Item -LiteralPath $logFile -Destination $cycleLogCopy -Force -ErrorAction Stop } catch { }
    Write-RunnerState -Status "running" -Cycle $cycle -StartedAt $startedTs -FinishedAt $finishedTs -Exit $exit -HeadTo $headTo

    # CE-070: registrar el ciclo terminado en la historia estructurada del
    # runtime (policy evidence). Metricas reales del ciclo (commits y archivos
    # tocados entre HEAD inicial y final) mas las de supervision.
    $commitCount = 0
    $filesCount = 0
    if ($headFrom -and $headTo -and $headFrom -ne $headTo) {
      $cc = & git rev-list --count "$headFrom..$headTo" 2>$null
      if ($cc -match '^\d+$') { $commitCount = [int]$cc }
      $fc = (& git diff --name-only $headFrom $headTo 2>$null | Measure-Object).Count
      if ($fc) { $filesCount = [int]$fc }
    }
    if ($modeShort -and $taskId) {
      Write-CycleHistory -Cycle $cycle -ModeShort $modeShort -TaskId $taskId -Outcome $outcome -Result $result -NextAction '' -Exit $exit -DurationS $durSec -HeadFrom $headFrom -HeadTo $headTo -PromptChars $prompt.Length -RecoveryChars $recoveryPromptChars -Commits $commitCount -Files $filesCount -SafeMode:($nextAction -eq 'SAFE_MODE')
    }

    # CE-068/069: el resultado del ciclo YA se persistio en el runtime dentro de
    # cli supervise (SUCCESS o FAILURE). Aqui solo consultamos la recuperacion.
    if ($exit -eq 0) {
      $consecutiveFailures = 0
      $recoveryPrompt = ""
      $recoveryPromptChars = 0
      Remove-Item -LiteralPath $BackoffFile -Force -ErrorAction SilentlyContinue
      Write-Log "Cycle $cycle OK (supervisor SUCCESS, resultado $result). Estado persistente: SUCCESS."
      if ($supResp -and $supResp.treeCleaned) { Write-Log "Supervisor: process tree limpiado exitosamente al terminar." }
    } else {
      # No se vuelve a llamar a fail: cmdSupervise ya persistio el fallo con el
      # outcome clasificado (LOOP_INTERRUPTED / STALL / CRASH / TIMEOUT). Solo
      # recuperamos backoff + proxima accion del runtime (persistente).
      $rec = Invoke-Runtime @('recover')
      $delayMin = 1
      if ($rec -and $rec.ok -and $rec.backoffMinutes -gt 0) { $delayMin = $rec.backoffMinutes }
      $nextAction = if ($rec -and $rec.ok) { $rec.action } else { "RETRY_DIRECT" }
      $consecutiveFailures = 1

      if ($nextAction -eq "SAFE_MODE") {
        Write-Log "RUNTIME SAFE_MODE tras fallo supervisado del ciclo $cycle (outcome $outcome). Crash-loop persistido alcanzado; deteniendo el runner (requiere intervencion humana)."
        Write-WatchLog "SAFE_MODE tras ciclo $cycle (outcome $outcome). Crash-loop persistido."
        $FinalStatus = "safe_mode"
        break
      }
      if ($nextAction -eq "DEFER_TASK" -or $nextAction -eq "CONTEXT_RESET" -or $nextAction -eq "STRATEGY_SWITCH") {
        Write-Log "Runtime recomienda $nextAction para el ciclo $cycle (outcome $outcome): se ajustara el contexto del proximo intento."
      }

      # CE-069 §11/§12: contexto de RECOVERY compacto para el proximo intento.
      # Se antepone al prompt del siguiente ciclo; en intentos sucesivos el
      # runtime ya escalo a STRATEGY_SWITCH/CONTEXT_RESET/DEFER_TASK/SAFE_MODE.
      $recoveryPrompt = Format-RecoveryPrompt -Cycle $cycle -ModeShort $modeShort -Outcome $outcome -Reason $supReason -NextAction $nextAction -LastHead $headTo

      $nextRetry = (Get-Date).AddMinutes($delayMin).ToString("yyyy-MM-dd HH:mm:ss")
      try {
        Set-Content -LiteralPath $BackoffFile -Value ("Level=Runtime DelayMinutes=$delayMin NextRetry=$nextRetry ConsecutiveFailures=$consecutiveFailures Next=$nextAction Outcome=$outcome") -Encoding UTF8
      } catch { }
      Write-Log "Cycle $cycle termino (supervisor outcome $outcome). Runtime -> $nextAction, backoff persistido $delayMin min (proximo intento ~$nextRetry)."
      Write-WatchLog "Ciclo $cycle con outcome $outcome ($supReason). Runtime $nextAction backoff $delayMin min."
      Get-Content -LiteralPath $logFile -Tail 25 | ForEach-Object { Write-Host "    $_" }
      Write-Log "Esperando $delayMin min (auto-recovery, backoff del runtime) antes del proximo ciclo..."
      Start-Sleep -Seconds ($delayMin * 60)
    }

    if (Test-Path -LiteralPath $StopFlag) {
      Write-Log "AUTONOMOUS_STOP detectado tras el ciclo $cycle. Deteniendo (solo el humano detiene el sistema)."
      $FinalStatus = "stopped"
      break
    }
    if ($Mode -eq "PRODUCTION_READINESS" -and (Test-Path -LiteralPath $PrDoneFile)) {
      Write-Log "TRANSICION: Production Readiness completa. Cambiando a CONTINUOUS EVOLUTION. El sistema continua."
      Write-WatchLog "TRANSICION a CONTINUOUS_EVOLUTION tras el ciclo $cycle (DONE creado)."
      $Mode = "CONTINUOUS_EVOLUTION"
      $mf = Get-ModeFiles -Mode $Mode
      try { Set-Content -LiteralPath $ModeFile -Value $Mode -Encoding UTF8 } catch { }
    }

    if (-not $isUnlimited -and $cycle -lt $MaxCycles) {
      Write-Log "Esperando $PauseSeconds s antes del proximo ciclo..."
      Start-Sleep -Seconds $PauseSeconds
    }
  }

  Write-Log "Runner finalizado tras $cycle ciclos (exit ultimo ciclo: $lastExit). Modo final: $Mode"
  if (Test-Path -LiteralPath $StopFlag) {
    Write-Log "Razon de parada: AUTONOMOUS_STOP (orden humana). Para reanudar: .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume"
  }
  if ($FinalStatus -eq "running") {
    $FinalStatus = if ($lastExit -eq 0) { "completed_ok" } else { "completed_failed" }
  }
  $finalHead = git rev-parse --short HEAD 2>$null
  Write-RunnerState -Status $FinalStatus -Cycle $cycle -StartedAt $startedTs -FinishedAt (Get-Date -Format "yyyy-MM-dd HH:mm:ss") -Exit $lastExit -HeadTo $finalHead
  Write-Log "Estado persistido: $RunState (status=$FinalStatus, ciclo=$cycle, head=$finalHead)"
} finally {
  Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch { }
    $mutex.Dispose()
  }
  try { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue } catch { }
}
