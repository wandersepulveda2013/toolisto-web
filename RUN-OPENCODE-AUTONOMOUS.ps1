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
  [int]$MaxCycles = 0,
  [switch]$Unlimited,
  [int]$PauseSeconds = 60,
  [int[]]$BackoffMinutes = (1, 5, 15, 30),
  [switch]$Resume,
  [switch]$DryRun,
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

# Lee el marcador RESULTADO_CICLO del log (la salida de opencode se anade como UTF-16).
function Get-CycleResult {
  param([string]$LogPath)
  try {
    $content = Get-Content -LiteralPath $LogPath -Encoding Unicode -Raw -ErrorAction Stop
  } catch {
    return "SIN_MARCA"
  }
  if ($content -match 'RESULTADO_CICLO\s*[:=]\s*([A-Z_]+)') { return $Matches[1].ToUpper() }
  return "SIN_MARCA"
}

# Inicializacion
if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
  Write-Error "opencode no esta en el PATH. Instala OpenCode y reintenta."
  exit 1
}
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

  while ($isUnlimited -or $cycle -lt $MaxCycles) {
    $cycle++

    if (Test-Path -LiteralPath $StopFlag) {
      Write-Log "AUTONOMOUS_STOP detectado antes del ciclo $cycle. Deteniendo (solo el humano detiene el sistema)."
      break
    }
    if ($Mode -eq "PRODUCTION_READINESS" -and (Test-Path -LiteralPath $PrDoneFile)) {
      Write-Log "TRANSICION detectada antes del ciclo ${cycle}: Production Readiness completa -> CONTINUOUS EVOLUTION."
      $Mode = "CONTINUOUS_EVOLUTION"
      $mf = Get-ModeFiles -Mode $Mode
      try { Set-Content -LiteralPath $ModeFile -Value $Mode -Encoding UTF8 } catch { }
    }

    $modeShort = if ($Mode -eq "CONTINUOUS_EVOLUTION") { "CE" } else { "PR" }
    $titleArg = "Toolisto $modeShort Cycle $cycle"
    $missionF = $mf.Mission
    $statusF  = $mf.Status
    $queueF   = $mf.Queue

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

    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $startedTs = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logFile = Join-Path $LogDir ("cycle-{0:D3}-{1}.log" -f $cycle, $ts)
    $headFrom = git rev-parse --short HEAD 2>$null
    $cmdLine = "opencode run --agent build --model opencode/deepseek-v4-flash-free --title `"$titleArg`" <prompt>"
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
    Set-Content -LiteralPath $CycleFile -Value "Cycle=$cycle Mode=$Mode Title=$titleArg Started=$startedTs Log=$logFile" -Encoding UTF8

    Write-Log "Cycle $cycle ($ModeShort) - lanzando opencode run..."
    try {
      & opencode run --agent build --model opencode/deepseek-v4-flash-free --title $titleArg $prompt 2>&1 | Tee-Object -FilePath $logFile -Append
      $exit = $LASTEXITCODE
    } catch {
      $exit = -1
      Write-Log "Fallo GRAVE de infraestructura del runner al lanzar opencode: $($_.Exception.Message)"
      Write-WatchLog "FALLO GRAVE al lanzar opencode: $($_.Exception.Message)"
      Add-Content -LiteralPath $logFile -Value "`nFALLO GRAVE al lanzar opencode: $($_.Exception.Message)`n" -Encoding UTF8
      Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue
      break
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
    $metricsHeader = "cycle`tmode`tstarted`tfinished`tduration_s`texit`tresult`tbucket`thead_from`thead_to"
    if (-not (Test-Path -LiteralPath $MetricsFile)) {
      Set-Content -LiteralPath $MetricsFile -Value $metricsHeader -Encoding UTF8
    }
    Add-Content -LiteralPath $MetricsFile -Value ("{0}`t{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}`t{8}`t{9}" -f $cycle, $Mode, $startedTs, $finishedTs, $durSec, $exit, $result, $bucket, $headFrom, $headTo) -Encoding UTF8
    Add-Content -LiteralPath $logFile -Value "`n================================================================`nEXIT CODE: $exit`nRESULTADO CICLO: $result (bucket $bucket) HEAD $headFrom -> $headTo`n================================================================`n" -Encoding UTF8
    Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue

    if ($exit -ne 0) {
      $consecutiveFailures++
      $level = [Math]::Min($consecutiveFailures, $BackoffMinutes.Count)
      $delayMin = $BackoffMinutes[$level - 1]
      $nextRetry = (Get-Date).AddMinutes($delayMin).ToString("yyyy-MM-dd HH:mm:ss")
      try {
        Set-Content -LiteralPath $BackoffFile -Value ("Level=$level DelayMinutes=$delayMin NextRetry=$nextRetry ConsecutiveFailures=$consecutiveFailures") -Encoding UTF8
      } catch { }
      Write-Log "Cycle $cycle termino con exit code $exit (fallos consecutivos: $consecutiveFailures). Backoff $delayMin min (proximo intento ~$nextRetry)."
      Write-WatchLog "Ciclo $cycle con exit $exit. Backoff nivel $level ($delayMin min)."
      Get-Content -LiteralPath $logFile -Tail 25 | ForEach-Object { Write-Host "    $_" }
      Write-Log "Esperando $delayMin min (auto-recovery) antes del proximo ciclo..."
      Start-Sleep -Seconds ($delayMin * 60)
    } else {
      $consecutiveFailures = 0
      Remove-Item -LiteralPath $BackoffFile -Force -ErrorAction SilentlyContinue
      Write-Log "Cycle $cycle OK (exit 0, resultado $result)."
    }

    if (Test-Path -LiteralPath $StopFlag) {
      Write-Log "AUTONOMOUS_STOP detectado tras el ciclo $cycle. Deteniendo (solo el humano detiene el sistema)."
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
} finally {
  Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch { }
    $mutex.Dispose()
  }
  try { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue } catch { }
}
