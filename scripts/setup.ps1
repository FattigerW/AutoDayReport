param(
    [switch]$SkipDaemon,
    [switch]$SkipOcr
)

$ErrorActionPreference = "Stop"
$ProjectPath = Split-Path -Parent $PSScriptRoot

Write-Host "=== AutoDayReport Setup (Windows) ===" -ForegroundColor Cyan
Write-Host "Project: $ProjectPath"
Write-Host ""

# Check Node.js 18+
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    throw "Node.js not found. Please install Node.js 18+ from https://nodejs.org/"
}

$nodeVersion = node -p "process.versions.node"
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 18) {
    throw "Node.js 18+ required (found $nodeVersion)."
}
Write-Host "Node.js: v$nodeVersion"

# npm install
Push-Location $ProjectPath
try {
    Write-Host ""
    Write-Host "Installing npm dependencies..."
    npm install

    # Copy config if missing
    $configPath = Join-Path $ProjectPath "config\config.json"
    $examplePath = Join-Path $ProjectPath "config\config.example.json"
    if (-not (Test-Path $configPath)) {
        if (-not (Test-Path $examplePath)) {
            throw "config/config.example.json not found."
        }
        Copy-Item $examplePath $configPath
        Write-Host ""
        Write-Host "Created config/config.json from example." -ForegroundColor Yellow
        Write-Host "IMPORTANT: Edit config/config.json with your credentials and paths before running."
    } else {
        Write-Host "config/config.json already exists."
    }

    Write-Host ""
    Write-Host "Building project..."
    npm run build

    # Optional Python ddddocr
    if (-not $SkipOcr) {
        $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCmd) {
            Write-Host ""
            Write-Host "Installing Python ddddocr (optional OCR fallback)..."
            python -m pip install ddddocr 2>$null
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Warning: pip install ddddocr failed. Node OCR will still work." -ForegroundColor Yellow
            }
        } else {
            Write-Host "Python not found — skipping ddddocr pip install (Node OCR still available)."
        }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Build complete." -ForegroundColor Green

if ($SkipDaemon) {
    Write-Host "Skipped daemon installation (-SkipDaemon)."
} else {
    Write-Host ""
    Write-Host "Installing login startup task (scheduler daemon)..."
    & "$PSScriptRoot\install-daemon.ps1" -ProjectPath $ProjectPath
}

Write-Host ""
Write-Host "=== Setup finished ===" -ForegroundColor Cyan
Write-Host "Next steps:"
Write-Host "  1. Edit config/config.json (login, git, qwen, schedule)"
Write-Host "  2. Test manually: npm start"
Write-Host "  3. Test scheduler:  npm run schedule"
Write-Host "  4. After logon, check logs/scheduler.log"
