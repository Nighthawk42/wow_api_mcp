<#
.SYNOPSIS
    Pulls, rebuilds, and health-checks a from-source install of wow-api-mcp.

.DESCRIPTION
    1. Fast-forwards the checkout from origin (skip with -SkipGit).
    2. Installs dependencies when package-lock.json changed or node_modules is missing, then builds dist/.
    3. Optionally runs the test suite (-RunTests).
    4. Starts the built server and performs a real MCP initialize handshake.
    5. Registration: if `mcpm` (a multi-agent MCP config manager) is on PATH, runs `mcpm sync`;
       otherwise prints the entry to add to your MCP client config.

    Agent config files are never edited directly by this script.

.EXAMPLE
    .\update.ps1
    .\update.ps1 -RunTests
    .\update.ps1 -SkipGit
#>

[CmdletBinding()]
param(
    [switch]$SkipGit,
    [switch]$SkipBuild,
    [switch]$RunTests
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DistIndex = Join-Path $Root 'dist\index.js'

function Step([string]$Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }

function Invoke-Native {
    # Native commands don't honor $ErrorActionPreference; fail on a non-zero exit.
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

if (-not $SkipGit) {
    Step 'Pulling latest code'
    $before = git -C $Root rev-parse HEAD
    Invoke-Native git @('-C', $Root, 'pull', '--ff-only')
    $after = git -C $Root rev-parse HEAD
    $lockChanged = $before -ne $after -and (git -C $Root diff --name-only $before $after -- package-lock.json)
} else {
    $lockChanged = $false
}

if (-not $SkipBuild) {
    if ($lockChanged -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
        Step 'Installing dependencies'
        Invoke-Native npm @('--prefix', $Root, 'ci')
    }
    Step 'Building'
    Invoke-Native npm @('--prefix', $Root, 'run', 'build')
    if ($RunTests) {
        Step 'Testing'
        Invoke-Native npm @('--prefix', $Root, 'test')
    }
}

if (-not (Test-Path $DistIndex)) { throw "dist/index.js not found at $DistIndex; the build did not produce it." }

Step 'Health check (MCP initialize)'
$psi = [System.Diagnostics.ProcessStartInfo]::new('node', "`"$DistIndex`"")
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
try {
    $init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"update.ps1","version":"0"}}}'
    $proc.StandardInput.WriteLine($init)
    $proc.StandardInput.Flush()
    $read = $proc.StandardOutput.ReadLineAsync()
    if (-not $read.Wait(15000)) { throw 'no response to initialize within 15s' }
    $reply = $read.Result | ConvertFrom-Json
    if (-not $reply.result.serverInfo) { throw "unexpected reply: $($read.Result)" }
    Write-Host "  ok: $($reply.result.serverInfo.name) $($reply.result.serverInfo.version)" -ForegroundColor Green
} finally {
    if (-not $proc.HasExited) { $proc.Kill() }
}

Step 'Registration'
if (Get-Command mcpm -ErrorAction SilentlyContinue) {
    Invoke-Native mcpm @('sync')
} else {
    $entry = @{ command = 'node'; args = @($DistIndex) } | ConvertTo-Json -Compress
    Write-Host "  Add this server entry (name: wow-api) to your MCP client config:" -ForegroundColor Yellow
    Write-Host "  $entry"
    Write-Host "  Claude Code: claude mcp add --scope user wow-api -- node `"$DistIndex`""
}
