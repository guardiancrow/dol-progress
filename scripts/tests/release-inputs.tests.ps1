#Requires -Version 5.1
# Inspect real REVIEWED metadata locally; this is not a signed-source Release run.
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
# Hash the actual tracked and pending source inputs. This does not certify a clean/signed HEAD.
$files=@(Get-PortableGit $root @('ls-files','--cached','--others','--exclude-standard'))
$hashes=Get-ReleaseInputHashes $root $files
$notices=Read-PortableNotices $root $package.version $hashes
if ((Get-ReleaseSHA256 $notices) -cne $hashes['THIRD-PARTY-NOTICES.txt']) { throw 'Formal notice reader returned different bytes' }
Write-Output 'REVIEWED notice reader PASS; actual bytes and approval evidence verified. Signed clean source and formal Release stages NOT assessed.'
