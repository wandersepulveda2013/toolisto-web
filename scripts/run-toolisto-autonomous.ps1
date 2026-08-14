<#
.SYNOPSIS
    Ejecuta ciclos autónomos, no interactivos y controlados de Toolisto mediante OpenCode.
.DESCRIPTION
    Compatible con Windows PowerShell 5.1 y OpenCode 1.18.8.
    Cada ciclo inicia un contexto nuevo, guarda logs y se detiene por DONE,
    BLOCKED, MaxCycles o tres errores consecutivos.
#>

[CmdletBinding()]
param(
    [string]$WorkingDir = "",
    [string]$Agent = "toolisto-autonomous",
    [string]$Variant = "high",
    [string]$Model = "",
    [ValidateRange(1, 100)]
    [int]$MaxCycles = 8,
    [ValidateRange(0, 3600)]
    [int]$PauseSeconds = 5,
    [switch]$SafeValidation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message) -ForegroundColor Cyan
}

function Get-RepoRoot {
    param([string]$RequestedWorkingDir)

    if ([string]::IsNullOrWhiteSpace($RequestedWorkingDir)) {
        $candidate = Split-Path -Parent $PSScriptRoot
    } else {
        $candidate = $RequestedWorkingDir
    }

    $candidate = (Resolve-Path -LiteralPath $candidate).Path

    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $root = (& git -C $candidate rev-parse --show-toplevel 2>$null)
    $gitExitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference

    if ($gitExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
        throw "No se encontró un repositorio Git válido desde: $candidate"
    }

    return (Resolve-Path -LiteralPath $root.Trim()).Path
}

function Get-FileFingerprint {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return "<missing>"
    }

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Test-Sentinel {
    param(
        [string]$DonePath,
        [string]$BlockedPath
    )

    if (Test-Path -LiteralPath $DonePath) {
        Write-Step "AUTONOMOUS_DONE detectado. No hay trabajo adicional."
        return 0
    }

    if (Test-Path -LiteralPath $BlockedPath) {
        Write-Warning "AUTONOMOUS_BLOCKED detectado. Revisa el archivo antes de continuar."
        return 2
    }

    return $null
}

