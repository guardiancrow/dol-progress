#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedSourceHead,
    [switch]$VerboseBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-safety.ps1')
$releaseExit = 1
$savedEnvironment = @{}
foreach ($name in @('CARGO_HOME','RUSTUP_HOME','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','CARGO_TARGET_DIR','TEMP','TMP','CARGO_NET_OFFLINE')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$locationPushed = $false
$manifestBytes = $null
$run = $null
$prefixes = [ordered]@{}
$inputs = $null
$failure = $null
$result = [ordered]@{ purpose='portable release compile validation'; classification='FAILED'; version='0.3.0'; target='x86_64-pc-windows-msvc'; build_command='npm run tauri -- build --no-bundle -- --locked --offline'; license_status='UNRESOLVED'; packaging='NOT_IMPLEMENTED'; acceptance='NOT_PERFORMED' }

function Invoke-ReleaseCapture([string]$Command, [string[]]$Arguments, [string]$Stage) {
    $savedPreference = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; $lines = @(& $Command @Arguments 2>$null); $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $savedPreference }
    Assert-ReleaseChildExit $code $Stage
    return $lines
}
try {
    if ($MyInvocation.InvocationName -eq '.') { throw 'Invocation: run as a script, not dot-source.' }
    Assert-ReleasePlatform ([Environment]::OSVersion.Platform) $env:PROCESSOR_ARCHITECTURE ([IntPtr]::Size) 'x86_64-pc-windows-msvc'
    foreach ($name in @('RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','CARGO_TARGET_DIR','CARGO_BUILD_TARGET')) {
        if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name, 'Process'))) { throw "Environment: $name is already set." }
    }
    foreach ($entry in (Get-ChildItem Env:)) {
        if ($entry.Name -match '^CARGO_TARGET_.*_(RUSTFLAGS|LINKER|RUNNER)$|^CARGO_PROFILE_|^CARGO_BUILD_RUSTFLAGS$|^TAURI_CONFIG$|^RUSTC$|^RUSTC(_WORKSPACE)?_WRAPPER$' -and -not [string]::IsNullOrEmpty($entry.Value)) { throw 'Environment: unsupported build override.' }
    }
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    Assert-ReleaseNoReparse $repoRoot
    Push-Location -LiteralPath $repoRoot
    $locationPushed = $true
    $gitRoot = @(Invoke-ReleaseCapture 'git' @('rev-parse','--show-toplevel') 'Git root')
    if ($gitRoot.Count -ne 1 -or [IO.Path]::GetFullPath($gitRoot[0]) -ine $repoRoot) { throw 'Source: incorrect repository root.' }
    $head = @(Invoke-ReleaseCapture 'git' @('rev-parse','HEAD') 'Git HEAD')
    $dirty = @(Invoke-ReleaseCapture 'git' @('diff','--name-only') 'Git dirty paths')
    $untracked = @(Invoke-ReleaseCapture 'git' @('ls-files','--others','--exclude-standard') 'Git untracked paths')
    $staged = @(Invoke-ReleaseCapture 'git' @('diff','--cached','--name-only') 'Git staged paths')
    Assert-ReleaseSource $head[0] $ExpectedSourceHead @($dirty + $untracked) $staged
    Invoke-ReleaseCapture 'git' @('verify-commit','HEAD') 'Git signature' | Out-Null
    $result['source_head'] = $head[0]
    $result['source_state'] = if (($dirty.Count + $untracked.Count) -eq 0) { 'CLEAN_SIGNED_CHECKPOINT' } else { 'UNCOMMITTED_COMPILE_TOOLING_ONLY' }
    $result['dirty_paths'] = @($dirty + $untracked)
    $files = @(Invoke-ReleaseCapture 'git' @('ls-files','--cached','--others','--exclude-standard') 'Git input inventory')
    $inputs = Get-ReleaseInputHashes $repoRoot $files
    $prefixes = Get-PrivacyPrefixes $repoRoot ''
    # Presence-only checks avoid reading private Cargo config/credentials or accepting target overrides.
    $configRoots = @($prefixes['CargoHome'])
    $ancestor = $repoRoot
    while ($ancestor) { $configRoots += Join-Path $ancestor '.cargo'; $ancestor = [IO.Path]::GetDirectoryName($ancestor) }
    foreach ($root in $configRoots) {
        foreach ($name in @('config','config.toml')) {
            if (Test-Path -LiteralPath (Join-Path $root $name)) { throw 'Environment: ambient Cargo config requires a separately reviewed build environment.' }
        }
    }
    $rustc = @(Invoke-ReleaseCapture 'rustc' @('-vV') 'rustc version')
    $hostLine = @($rustc | Where-Object { $_ -match '^host: ' })
    if ($hostLine.Count -ne 1) { throw 'Toolchain: host unavailable.' }
    Assert-ReleasePlatform ([Environment]::OSVersion.Platform) $env:PROCESSOR_ARCHITECTURE ([IntPtr]::Size) $hostLine[0].Substring(6)
    $cargoVersion = @(Invoke-ReleaseCapture 'cargo' @('--version') 'Cargo version')
    $nodeVersion = @(Invoke-ReleaseCapture 'node' @('--version') 'Node version')
    $npmVersion = @(Invoke-ReleaseCapture 'npm.cmd' @('--version') 'npm version')
    $cliPath = Join-Path $repoRoot 'node_modules\@tauri-apps\cli\tauri.js'
    $cliVersion = @(Invoke-ReleaseCapture 'node' @($cliPath,'--version') 'Tauri version')
    $cliHelp = @(Invoke-ReleaseCapture 'node' @($cliPath,'build','--help') 'Tauri build help')
    # Windows PowerShell 5.1 ConvertFrom-Json cannot represent npm's empty root package key.
    $lockQuery = "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package-lock.json','utf8'));console.log(JSON.stringify({version:p.packages[''].version,cliVersion:p.packages['node_modules/@tauri-apps/cli'].version}));"
    $lock = (Invoke-ReleaseCapture 'node' @('-e',$lockQuery) 'npm lock metadata') | ConvertFrom-Json
    $version = $cliVersion[0] -replace '^tauri-cli ', ''
    Assert-ReleaseCli $version $lock.cliVersion ($cliHelp -join [Environment]::NewLine)
    $package = [IO.File]::ReadAllText((Join-Path $repoRoot 'package.json')) | ConvertFrom-Json
    $tauri = [IO.File]::ReadAllText((Join-Path $repoRoot 'src-tauri\tauri.conf.json')) | ConvertFrom-Json
    $cargoText = [IO.File]::ReadAllText((Join-Path $repoRoot 'src-tauri\Cargo.toml'))
    if ($package.version -ne '0.3.0' -or $tauri.version -ne '0.3.0' -or $cargoText -notmatch '(?m)^version = "0\.3\.0"\r?$' -or $lock.version -ne '0.3.0') { throw 'Version: compile phase must remain 0.3.0.' }
    if ($tauri.bundle.active -ne $false -or $tauri.identifier -ne 'com.dolprogress.manager' -or $tauri.build.beforeBuildCommand -ne 'npm run build' -or $tauri.build.frontendDist -ne '../dist') { throw 'Configuration: expected portable build contract missing.' }
    if ($tauri.PSObject.Properties.Name -contains 'mainBinaryName') { throw 'Configuration: renamed executable unsupported.' }
    $result['toolchain'] = [ordered]@{ rustc=$rustc; cargo=$cargoVersion[0]; node=$nodeVersion[0]; npm=$npmVersion[0]; tauri_cli=$version; powershell=$PSVersionTable.PSVersion.ToString() }
    $result['input_hashes'] = $inputs
    $run = New-ReleaseRun $repoRoot $head[0]
    $result['run_id'] = $run.Id
    $prefixes['BuildRoot'] = $run.Path
    $prefixes['Target'] = $run.Target
    $prefixes['BuildTemp'] = $run.Temp
    $manifestPath = Join-Path $repoRoot 'src-tauri\Cargo.toml'
    $manifestBytes = [IO.File]::ReadAllBytes($manifestPath)
    $env:CARGO_HOME = $prefixes['CargoHome']
    $env:RUSTUP_HOME = $prefixes['RustupHome']
    $env:CARGO_TARGET_DIR = $run.Target
    $env:CARGO_NET_OFFLINE = 'true'
    $env:TEMP = $run.Temp
    $env:TMP = $run.Temp
    $tokens = @(Get-ReleaseRemapTokens $prefixes)
    $env:CARGO_ENCODED_RUSTFLAGS = $tokens -join [char]0x1f
    $result['remap_categories'] = @($prefixes.Keys)
    $result['encoded_flag_tokens'] = $tokens.Count
    $arguments = @('run','tauri','--','build','--no-bundle')
    if ($VerboseBuild) { $arguments += '-vv' }
    $arguments += @('--','--locked','--offline')
    if ($VerboseBuild) { $arguments += '--verbose' }
    Write-Output "Run=$($run.Id) Purpose=portable release compile validation Target=x86_64-pc-windows-msvc"
    $logPath = Join-Path $run.Logs 'compile.txt'
    $writer = New-Object IO.StreamWriter($logPath, $false, (New-Object Text.UTF8Encoding($false)))
    $savedPreference = $ErrorActionPreference
    $logState = @{ Failed=$false }
    try {
        # Windows PowerShell reports native stderr as ErrorRecords even on a successful compile.
        $ErrorActionPreference = 'Continue'
        # Only sanitized lines reach console or disk. A raw transcript is never retained.
        & npm.cmd @arguments 2>&1 | ForEach-Object {
            try { Write-ReleaseLogLine $writer ([string]$_) $prefixes }
            catch { $logState.Failed=$true }
        }
        $childExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference; $writer.Dispose() }
    Assert-ReleaseChildExit $childExit 'Tauri build'
    if ($logState.Failed) { throw 'Log: compile output recording failed.' }
    $exe = Join-Path $run.Target 'release\dol-progress-manager.exe'
    $result['executable'] = Assert-ReleaseOutput $run.Target $exe
    $privacy = Test-PrivacyArtifact $exe $prefixes 'application-exe'
    $result['privacy'] = $privacy
    foreach ($record in $privacy.counts) { Write-Output "Artifact=application-exe Category=$($record.category) Encoding=$($record.encoding) Count=$($record.count)" }
    Write-Output "DefiniteLeak=$($privacy.definite_leak) ReviewRequired=$($privacy.review_required) AllowedGeneric=$($privacy.allowed_generic_path)"
    Assert-ReleasePrivacy $privacy
    $logPrivacy = Test-PrivacyArtifact $logPath $prefixes 'compile-log'
    Assert-ReleasePrivacy $logPrivacy
    $result['log_privacy'] = $logPrivacy
    $releaseExit = 0
} catch {
    $failure = Protect-ReleaseText $_.Exception.Message $prefixes
    if ($_.Exception.Data.Contains('ExitCode')) { $releaseExit = [int]$_.Exception.Data['ExitCode'] } else { $releaseExit = 1 }
    [Console]::Error.WriteLine('Portable compile failed: ' + $failure)
} finally {
    if ($null -ne $manifestBytes) {
        try { $result['manifest_guard'] = Restore-ReleaseManifest $manifestPath $manifestBytes }
        catch { $failure = Protect-ReleaseText $_.Exception.Message $prefixes; $releaseExit=1; [Console]::Error.WriteLine('Manifest guard failed: ' + $failure) }
    }
    if ($null -ne $inputs) {
        try {
            $afterFiles = @(Invoke-ReleaseCapture 'git' @('ls-files','--cached','--others','--exclude-standard') 'Final input inventory')
            Assert-ReleaseInputHashes $inputs (Get-ReleaseInputHashes $repoRoot $afterFiles)
            $afterHead = @(Invoke-ReleaseCapture 'git' @('rev-parse','HEAD') 'Final HEAD')
            if ($afterHead[0] -cne $ExpectedSourceHead) { throw 'Source: HEAD changed during build.' }
            $result['source_bytes_preserved'] = $true
        } catch { $failure = Protect-ReleaseText $_.Exception.Message $prefixes; $releaseExit=1; [Console]::Error.WriteLine('Source guard failed: ' + $failure) }
    }
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    if ($locationPushed) { Pop-Location }
}
if ($null -ne $run) {
    try {
        Assert-ReleaseNoReparse $run.Path
        if ($releaseExit -eq 0) {
            $outputExe = Join-Path $run.Output 'dol-progress-manager.exe'
            Assert-ReleaseContained $run.Path $outputExe
            [IO.File]::Copy($exe, $outputExe, $false)
            if ((Get-ReleasePe $outputExe).sha256 -cne $result['executable'].sha256) { throw 'Artifact: output copy hash mismatch.' }
            Assert-ReleasePrivacy (Test-PrivacyArtifact $outputExe $prefixes 'output-exe')
            $result['classification'] = 'COMPILE_VALIDATED'
            $result['output'] = 'output/dol-progress-manager.exe'
        }
        $result['exit_code'] = $releaseExit
        if ($null -ne $failure) { $result['failure'] = $failure }
        Write-ReleaseNewText (Join-Path $run.Path 'result.json') (($result | ConvertTo-Json -Depth 12) + [Environment]::NewLine)
        Write-Output "Run=$($run.Id) Classification=$($result['classification']) Exit=$releaseExit"
        if ($releaseExit -eq 0) { Write-Output "EXE=dol-progress-manager.exe SHA256=$($result['executable'].sha256) Privacy=PASS (compile validation only)" }
    } catch { $releaseExit=1; [Console]::Error.WriteLine('Result handling failed: ' + (Protect-ReleaseText $_.Exception.Message $prefixes)) }
}
exit $releaseExit
