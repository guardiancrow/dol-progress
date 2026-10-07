#Requires -Version 5.1
[CmdletBinding()]
param([switch]$VerboseBuild)

$ErrorActionPreference = 'Stop'
$releaseExit = 1
$savedEnvironment = @{}
foreach ($name in @('CARGO_HOME','RUSTUP_HOME','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','CARGO_TARGET_DIR')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$locationPushed = $false
$manifestBytes = $null

function Get-ReleaseDirectory([string]$value, [string]$category) {
    if ([string]::IsNullOrWhiteSpace($value)) { throw "$category could not be resolved." }
    $full = if ([IO.Path]::IsPathRooted($value)) { [IO.Path]::GetFullPath($value) } else { [IO.Path]::GetFullPath((Join-Path $repoRoot $value)) }
    # rustc matches text; do not silently alter an explicitly absolute spelling.
    if ([IO.Path]::IsPathRooted($value) -and $value -cne $full) {
        throw "$category must use a full Windows path without slash or dot-segment normalization."
    }
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "$category directory does not exist: $full" }
    return $full
}
function Get-ReleaseSHA256([byte[]]$bytes) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '') }
    finally { $hash.Dispose() }
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows release build only.' }
    foreach ($name in @('RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','CARGO_TARGET_DIR')) {
        if (-not [string]::IsNullOrEmpty($savedEnvironment[$name])) { throw "$name is already set; refusing to overwrite or merge it." }
    }
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    Push-Location -LiteralPath $repoRoot
    $locationPushed = $true
    $cargoPath = $savedEnvironment['CARGO_HOME']
    if ([string]::IsNullOrEmpty($cargoPath)) {
        $profilePath = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')
        if ([string]::IsNullOrEmpty($profilePath)) { $profilePath = [Environment]::GetFolderPath('UserProfile') }
        if ([string]::IsNullOrEmpty($profilePath)) { throw 'Cargo default user profile could not be resolved.' }
        $cargoPath = Join-Path $profilePath '.cargo'
    }
    $cargoPath = Get-ReleaseDirectory $cargoPath 'CARGO_HOME'
    $rustupPath = $savedEnvironment['RUSTUP_HOME']
    if ([string]::IsNullOrEmpty($rustupPath)) {
        $homeOutput = @(& rustup show home)
        if ($LASTEXITCODE -ne 0 -or $homeOutput.Count -ne 1) { throw 'rustup show home failed to resolve RUSTUP_HOME.' }
        $rustupPath = $homeOutput[0]
    }
    $rustupPath = Get-ReleaseDirectory $rustupPath 'RUSTUP_HOME'
    $targetPath = Join-Path $repoRoot 'tmp\release-build\target'
    & git check-ignore --quiet -- $targetPath
    if ($LASTEXITCODE -ne 0) { throw 'Release target directory must be ignored by Git.' }
    $manifestPath = Join-Path $repoRoot 'src-tauri\Cargo.toml'
    $manifestBytes = [IO.File]::ReadAllBytes($manifestPath)
    $manifestSHA = Get-ReleaseSHA256 $manifestBytes
    Write-Output "Cargo.toml before SHA256=$manifestSHA"
    $env:CARGO_HOME = $cargoPath
    $env:RUSTUP_HOME = $rustupPath
    $tokens = @('--remap-path-prefix',($cargoPath + '=/cargo'),'--remap-path-prefix',($rustupPath + '=/rustup'))
    $env:CARGO_ENCODED_RUSTFLAGS = $tokens -join [char]0x1f
    $env:CARGO_TARGET_DIR = $targetPath
    Write-Output "CARGO_HOME=$cargoPath; RUSTUP_HOME=$rustupPath"
    Write-Output "CARGO_TARGET_DIR=$targetPath; encoded rustflags: 4 tokens, U+001F"
    $arguments = @('run','tauri','--','build','--bundles','nsis','msi')
    if ($VerboseBuild) { $arguments += '-vv' }
    $arguments += @('--','--locked','--offline')
    if ($VerboseBuild) { $arguments += '--verbose' }
    & npm.cmd @arguments
    $releaseExit = $LASTEXITCODE
    Write-Output "Tauri build exit=$releaseExit"
} catch {
    [Console]::Error.WriteLine("Release build failed: " + $_.Exception.Message)
    $releaseExit = 1
} finally {
    if ($null -ne $manifestBytes) {
        try {
            $afterBytes = [IO.File]::ReadAllBytes($manifestPath)
            $afterSHA = Get-ReleaseSHA256 $afterBytes
            Write-Output "Cargo.toml after-build SHA256=$afterSHA"
            if ($afterSHA -ne $manifestSHA) {
                $utf8 = New-Object Text.UTF8Encoding($false, $true)
                $beforeText = $utf8.GetString($manifestBytes).Replace("`r`n", "`n")
                $afterText = $utf8.GetString($afterBytes).Replace("`r`n", "`n")
                if ($beforeText -cne $afterText) { throw 'Cargo.toml content changed; leaving it untouched for review.' }
                Write-Output 'Cargo.toml normalized text equal; restoring EOL-only change.'
                [IO.File]::WriteAllBytes($manifestPath, $manifestBytes)
            } else { Write-Output 'Cargo.toml bytes unchanged; no restoration needed.' }
            $restoredSHA = Get-ReleaseSHA256 ([IO.File]::ReadAllBytes($manifestPath))
            Write-Output "Cargo.toml final SHA256=$restoredSHA"
            if ($restoredSHA -ne $manifestSHA) { throw 'Cargo.toml original bytes were not preserved.' }
        } catch {
            [Console]::Error.WriteLine("Cargo.toml guard failed: " + $_.Exception.Message)
            $releaseExit = 1
        }
    }
    foreach ($name in $savedEnvironment.Keys) {
        if ($null -eq $savedEnvironment[$name]) {
            Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
        }
    }
    if ($locationPushed) { Pop-Location }
}
exit $releaseExit
