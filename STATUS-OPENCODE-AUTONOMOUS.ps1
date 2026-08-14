#Requires -Version 5.1
<#
.SYNOPSIS
  Estado del sistema autonomo de OpenCode de Toolisto (Evolucion Continua).

.DESCRIPTION
  Muestra: modo (PRODUCTION_READINESS / CONTINUOUS_EVOLUTION), estado, PID del runner y uptime,
  ciclo actual, ultimo ciclo, HEAD, working tree, fallos consecutivos y proximo reintento,
  resumen de productividad de los ultimos 20 ciclos (PRODUCT_CHANGE/AUDIT_ONLY/TEST_ONLY/BLOCKER),
  regla de salud, y conteo de la cola activa (TODO/ACTIVE/BLOCKED/DONE/DISCOVERED/DEFERRED).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $ProjectRoot "artifacts\autonomous-logs"
$StopFlag = Join-Path $ProjectRoot "AUTONOMOUS_STOP"
$PrDoneFile = Join-Path $ProjectRoot "workspace\PRODUCTION_READINESS_DONE"
$ModeFile = Join-Path $ProjectRoot "workspace\AUTONOMOUS_MODE"
$LockFile = Join-Path $LogDir "runner.lock"
$CycleFile = Join-Path $LogDir "runner.cycle"
$BackoffFile = Join-Path $LogDir "runner.backoff"
$MetricsFile = Join-Path $LogDir "metrics.tsv"

Write-Host "=================================================="
Write-Host " TOOLISTO AUTONOMOUS - EVOLUCION CONTINUA"
Write-Host "=================================================="
Write-Host "Raiz: $ProjectRoot"

# Modo
$Mode = "PRODUCTION_READINESS"
if (Test-Path -LiteralPath $PrDoneFile) { $Mode = "CONTINUOUS_EVOLUTION" }
elseif (Test-Path -LiteralPath $ModeFile) {
  $m = ((Get-Content -LiteralPath $ModeFile -Raw -ErrorAction SilentlyContinue) -replace '\s', '')
  if ($m -eq "CONTINUOUS_EVOLUTION") { $Mode = "CONTINUOUS_EVOLUTION" }
}
Write-Host ("Modo: {0}" -f $Mode)
Write-Host ("DONE presente: {0}" -f (Test-Path -LiteralPath $PrDoneFile))
if ($Mode -eq "PRODUCTION_READINESS") {
  Write-Host "   (transicion automatica a CONTINUOUS_EVOLUTION al aparecer workspace/PRODUCTION_READINESS_DONE)"
}

# Estado y PID + uptime
$state = "STOPPED"
$runnerPid = $null
if (Test-Path -LiteralPath $LockFile) {
  $lockRaw = Get-Content -LiteralPath $LockFile -Raw -ErrorAction SilentlyContinue
  if ($lockRaw -match 'PID=(\d+)') { $runnerPid = [int]$Matches[1] }
  $running = $false
  if ($runnerPid) { $running = [bool](Get-Process -Id $runnerPid -ErrorAction SilentlyContinue) }
  if ($running) { $state = "ACTIVE" }
  else { $state = "STALE_LOCK" }
}
if (Test-Path -LiteralPath $StopFlag) { $state = "STOPPED" }
Write-Host ("Estado: {0}" -f $state)

if ($runnerPid) {
  $proc = Get-Process -Id $runnerPid -ErrorAction SilentlyContinue
  if ($proc) {
    $up = (Get-Date) - $proc.StartTime
    Write-Host ("Runner PID: {0} (iniciado {1}, uptime {2}d {3}h {4}m)" -f $runnerPid, $proc.StartTime.ToString("yyyy-MM-dd HH:mm:ss"), $up.Days, $up.Hours, $up.Minutes)
  } else {
    Write-Host "Runner PID: $runnerPid (proceso no encontrado)"
  }
} else {
  Write-Host "Runner PID: no activo"
}

# Ciclo actual
if (Test-Path -LiteralPath $CycleFile) {
  Write-Host ("Ciclo actual: {0}" -f ((Get-Content -LiteralPath $CycleFile -Raw).Trim()))
} else {
  Write-Host "Ciclo actual: entre ciclos o detenido"
}

# Fallos consecutivos y proximo reintento
if (Test-Path -LiteralPath $BackoffFile) {
  Write-Host ("Backoff: {0}" -f ((Get-Content -LiteralPath $BackoffFile -Raw).Trim()))
} else {
  Write-Host "Backoff: no activo (sin fallos consecutivos pendientes)"
}

