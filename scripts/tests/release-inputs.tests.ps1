#Requires -Version 5.1
# Read-only checks of prepared release metadata; never an approval or release entrypoint.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../portable-package-safety.ps1')
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
function Read-InputJson([string]$Relative) { return (Get-PortableText (Read-PortableBytes (Join-Path $root $Relative))) | ConvertFrom-Json }
function Require($Value, [string]$Gate) { if (-not $Value) { throw ('Release input check failed: '+$Gate) } }
function Match-InputHash([string]$Relative, [string]$Expected) {
    Require ($Expected -cmatch '^[a-f0-9]{64}$' -and (Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $root $Relative))) -ceq $Expected) $Relative
}
$manifest=Read-InputJson 'release/notices/manifest.json'
$source=Read-InputJson 'release/notices/source.json'
$review=Read-InputJson 'release/notices/review.json'
$inventory=Read-InputJson 'release/notices/inventory.json'
$preparation=Read-InputJson 'release/notices/v0.4.0-preparation.json'
$package=Read-InputJson 'package.json'
$tauri=Read-InputJson 'src-tauri/tauri.conf.json'
$query="const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.version);console.log(p.packages[''].version);"
$npmVersions=@(& node -e $query (Join-Path $root 'package-lock.json'))
if ($LASTEXITCODE -ne 0) { throw 'npm lock read failed' }
Assert-PortableVersions $package.version $tauri.version ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/Cargo.toml'))) ([IO.File]::ReadAllText((Join-Path $root 'src-tauri/Cargo.lock'))) $npmVersions
foreach ($input in @($manifest,$source,$review,$inventory,$preparation)) { Require ($input.version -ceq $package.version) 'version' }
foreach ($pair in @(@('inventory','inventory_sha256'),@('review','review_sha256'),@('source','source_sha256'))) { Match-InputHash ('release/notices/'+$pair[0]+'.json') $manifest.($pair[1]) }
foreach ($input in @($manifest,$source)) {
    Match-InputHash 'src-tauri/Cargo.lock' $input.cargo_lock_sha256
    Match-InputHash 'package-lock.json' $input.npm_lock_sha256
}
Match-InputHash 'THIRD-PARTY-NOTICES.txt' $manifest.notices_sha256
Match-InputHash 'THIRD-PARTY-NOTICES.txt' $source.sha256
foreach ($evidence in $review.release_refresh.evidence) { Match-InputHash $evidence.path $evidence.sha256 }
Match-InputHash 'release/notices/mapping.json' $preparation.candidate_inputs.mapping_sha256
$fingerprint=@('rustc','cargo','node','npm','tauri_cli','powershell') | ForEach-Object { $_+'='+(@($preparation.candidate_toolchain.$_) -join "`n") }
Require ((Get-ReleaseSHA256 ([Text.Encoding]::UTF8.GetBytes(($fingerprint -join "`n")+"`n"))) -ceq $manifest.toolchain_sha256) 'candidate toolchain fingerprint'
Require ($manifest.toolchain_sha256 -ceq $preparation.candidate_toolchain_sha256) 'toolchain reference'
$checkpoint=$preparation.preparation_source_head
Require ($checkpoint -cmatch '^[a-f0-9]{40}$') 'historical checkpoint'
$priorReview=(@(& git -C $root show ($checkpoint+':release/notices/review.json')) -join "`n") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Historical review unavailable' }
$priorInventory=(@(& git -C $root show ($checkpoint+':release/notices/inventory.json')) -join "`n") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Historical inventory unavailable' }
Require (($priorReview.coverage | ConvertTo-Json -Depth 30 -Compress) -ceq ($review.coverage | ConvertTo-Json -Depth 30 -Compress)) 'historical coverage preservation'
Require (($priorReview.approval_basis | ConvertTo-Json -Depth 10 -Compress) -ceq ($review.approval_basis | ConvertTo-Json -Depth 10 -Compress)) 'historical approval preservation'
Require ($review.reviewer -ceq $priorReview.reviewer -and $review.reviewed_at -ceq $priorReview.reviewed_at) 'historical reviewer/date'
Require (($priorInventory.components | ConvertTo-Json -Depth 10 -Compress) -ceq ($inventory.components | ConvertTo-Json -Depth 10 -Compress)) 'historical component inventory'
Require ($manifest.source_head -ceq $preparation.historical_review_source_head -and $source.source_commit -ceq $preparation.historical_notice_source_commit) 'historical provenance'
$uniqueTexts=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
$references=0
foreach ($record in $review.coverage) {
    foreach ($text in $record.required_texts) { Match-InputHash $text.path $text.sha256; [void]$uniqueTexts.Add($text.path); $references++ }
}
Require ($uniqueTexts.Count -eq 148 -and $references -eq 357 -and $review.coverage.Count -eq 207) 'preserved original text coverage'
if ($manifest.status -ceq 'PREPARED') {
    Require ($review.status -ceq 'PREPARED' -and $source.formal_review_state -ceq 'PREPARED' -and $manifest.unresolved.Count -gt 0) 'pending decisions visible'
    $rejected=$false
    try { Assert-PortableNoticeAvailability $root } catch { $rejected=$true }
    Require $rejected 'pending formal gate rejects'
}
Write-Output ('Release input consistency PASS; version='+$package.version+'; original texts=148; references=357; status='+$manifest.status+'. No formal approval or Release run.')
