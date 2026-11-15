#Requires -Version 5.1
# Read-only input validation; a signed fixture is not a formal Release run.
param([string]$ExpectedSourceHead='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../portable-package-safety.ps1')
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$package=Get-PortableText (Read-PortableBytes (Join-Path $root 'package.json')) | ConvertFrom-Json
if ($package.version -ceq '0.5.0') {
    & node (Join-Path $root 'scripts/release-input-audit.mjs') --version 0.5.0 --reviewed-inputs
} else {
    & node (Join-Path $root 'scripts/release-input-audit.mjs')
}
if ($LASTEXITCODE -ne 0) { throw 'Release input inspection failed' }
$tauri=Get-PortableText (Read-PortableBytes (Join-Path $root 'src-tauri/tauri.conf.json')) | ConvertFrom-Json
$query="const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.version);console.log(p.packages[''].version);"
$npmVersions=@(& node -e $query (Join-Path $root 'package-lock.json'))
if ($LASTEXITCODE -ne 0) { throw 'npm lock read failed' }
Assert-PortableVersions $package.version $tauri.version ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/Cargo.toml'))) ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/Cargo.lock'))) $npmVersions
# Hash the actual tracked and pending source inputs. This does not certify a clean/signed HEAD.
$files=@(Get-PortableGit $root @('ls-files','--cached','--others','--exclude-standard'))
$hashes=Get-ReleaseInputHashes $root $files
if ($package.version -ceq '0.5.0') {
    if ($ExpectedSourceHead -cmatch '^[a-f0-9]{40}$') {
        $notices=Read-PortableNotices $root $package.version $hashes $ExpectedSourceHead
        if ((Get-ReleaseSHA256 $notices) -cne $hashes['THIRD-PARTY-NOTICES.txt']) { throw 'Formal notice reader returned different bytes' }
        Write-Output 'Registered input and code approval PASS on signed clean source; Release stages NOT executed.'
        exit 0
    }
    $rejected=$false
    try { Read-PortableNotices $root $package.version $hashes | Out-Null }
    catch {
        if ($_.Exception.Message -cne 'Notices: expected signed source required.') { throw }
        $rejected=$true
    }
    if (-not $rejected) { throw 'Missing expected source passed formal reader' }
    # Caller labels cannot replace a signed clean source and an explicit expected HEAD.
    $rejected=$false
    try { Assert-PortableOwnerApproval $root '0.5.0' ([pscustomobject]@{status='REVIEWED'}) $hashes }
    catch {
        if ($_.Exception.Message -cne 'Notices: expected signed source required.') { throw }
        $rejected=$true
    }
    if (-not $rejected) { throw 'Fabricated approval passed formal reader' }
    Write-Output 'REVIEWED inputs and code registration PASS; formal reader rejects a missing expected signed source.'
    exit 0
}
$notices=Read-PortableNotices $root $package.version $hashes
if ((Get-ReleaseSHA256 $notices) -cne $hashes['THIRD-PARTY-NOTICES.txt']) { throw 'Formal notice reader returned different bytes' }
Write-Output 'REVIEWED notice reader PASS; actual bytes and approval evidence verified. Signed clean source and formal Release stages NOT assessed.'
