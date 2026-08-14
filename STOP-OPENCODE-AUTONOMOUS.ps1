#Requires -Version 5.1
<#
.SYNOPSIS
  Detiene el runner autonomo de OpenCode de Toolisto (Evolucion Continua).

.DESCRIPTION
  Crea el flag AUTONOMOUS_STOP en la raiz del repositorio. El runner lo comprueba ANTES y DESPUES
  de cada ciclo: termina el ciclo actual y se detiene sin matar a OpenCode a mitad de escritura.

  El sistema SOLO se detiene por esta orden humana (o por limite de ciclos explicito o fallo grave
  de infraestructura). Un backlog vacio o el DONE de Production Readiness NO lo detienen: al
  aparecer DONE, el runner transiciona a CONTINUOUS_EVOLUTION y sigue.

  Para reanudar: .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StopFlag = Join-Path $ProjectRoot "AUTONOMOUS_STOP"

Set-Content -LiteralPath $StopFlag -Value ("Parada solicitada el " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -Encoding UTF8
Write-Host "AUTONOMOUS_STOP creado en $StopFlag"
Write-Host "El runner terminar el ciclo actual y se detendra."
Write-Host "Nota: el sistema no se detiene por backlog vacio ni por DONE de Production Readiness; solo por esta orden."
Write-Host "Para reanudar: .\RUN-OPENCODE-AUTONOMOUS.ps1 -Resume"