$originalLocation = Get-Location
$lockStream = $null
$lockWriter = $null
$lockPath = $null

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git no está disponible en PATH."
    }

    $openCodeCommand = Get-Command opencode -ErrorAction SilentlyContinue
    if (-not $openCodeCommand) {
        throw "OpenCode no está disponible en PATH."
    }

    $repoRoot = Get-RepoRoot -RequestedWorkingDir $WorkingDir
    Set-Location -LiteralPath $repoRoot

    $requiredFiles = @(
        "AGENTS.md",
        "opencode.json",
        ".opencode\agents\$Agent.md",
        ".opencode\commands\toolisto-cycle.md",
        "workspace\AUTONOMOUS-ROADMAP.md",
        "workspace\AUTONOMOUS-STATUS.md"
    )

    foreach ($relativePath in $requiredFiles) {
        $fullPath = Join-Path $repoRoot $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Falta un archivo obligatorio: $relativePath"
        }
    }

    $configText = Get-Content -LiteralPath (Join-Path $repoRoot "opencode.json") -Raw
    $requiredSafetyTokens = @(
        "git push",
        "git merge",
        "git rebase",
        "git reset",
        "git clean"
    )

    foreach ($token in $requiredSafetyTokens) {
        if ($configText -notmatch [regex]::Escape($token)) {
            throw "opencode.json no contiene un bloqueo verificable para '$token'. No se usará --auto."
        }
    }

    # Windows PowerShell 5.1 convierte stderr de programas nativos en ErrorRecord.
    # OpenCode escribe parte de su ayuda y logs en stderr, por eso esta comprobación
    # se ejecuta temporalmente con ErrorActionPreference=Continue.
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $openCodeCommand.Source run --help *> $null
    $helpExitCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference

    if ($helpExitCode -ne 0) {
        throw "La instalación actual de OpenCode no admite 'opencode run'."
    }

    $branch = (& git -C $repoRoot branch --show-current).Trim()
    $head = (& git -C $repoRoot rev-parse --short HEAD).Trim()

    $logsDir = Join-Path $repoRoot "artifacts\autonomous-runs"
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

    $lockPath = Join-Path $logsDir "toolisto-autonomous.lock"

    if (Test-Path -LiteralPath $lockPath) {
        $existingPid = 0
        $rawLock = Get-Content -LiteralPath $lockPath -Raw -ErrorAction SilentlyContinue

        if ($rawLock -match 'PID=(\d+)') {
            $existingPid = [int]$Matches[1]
        }

        $existingProcess = $null
        if ($existingPid -gt 0) {
            $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        }

        if ($existingProcess) {
            throw "Ya existe una ejecución autónoma activa (PID $existingPid)."
        }

        Remove-Item -LiteralPath $lockPath -Force
    }

    $lockStream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )

    $lockWriter = New-Object System.IO.StreamWriter($lockStream)
    $lockWriter.WriteLine("PID=$PID")
    $lockWriter.WriteLine("Started=$(Get-Date -Format o)")
    $lockWriter.WriteLine("Repo=$repoRoot")
    $lockWriter.Flush()

    $donePath = Join-Path $repoRoot "workspace\AUTONOMOUS_DONE"
    $blockedPath = Join-Path $repoRoot "workspace\AUTONOMOUS_BLOCKED"

    $sentinelExit = Test-Sentinel -DonePath $donePath -BlockedPath $blockedPath
    if ($null -ne $sentinelExit) {
        exit $sentinelExit
    }

    $effectiveCycles = if ($SafeValidation) { 1 } else { $MaxCycles }

    $protectedRelativePaths = @(
        "workspace\workspace.js",
        "workspace\core\image-processor.js",
        "workspace\core\scanner-ui.js",
        "tests\workspace\phase3c-star-flow.spec.mjs"
    )

    $safeHashesBefore = @{}
    if ($SafeValidation) {
        foreach ($relativePath in $protectedRelativePaths) {
            $safeHashesBefore[$relativePath] = Get-FileFingerprint (Join-Path $repoRoot $relativePath)
        }
    }

    Write-Host ""
    Write-Host "=== TOOLISTO AUTONOMOUS RUN ===" -ForegroundColor Green
    Write-Host "Repositorio : $repoRoot"
    Write-Host "Rama        : $branch"
    Write-Host "HEAD        : $head"
    Write-Host "Agente      : $Agent"
    Write-Host "Variante    : $Variant"
    Write-Host "Ciclos      : $effectiveCycles"
    Write-Host "Modo seguro : $SafeValidation"
    Write-Host ""

    $consecutiveErrors = 0

    for ($cycle = 1; $cycle -le $effectiveCycles; $cycle++) {
        $sentinelExit = Test-Sentinel -DonePath $donePath -BlockedPath $blockedPath
        if ($null -ne $sentinelExit) {
            exit $sentinelExit
        }

        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $logPath = Join-Path $logsDir ("cycle-{0:D2}-{1}.log" -f $cycle, $timestamp)

        $branch = (& git -C $repoRoot branch --show-current).Trim()
        $head = (& git -C $repoRoot rev-parse --short HEAD).Trim()

        @(
            "Toolisto autonomous cycle"
            "Cycle=$cycle"
            "Timestamp=$(Get-Date -Format o)"
            "Branch=$branch"
            "HEAD=$head"
            "SafeValidation=$SafeValidation"
            "Agent=$Agent"
            "Variant=$Variant"
            "Model=$Model"
            ""
        ) | Set-Content -LiteralPath $logPath -Encoding UTF8

        if ($SafeValidation) {
            $message = "VALIDACIÓN SEGURA DEL AUTOPILOTO. Lee AGENTS.md, workspace/AUTONOMOUS-ROADMAP.md y workspace/AUTONOMOUS-STATUS.md. Ejecuta únicamente inspección de Git y configuración. No edites código de producto, no ejecutes OCR, no modifiques fixtures ni pruebas, no avances el roadmap y no crees commits de producto. Actualiza únicamente workspace/AUTONOMOUS-STATUS.md con el resultado de esta validación segura y termina."
        } else {
            $message = "Ejecuta exactamente un ciclo autónomo de Toolisto. Lee AGENTS.md, workspace/AUTONOMOUS-ROADMAP.md y workspace/AUTONOMOUS-STATUS.md. Selecciona la primera tarea ACTIVE o la primera TODO no bloqueada. Investiga, implementa un bloque coherente, ejecuta pruebas enfocadas y regresión, corrige fallos causados por tus cambios, revisa el diff, crea un commit pequeño cuando corresponda, actualiza roadmap y estado, guarda evidencia y termina este ciclo. Respeta todas las prohibiciones y no avances a Phase 4."
        }

        $arguments = @(
            "run",
            $message,
            "--command", "toolisto-cycle",
            "--agent", $Agent,
            "--dir", $repoRoot,
            "--variant", $Variant,
            "--auto",
            "--format", "default",
            "--print-logs"
        )

        if (-not [string]::IsNullOrWhiteSpace($Model)) {
            $arguments += @("--model", $Model)
        }

        Write-Step "Iniciando ciclo $cycle de $effectiveCycles"
        Write-Host "Log: $logPath"

        # Muy importante para Windows PowerShell 5.1:
        # OpenCode usa stderr para logs normales. Si ErrorActionPreference permanece
        # en Stop, la primera línea de stderr aborta el script aunque OpenCode funcione.
        $oldPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        & $openCodeCommand.Source @arguments 2>&1 |
            Tee-Object -FilePath $logPath -Append

        $cycleExitCode = $LASTEXITCODE
        $ErrorActionPreference = $oldPreference

        Add-Content -LiteralPath $logPath -Value ""
        Add-Content -LiteralPath $logPath -Value "ExitCode=$cycleExitCode"
        Add-Content -LiteralPath $logPath -Value "Finished=$(Get-Date -Format o)"

        if ($cycleExitCode -eq 0) {
            $consecutiveErrors = 0
            Write-Step "Ciclo $cycle finalizado correctamente."
        } else {
            $consecutiveErrors++
            Write-Warning "El ciclo $cycle terminó con código $cycleExitCode. Errores consecutivos: $consecutiveErrors"
        }

        if ($SafeValidation) {
            $changedProtectedFiles = @()

            foreach ($relativePath in $protectedRelativePaths) {
                $afterHash = Get-FileFingerprint (Join-Path $repoRoot $relativePath)
                if ($afterHash -ne $safeHashesBefore[$relativePath]) {
                    $changedProtectedFiles += $relativePath
                }
            }

            if ($changedProtectedFiles.Count -gt 0) {
                Write-Error ("La validación segura modificó archivos protegidos: " + ($changedProtectedFiles -join ", "))
                exit 3
            }

            Write-Step "Validación segura: ningún archivo de producto protegido cambió."
        }

        $sentinelExit = Test-Sentinel -DonePath $donePath -BlockedPath $blockedPath
        if ($null -ne $sentinelExit) {
            exit $sentinelExit
        }

        if ($consecutiveErrors -ge 3) {
            Write-Error "Tres ciclos consecutivos terminaron con error. El autopiloto se detiene."
            exit 4
        }

        if ($cycle -lt $effectiveCycles -and $PauseSeconds -gt 0) {
            Write-Step "Esperando $PauseSeconds segundos antes del próximo ciclo."
            Start-Sleep -Seconds $PauseSeconds
        }
    }

    Write-Step "Se alcanzó el máximo de $effectiveCycles ciclo(s)."
    exit 0
}
catch {
    Write-Error $_
    exit 1
}
finally {
    if ($lockWriter) {
        $lockWriter.Dispose()
    } elseif ($lockStream) {
        $lockStream.Dispose()
    }

    if ($lockPath -and (Test-Path -LiteralPath $lockPath)) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }

    Set-Location $originalLocation
}
