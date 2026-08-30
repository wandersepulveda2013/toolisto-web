#Requires -Version 5.1
<#
.SYNOPSIS
  Watchdog del sistema autonomo de OpenCode de Toolisto (Evolucion Continua).

.DESCRIPTION
  Vigila el runner y su ciclo actual SIN matar procesos sanos:
  - Runner sin lock -> estado STOPPED (sugiere resume si hay AUTONOMOUS_STOP).
  - Lock con PID muerto -> lock stale; con -CleanStale lo elimina.
  - Runner vivo con ciclo en curso: comprueba si el log del ciclo no ha crecido en
    -StaleMinutes con un proceso opencode aun vivo (ciclo colgado). Reporta siempre;
    con -KillStale termina SOLO ese proceso hijo colgado para que el runner continue.
  - Progreso verificado: lee AI_AUTONOMY/events.jsonl; si el log de texto avanza pero
    no llega ningun evento verificadpo en -LoopSuspectMinutes, senala un posible
    bucle de narracion (el log crece, pero la narracion no es ejecucion).
  - Escribe hallazgos en artifacts/autonomous-logs/watchdog.log.

.PARAMETER StaleMinutes
  Minutos sin crecimiento del log para considerar un ciclo colgado. Default 180.

.PARAMETER LoopSuspectMinutes
  Minutos sin nuevos eventos verificados mientras el log de texto SI crece para
  sospechar bucle de narracion. Default 60.

.PARAMETER KillStale
  Termina el proceso opencode de un ciclo colgado (recomendado en tarea programada).

.PARAMETER CleanStale
  Elimina el lock file si el PID del runner ya no existe.

.PARAMETER Quiet
  Solo escribe en watchdog.log sin salida en pantalla (modo tarea programada).

.EXAMPLE
  .\WATCHDOG-OPENCODE-AUTONOMOUS.ps1

.EXAMPLE
  .\WATCHDOG-OPENCODE-AUTONOMOUS.ps1 -KillStale -CleanStale -StaleMinutes 180 -LoopSuspectMinutes 60
#>
[CmdletBinding()]
param(
  [int]$StaleMinutes = 180,
  [int]$LoopSuspectMinutes = 60,
  [switch]$KillStale,
  [switch]$CleanStale,
  [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $ProjectRoot "artifacts\autonomous-logs"
$LockFile = Join-Path $LogDir "runner.lock"
$CycleFile = Join-Path $LogDir "runner.cycle"
$WatchLog = Join-Path $LogDir "watchdog.log"
$EventLogPath = Join-Path $ProjectRoot "AI_AUTONOMY\events.jsonl"
$null = New-Item -ItemType Directory -Force -Path $LogDir

function Say {
  param([string]$Msg)
  if (-not $Quiet) { Write-Host $Msg }
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $WatchLog -Value ("[{0}] {1}" -f $ts, $Msg) -Encoding UTF8 -ErrorAction SilentlyContinue
}

# Detecta un posible bucle de narracion: hay una ultima marca de proceso (head)
# desde hace >= $AgeMin, pero el ultimo evento VERIFICADO es mas viejo que el
# ultimo evento de INTENCION (narracion). Es decir: el modelo SIGUE diciendo que
# hara algo sin NINGUN efecto real observable. Devuelve un string descriptivo o "".
function Detect-NarrationLoop {
  param([string]$EventsPath, [string]$VerifiedFile, [int]$AgeMin)
  if (-not (Test-Path -LiteralPath $EventsPath)) { return "" }
  $lastVerified = 0
  $lastIntent = 0
  try {
    Get-Content -LiteralPath $EventsPath -ErrorAction Stop | ForEach-Object {
      $line = $_.Trim()
      if (-not $line) { return }
      try { $ev = $line | ConvertFrom-Json } catch { return }
      if ($ev.verifiedAt) { if ($ev.verifiedAt -gt $lastVerified) { $lastVerified = [double]$ev.verifiedAt } }
      if ($ev.kind -eq 'intent') { $lastIntent = $lastIntent + 1 }
    }
  } catch { return "" }
  if ($lastVerified -eq 0) { return "sin eventos VERIFICADOS en el log (solo narracion: $lastIntent intents)" }
  return ""
}

# CE-068: lee el heartbeat persistente del runtime (AI_AUTONOMY/heartbeat.json)
# como fuente EXTERNA de liveness/estado. SOLO informativo: nunca compite con el
# runner para matar/reiniciar; si el runner esta vivo, el runtime ya lo gobierna.
# Devuelve un hashtable o $null.
function Read-RuntimeHeartbeat {
  $hb = Join-Path $ProjectRoot "AI_AUTONOMY\heartbeat.json"
  if (-not (Test-Path -LiteralPath $hb)) { return $null }
  try {
    return (Get-Content -LiteralPath $hb -Raw -ErrorAction Stop | ConvertFrom-Json)
  } catch { return $null }
}

# 1. Runner activo?
if (-not (Test-Path -LiteralPath $LockFile)) {
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot "AUTONOMOUS_STOP")) {
    Say "WATCHDOG: sin runner activo y AUTONOMOUS_STOP presente. Sistema detenido por orden humana. Resume: .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume"
  } else {
    Say "WATCHDOG: sin runner activo (STOPPED). No hay lock. Si esperabas actividad, revisa el log del runner."
  }
  exit 0
}

