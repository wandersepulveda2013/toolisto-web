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
  - Escribe hallazgos en artifacts/autonomous-logs/watchdog.log.

.PARAMETER StaleMinutes
  Minutos sin crecimiento del log para considerar un ciclo colgado. Default 180.

.PARAMETER KillStale
  Termina el proceso opencode de un ciclo colgado (recomendado en tarea programada).

.PARAMETER CleanStale
  Elimina el lock file si el PID del runner ya no existe.

.PARAMETER Quiet
  Solo escribe en watchdog.log sin salida en pantalla (modo tarea programada).

.EXAMPLE
  .\WATCHDOG-OPENCODE-AUTONOMOUS.ps1

.EXAMPLE
  .\WATCHDOG-OPENCODE-AUTONOMOUS.ps1 -KillStale -CleanStale -StaleMinutes 180
#>
[CmdletBinding()]
param(
  [int]$StaleMinutes = 180,
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
$null = New-Item -ItemType Directory -Force -Path $LogDir

function Say {
  param([string]$Msg)
  if (-not $Quiet) { Write-Host $Msg }
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $WatchLog -Value ("[{0}] {1}" -f $ts, $Msg) -Encoding UTF8 -ErrorAction SilentlyContinue
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
  }
} else {
  Say "WATCHDOG: ciclo en curso pero sin log localizable ($logPath). Revisar manualmente."
}
exit 0