# Ultimo ciclo y log
$logs = @(Get-ChildItem -Path $LogDir -Filter "cycle-*.log" -ErrorAction SilentlyContinue | Sort-Object Name)
if ($logs.Count -gt 0) {
  $last = $logs[-1]
  Write-Host ("Ultimo ciclo/log: {0} ({1})" -f $last.Name, $last.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
} else {
  Write-Host "Ultimo ciclo/log: ninguno aun"
}

# Git
$head = git rev-parse --short HEAD 2>$null
Write-Host ("HEAD: {0}" -f $head)
$lastCommit = git log -1 --oneline 2>$null
Write-Host ("Ultimo commit: {0}" -f $lastCommit)
$dirty = @(git status --porcelain 2>$null)
if ($dirty.Count -eq 0) {
  Write-Host "Working tree: LIMPIO"
} else {
  Write-Host ("Working tree: {0} archivo(s) modificado(s)/nuevo(s)" -f $dirty.Count)
  $dirty | Select-Object -First 10 | ForEach-Object { Write-Host ("   {0}" -f $_) }
}

# Productividad (ultimos 20 ciclos) y regla de salud
Write-Host "--- Productividad (ultimos 20 ciclos) ---"
if (Test-Path -LiteralPath $MetricsFile) {
  $rows = @(Get-Content -LiteralPath $MetricsFile -Encoding UTF8 | Where-Object { $_ -match '^[0-9]+\t' })
  $recent = @($rows | Select-Object -Last 20)
  $counts = @{ 'PRODUCT_CHANGE' = 0; 'TEST_ONLY' = 0; 'AUDIT_ONLY' = 0; 'BLOCKER' = 0; 'OTHER' = 0 }
  foreach ($r in $recent) {
    $parts = $r -split "`t"
    $bucket = if ($parts.Count -ge 8) { $parts[7] } else { 'OTHER' }
    if (-not $counts.ContainsKey($bucket)) { $bucket = 'OTHER' }
    $counts[$bucket]++
  }
  $last10 = @($rows | Select-Object -Last 10)
  $a10 = 0
  foreach ($r in $last10) {
    $parts = $r -split "`t"
    if ($parts.Count -ge 8 -and $parts[7] -eq 'AUDIT_ONLY') { $a10++ }
  }
  Write-Host ("Total registrado: {0} ciclos | Ultimos 20: PRODUCT_CHANGE={1} TEST_ONLY={2} AUDIT_ONLY={3} BLOCKER={4} OTHER={5}" -f $rows.Count, $counts['PRODUCT_CHANGE'], $counts['TEST_ONLY'], $counts['AUDIT_ONLY'], $counts['BLOCKER'], $counts['OTHER'])
  $ratio10 = if ($last10.Count -gt 0) { [math]::Round(100 * $a10 / $last10.Count) } else { 0 }
  Write-Host ("Ultimos 10: {0}/{1} AUDIT_ONLY ({2}%)" -f $a10, $last10.Count, $ratio10)
  if ($a10 -gt ($last10.Count / 2) -and $last10.Count -ge 5) {
    Write-Host "  [!] REGLA DE SALUD: >50% AUDIT_ONLY en ultimos 10 ciclos. El proximo ciclo (salvo P0/P1) debe ser mejora de producto."
  }
} else {
  Write-Host "metrics.tsv no existe todavia (el runner v2 registra metricas por ciclo)."
}

# Cola activa (por modo) con estados nuevos
$queueFile = if ($Mode -eq "CONTINUOUS_EVOLUTION") {
  Join-Path $ProjectRoot "workspace\CONTINUOUS-EVOLUTION-QUEUE.md"
} else {
  Join-Path $ProjectRoot "workspace\PRODUCTION-READINESS-QUEUE.md"
}
if (Test-Path -LiteralPath $queueFile) {
  $rows = Get-Content -LiteralPath $queueFile
  $todo = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P\d \| TODO \|').Count
  $active = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P\d \| ACTIVE \|').Count
  $blocked = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P\d \| BLOCKED \|').Count
  $done = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P\d \| DONE \|').Count
  $discovered = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P\d \| DISCOVERED \|').Count
  $deferred = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P\d \| DEFERRED \|').Count
  Write-Host ("Cola ({0}): TODO={1} ACTIVE={2} BLOCKED={3} DONE={4} DISCOVERED={5} DEFERRED={6}" -f (Split-Path $queueFile -Leaf), $todo, $active, $blocked, $done, $discovered, $deferred)
  $next = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P0 \| TODO \|')
  if ($next.Count -eq 0) { $next = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P1 \| TODO \|') }
  if ($next.Count -eq 0) { $next = @($rows | Select-String -Pattern '\| [CP]R-\d+ \| P2 \| TODO \|') }
  if ($next.Count -gt 0) {
    Write-Host ("Siguiente tarea candidata: {0}" -f $next[0].Line.Trim())
  } else {
    Write-Host "Siguiente tarea candidata: NINGUNA TODO -> el proximo ciclo sera DISCOVERY (no se detiene)"
  }
} else {
  Write-Host ("Cola: {0} no existe" -f $queueFile)
}

if ($state -eq "STOPPED" -and (Test-Path -LiteralPath $StopFlag)) {
  Write-Host "Sugerencia: .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume -Unlimited para reanudar"
}
Write-Host "Sobre la parada: el sistema solo se detiene por AUTONOMOUS_STOP, limite de ciclos explicito o fallo grave del runner. El backlog vacio y el DONE de Production Readiness NO lo detienen."
Write-Host "=================================================="
