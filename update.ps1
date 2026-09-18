<#
.SYNOPSIS
    Updates the wow_api_mcp repository, rebuilds the project, and registers/updates
    the MCP server across all AI assistant agent configurations (Antigravity, Claude, Codex, Oh My Pi, Pi, Cline).

.DESCRIPTION
    1. Pulls the latest commits from git (origin/main).
    2. Installs dependencies (if needed) and compiles TypeScript to dist/.
    3. Runs tests (optional, using -RunTests).
    4. Updates MCP configurations for:
       - Antigravity / Gemini CLI (~/.gemini/config/mcp_config.json & ~/.gemini/antigravity/mcp_config.json)
       - Claude Code (~/.claude.json)
       - Codex (~/.codex/config.toml)
       - Oh My Pi (~/.omp/agent/mcp.json)
       - Pi (~/.pi/agent/mcp.json)
       - Cline / Roo-Code (~/.cline/data/settings/cline_mcp_settings.json)

.PARAMETER SkipGit
    Skip running git pull.

.PARAMETER SkipBuild
    Skip running npm run build.

.PARAMETER RunTests
    Run test suite (npm test) after building.

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
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ScriptDir) { $ScriptDir = (Get-Location).Path }

Write-Host '==================================================' -ForegroundColor Cyan
Write-Host '  World of Warcraft API MCP Server - Updater' -ForegroundColor Cyan
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host "Project Directory: $ScriptDir" -ForegroundColor Gray

# 1. Git Pull
if (-not $SkipGit) {
    Write-Host "`n[1/4] Pulling latest code from Git..." -ForegroundColor Yellow
    try {
        $gitOutput = git -C $ScriptDir pull --ff-only 2>&1
        Write-Host "Git: $gitOutput" -ForegroundColor Gray
    } catch {
        Write-Host 'Git pull fast-forward failed, running standard git pull...' -ForegroundColor Yellow
        $gitOutput = git -C $ScriptDir pull 2>&1
        Write-Host "Git: $gitOutput" -ForegroundColor Gray
    }
} else {
    Write-Host "`n[1/4] Skipping Git pull (-SkipGit specified)" -ForegroundColor DarkGray
}

# 2. Build Project
if (-not $SkipBuild) {
    Write-Host "`n[2/4] Building MCP Server (TypeScript -> dist)..." -ForegroundColor Yellow
    if (-not (Test-Path "$ScriptDir\node_modules")) {
        Write-Host 'Installing npm dependencies...' -ForegroundColor Gray
        npm --prefix $ScriptDir install
    }
    
    npm --prefix $ScriptDir run build
    Write-Host "Build complete: $ScriptDir\dist\index.js" -ForegroundColor Green
    
    if ($RunTests) {
        Write-Host 'Running tests...' -ForegroundColor Yellow
        npm --prefix $ScriptDir test
    }
} else {
    Write-Host "`n[2/4] Skipping build (-SkipBuild specified)" -ForegroundColor DarkGray
}

# 3. Verify dist/index.js exists
$DistIndex = Join-Path $ScriptDir 'dist\index.js'
if (-not (Test-Path $DistIndex)) {
    Write-Error "dist/index.js not found at $DistIndex! Build may have failed."
    exit 1
}

# 4. Update Agent MCP Configurations
Write-Host "`n[3/4] Updating MCP configuration for AI Assistant Agents..." -ForegroundColor Yellow

$UserHome = $env:USERPROFILE
$NodePath = 'node'

# Helper to update JSON MCP config files
function Update-JsonMcpConfig {
    param(
        [string]$FilePath,
        [string]$ServerName = 'wow-api',
        [hashtable]$ServerEntry,
        [string]$AgentName
    )

    try {
        $dir = Split-Path -Parent $FilePath
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }

        $jsonObj = $null
        if (Test-Path $FilePath) {
            $raw = Get-Content -Path $FilePath -Raw -Encoding UTF8
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $jsonObj = $raw | ConvertFrom-Json
            }
        }

        if ($null -eq $jsonObj) {
            $jsonObj = [PSCustomObject]@{}
        }

        # Ensure mcpServers property exists
        if (-not (Get-Member -InputObject $jsonObj -Name 'mcpServers')) {
            $jsonObj | Add-Member -MemberType NoteProperty -Name 'mcpServers' -Value ([PSCustomObject]@{}) -Force
        }

        # Convert ServerEntry hashtable to PSCustomObject
        $entryObject = [PSCustomObject]$ServerEntry

        # Add or replace server
        $jsonObj.mcpServers | Add-Member -MemberType NoteProperty -Name $ServerName -Value $entryObject -Force

        $updatedJson = $jsonObj | ConvertTo-Json -Depth 20
        [System.IO.File]::WriteAllText($FilePath, $updatedJson, [System.Text.Encoding]::UTF8)
        Write-Host "  [+] $AgentName" -ForegroundColor Green
    } catch {
        Write-Host "  [!] Failed to update $AgentName ($FilePath): $_" -ForegroundColor Red
    }
}

