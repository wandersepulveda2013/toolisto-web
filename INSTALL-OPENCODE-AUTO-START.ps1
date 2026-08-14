#Requires -Version 5.1
<#
.SYNOPSIS
  Instala o elimina el arranque automatico del sistema autonomo de OpenCode al iniciar sesion.

.DESCRIPTION
  Registra una tarea de Programador de tareas de Windows que lanza el runner en modo continuo
  al iniciar sesion del usuario actual:
    powershell -NoProfile -ExecutionPolicy Bypass -File RUN-OPENCODE-AUTONOMOUS.ps1 -Unlimited -Resume

  Seguridad:
  - Si ya hay un runner activo, la tarea nueva sale sola al no poder adquirir el mutex (nunca
    habra dos runners).
  - -Resume limpia un AUTONOMOUS_STOP residual antes de arrancar.
  - El runner respeta todas las prohibiciones (sin push, sin comandos destructivos).
  - LIMITACION real documentada: si el PC se suspende, OpenCode deja de trabajar; la tarea solo
    arranca al iniciar sesion, no tras una suspension breve.

.EXAMPLE
  .\INSTALL-OPENCODE-AUTO-START.ps1 -Install

.EXAMPLE
  .\INSTALL-OPENCODE-AUTO-START.ps1 -Uninstall

.EXAMPLE
  .\INSTALL-OPENCODE-AUTO-START.ps1 -Status
#>
[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [string]$TaskName = "Toolisto Autonomous Evolution"
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $ProjectRoot "RUN-OPENCODE-AUTONOMOUS.ps1"
$ActionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -Unlimited -Resume"

if ($Install) {
  if (-not (Test-Path -LiteralPath $Runner)) {
    Write-Host "ERROR: no existe $Runner"
    exit 1
  }
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $ActionArgs -WorkingDirectory $ProjectRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -Description "Arranque automatico del sistema autonomo de OpenCode de Toolisto (Evolucion Continua)."
  Write-Host "Tarea programada '$TaskName' instalada: lanza el runner -Unlimited -Resume al iniciar sesion de $env:USERNAME."
  Write-Host "El runner respeta el mutex: si ya hay un runner activo, esta tarea no inicia una segunda instancia."
  Write-Host "LIMITACION: si el PC se suspende, OpenCode deja de trabajar hasta que vuelva a estar activo."
  exit 0
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea programada '$TaskName' eliminada."
  exit 0
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Write-Host "Tarea programada '$TaskName': INSTALADA (estado: $($task.State))"
  Write-Host "Accion: $($task.Actions.Execute) $($task.Actions.Arguments)"
  Write-Host "Para quitar: .\INSTALL-OPENCODE-AUTO-START.ps1 -Uninstall"
} else {
  Write-Host "Tarea programada '$TaskName': no instalada."
  Write-Host "Para instalar: .\INSTALL-OPENCODE-AUTO-START.ps1 -Install"
}
exit 0
