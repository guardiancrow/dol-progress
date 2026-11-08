#Requires -Version 5.1
# Candidate inspection is separate from the formal REVIEWED gate.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../portable-package-safety.ps1')
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
& node (Join-Path $root 'scripts/release-input-audit.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Release input inspection failed' }
$package=Get-PortableText (Read-PortableBytes (Join-Path $root 'package.json')) | ConvertFrom-Json
$tauri=Get-PortableText (Read-PortableBytes (Join-Path $root 'src-tauri/tauri.conf.json')) | ConvertFrom-Json
$query="const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.version);console.log(p.packages[''].version);"
$npmVersions=@(& node -e $query (Join-Path $root 'package-lock.json'))
if ($LASTEXITCODE -ne 0) { throw 'npm lock read failed' }
Assert-PortableVersions $package.version $tauri.version ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/Cargo.toml'))) ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/Cargo.lock'))) $npmVersions
$rejected=$false
try { Assert-PortableNoticeAvailability $root } catch { $rejected=$_.Exception.Message -ceq 'Notices: user review pending.' }
if (-not $rejected) { throw 'Expected PREPARED formal gate rejection missing' }
Write-Output 'Release input consistency PASS; PREPARED formal gate rejected. No formal approval or Release run.'