# Helper to update TOML MCP config (Codex)
function Update-CodexTomlConfig {
    param(
        [string]$FilePath,
        [string]$DistPath
    )

    try {
        if (-not (Test-Path $FilePath)) {
            Write-Host "  [-] Codex config not found at $FilePath" -ForegroundColor DarkGray
            return
        }

        $content = Get-Content -Path $FilePath -Raw -Encoding UTF8
        $escapedDist = $DistPath.Replace('\', '\\')
        $newBlock = "[mcp_servers.wow-api]`r`ncommand = `"node`"`r`nargs = [`"$escapedDist`"]"

        if ($content -match '\[mcp_servers\.wow-api\][\s\S]*?(?=\r?\n\[|\z)') {
            $content = $content -replace '\[mcp_servers\.wow-api\][\s\S]*?(?=\r?\n\[|\z)', $newBlock
        } elseif ($content -match '\[mcp_servers\."wow-api"\][\s\S]*?(?=\r?\n\[|\z)') {
            $content = $content -replace '\[mcp_servers\."wow-api"\][\s\S]*?(?=\r?\n\[|\z)', $newBlock
        } else {
            if ($content -match '(?<=\[mcp_servers\.[^\]]+\][\s\S]*?\r?\n)(?=\[|\z)') {
                $content = $content -replace '(?<=\[mcp_servers\.[^\]]+\][\s\S]*?\r?\n)(?=\[|\z)', "`r`n$newBlock`r`n"
            } else {
                $content = $content.TrimEnd() + "`r`n`r`n" + $newBlock + "`r`n"
            }
        }

        [System.IO.File]::WriteAllText($FilePath, $content, [System.Text.Encoding]::UTF8)
        Write-Host '  [+] Codex (~/.codex/config.toml)' -ForegroundColor Green
    } catch {
        Write-Host "  [!] Failed to update Codex config: $_" -ForegroundColor Red
    }
}

# A. Antigravity / Gemini CLI
$stdEntry = @{
    command = $NodePath
    args = @($DistIndex)
}

Update-JsonMcpConfig -FilePath "$UserHome\.gemini\config\mcp_config.json" -ServerEntry $stdEntry -AgentName 'Antigravity / Gemini (config/mcp_config.json)'
Update-JsonMcpConfig -FilePath "$UserHome\.gemini\antigravity\mcp_config.json" -ServerEntry $stdEntry -AgentName 'Antigravity (antigravity/mcp_config.json)'

# B. Claude Code
$claudeEntry = @{
    type = 'stdio'
    command = $NodePath
    args = @($DistIndex)
    env = @{}
}
Update-JsonMcpConfig -FilePath "$UserHome\.claude.json" -ServerEntry $claudeEntry -AgentName 'Claude Code (~/.claude.json)'

# C. Codex
Update-CodexTomlConfig -FilePath "$UserHome\.codex\config.toml" -DistPath $DistIndex

# D. Oh My Pi (omp)
Update-JsonMcpConfig -FilePath "$UserHome\.omp\agent\mcp.json" -ServerEntry $stdEntry -AgentName 'Oh My Pi (~/.omp/agent/mcp.json)'

# E. Pi
Update-JsonMcpConfig -FilePath "$UserHome\.pi\agent\mcp.json" -ServerEntry $stdEntry -AgentName 'Pi (~/.pi/agent/mcp.json)'

# F. Cline / Roo-Code (if present)
if (Test-Path "$UserHome\.cline\data\settings") {
    Update-JsonMcpConfig -FilePath "$UserHome\.cline\data\settings\cline_mcp_settings.json" -ServerEntry $stdEntry -AgentName 'Cline (~/.cline/...)'
}

# 5. Quick Health Check
Write-Host "`n[4/4] Verifying MCP server startup..." -ForegroundColor Yellow
try {
    $procInfo = New-Object System.Diagnostics.ProcessStartInfo
    $procInfo.FileName = 'node'
    $procInfo.Arguments = "`"$DistIndex`""
    $procInfo.RedirectStandardInput = $true
    $procInfo.RedirectStandardOutput = $true
    $procInfo.RedirectStandardError = $true
    $procInfo.UseShellExecute = $false
    $procInfo.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($procInfo)
    Start-Sleep -Milliseconds 600
    
    $proc.StandardInput.Close()
    $errOutput = $proc.StandardError.ReadToEnd()
    if (-not $proc.HasExited) {
        $proc.Kill()
    }

    if ($errOutput -match 'wow-api-mcp: serving on stdio') {
        Write-Host '  [+] Server self-check passed: wow-api-mcp: serving on stdio' -ForegroundColor Green
    } else {
        Write-Host "  [?] Server started with output: $errOutput" -ForegroundColor Gray
    }
} catch {
    Write-Host "  [!] Health check warning: $_" -ForegroundColor Yellow
}

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host '  Update and Registration Complete!' -ForegroundColor Green
Write-Host '  Configured Agents:' -ForegroundColor Cyan
Write-Host '   - Antigravity / Gemini' -ForegroundColor White
Write-Host '   - Claude Code' -ForegroundColor White
Write-Host '   - Codex' -ForegroundColor White
Write-Host '   - Oh My Pi (omp)' -ForegroundColor White
Write-Host '   - Pi' -ForegroundColor White
Write-Host "  Target Path: $DistIndex" -ForegroundColor Gray
Write-Host '==================================================' -ForegroundColor Cyan