$lockRaw = Get-Content -LiteralPath $LockFile -Raw -ErrorAction SilentlyContinue
$runnerPid = $null
if ($lockRaw -match 'PID=(\d+)') { $runnerPid = [int]$Matches[1] }
$runnerAlive = $false
if ($runnerPid) { $runnerAlive = [bool](Get-Process -Id $runnerPid -ErrorAction SilentlyContinue) }

if (-not $runnerAlive) {
  Say "WATCHDOG: lock STALE. El PID $runnerPid del runner no existe. Estado: STOPPED/STALE_LOCK."
  if ($CleanStale) {
    Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $CycleFile -Force -ErrorAction SilentlyContinue
    Say "WATCHDOG: lock stale limpiado (-CleanStale)."
  } else {
    Say "WATCHDOG: usa -CleanStale para limpiar el lock stale."
  }
  exit 0
}

Say "WATCHDOG: runner vivo (PID $runnerPid)."

# CE-068: heartbeat del runtime como fuente externa de estado (SIN competir con el
# launcher para matar/reiniciar). Si el runtime manda SAFE_MODE, se informa.
$hb = Read-RuntimeHeartbeat
if ($hb) {
  $hbState = "cycle=$($hb.cycle) task=$($hb.taskId) phase=$($hb.phase) verified=$($hb.lastVerifiedStep) streak=$($hb.crashLoopStreak)"
  Say "WATCHDOG: heartbeat runtime => $hbState"
  if ($hb.safeMode) {
    Say "WATCHDOG: RUNTIME SAFE_MODE activo (cycle $($hb.cycle)). El runner lo gestiona; sin accion del watchdog. Requiere intervencion humana para reanudar."
  }
}

# 2. Ciclo en curso?
if (-not (Test-Path -LiteralPath $CycleFile)) {
  Say "WATCHDOG: sin ciclo en curso (runner entre ciclos o en pausa). OK."
  exit 0
}

$cycleRaw = Get-Content -LiteralPath $CycleFile -Raw -ErrorAction SilentlyContinue
$titleArg = ""
$logPath = ""
if ($cycleRaw -match 'Title=(.+?) Started=') { $titleArg = $Matches[1].Trim() }
if ($cycleRaw -match 'Log=(.+)') { $logPath = $Matches[1].Trim() }
Say "WATCHDOG: ciclo en curso -> $($cycleRaw.Trim())"

# 3. Proceso opencode de este ciclo
$child = Get-CimInstance Win32_Process -Filter "Name='opencode.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$titleArg*" } | Select-Object -First 1

if (-not $child) {
  Say "WATCHDOG: el ciclo $titleArg no tiene proceso opencode vivo (puede estar lanzando o terminando). OK por ahora."
  exit 0
}

# 4. Log sin crecer?
$verifiedProbe = Join-Path $ProjectRoot "AI_AUTONOMY\state.json"
if ($logPath -and (Test-Path -LiteralPath $logPath)) {
  $lastWrite = (Get-Item -LiteralPath $logPath).LastWriteTime
  $ageMin = [int]((Get-Date) - $lastWrite).TotalMinutes
  if ($ageMin -ge $StaleMinutes) {
    Say "WATCHDOG: CICLO COLGADO. Proceso opencode PID $($child.ProcessId) del ciclo $titleArg con log sin cambios desde hace $ageMin min (limite $StaleMinutes)."
    if ($KillStale) {
      Say "WATCHDOG: terminando proceso colgado PID $($child.ProcessId) (-KillStale). El runner continuara con auto-recovery."
      Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    } else {
      Say "WATCHDOG: usa -KillStale para terminar ese proceso colgado."
    }
  } else {
    Say "WATCHDOG: ciclo vivo, log actualizado hace $ageMin min. OK."
    # Progreso verificado: un ciclo que ESCRIBE log (narracion) pero NO produce
    # eventos verificados en AI_AUTONOMY/events.jsonl es un bucle de narracion
    # invisible al check de LastWriteTime (el texto SI avanza). Detectarlo aqui.
    $loopSuspect = Detect-NarrationLoop -EventsPath $EventLogPath -VerifiedFile $verifiedProbe -AgeMin $LoopSuspectMinutes
    if ($loopSuspect) {
      Say "WATCHDOG: SOSPECHA DE BUCLE DE NARRACION en $titleArg ($loopSuspect). El log avanza pero no hay progreso verificado. Revisa AI_AUTONOMY/events.jsonl."
    }
  }
} else {
  Say "WATCHDOG: ciclo en curso pero sin log localizable ($logPath). Revisar manualmente."
}
exit 0
