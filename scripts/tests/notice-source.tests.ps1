#Requires -Version 5.1
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../third-party-notices.ps1')
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot=Join-Path $repo ('tmp/phase-23d-c1c-c1/tests/'+[Guid]::NewGuid().ToString('N'))
Assert-ReleaseContained $repo $testRoot; Assert-ReleaseNoReparse $testRoot
New-Item -ItemType Directory -Path $testRoot | Out-Null
$passed=0; $failed=0; $counter=0
function Expect($Value) { if (-not $Value) { throw 'Source assertion failed.' } }
function Reject([scriptblock]$Action) { $rejected=$false; try { & $Action | Out-Null } catch { $rejected=$true }; Expect $rejected }
function Case([string]$Name,[scriptblock]$Action) {
    try { & $Action; $script:passed++; Write-Output "PASS $Name" }
    catch { $script:failed++; Write-Output ("FAIL $Name : "+(Protect-ReleaseText $_.Exception.Message ([ordered]@{Tests=$testRoot;Repository=$repo;User=$env:USERPROFILE}))) }
}
function New-Output { $script:counter++; return Join-Path $testRoot ('out-'+$script:counter) }
function Save([string]$File,$Value) { [IO.File]::WriteAllText($File,(($Value | ConvertTo-Json -Depth 60)+"`n"),(New-Object Text.UTF8Encoding($false))) }
function Save-Fixture($f) {
    Save (Join-Path $f.Root 'inventory.json') $f.Inventory
    Save (Join-Path $f.Root 'provenance.json') $f.Source
    $f.Manifest.inventory_sha256=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $f.Root 'inventory.json'))
    $f.Manifest.provenance_sha256=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $f.Root 'provenance.json'))
    Save $f.ManifestPath $f.Manifest
}
function New-Fixture {
    $root=Join-Path (New-Output) 'notice-source'; New-Item -ItemType Directory -Path (Join-Path $root 'texts') | Out-Null
    $texts=@(); $records=@(); $assets=@(); $components=@(); $owners=@()
    for ($i=0;$i -lt 2;$i++) {
        $raw=[Text.Encoding]::UTF8.GetBytes("TEST_ONLY permission $i`r`nCopyright TEST_ONLY Fictional Owner`r`n")
        $hash=Get-ReleaseSHA256 $raw; $file='texts/'+$hash+'.txt'; $label='TEST_ONLY-origin-'+$i; $id='TEST_ONLY-'+$i
        Write-PortableBytes $root (Join-Path $root $file) $raw
        $origin=[pscustomobject]@{source=$label;version='1.0.0'}
        $ref=[pscustomobject]@{sha256=$hash;raw_file=$file;source=$label;version='1.0.0'}
        $texts+=[pscustomobject]@{sha256=$hash;file=$file;bytes=$raw.Length;origins=@($origin)}
        $owners+=[pscustomobject]@{sha256=$hash;file=$file;sources=@($label)}
        $r=[pscustomobject]@{component_id=$id;name=$id;version='1.0.0';group='rust';notice_candidate=$true;inclusion_classification='INCLUDED_LIKELY';declared_license='TEST_ONLY_A AND TEST_ONLY_B WITH TEST_ONLY_EXCEPTION';license_selection=[pscustomobject]@{status='PROPOSED_NOT_APPROVED';expression='TEST_ONLY_A AND TEST_ONLY_B WITH TEST_ONLY_EXCEPTION';basis='TEST_ONLY preservation'};text_evidence=@($ref);copyright=[pscustomobject]@{notices=@([pscustomobject]@{text='Copyright TEST_ONLY Fictional Owner';source=$label;sha256=$hash})};NOTICE=[pscustomobject]@{texts=@($ref)};source_provision=[pscustomobject]@{state='INCOMPLETE';url=$null};unresolved_obligations=@('A07','A12');obligations_completed=$false;provenance_completed=$false}
        $records+=$r
        $components+=[pscustomobject]@{component_id=$id;name=$id;version='1.0.0';inclusion=$r.inclusion_classification;declared_license=$r.declared_license;notice_candidate=$true;provenance_completed=$false;text_sha256=@($hash);unresolved_obligations=@('A07','A12')}
        $assets+=[pscustomobject]@{asset_id=$id;file=$file;roles=@('LICENSE_TEXT','COPYRIGHT_SOURCE');category='A';disposition='INCLUDE';rights_basis='TEST_ONLY synthetic permission';license_identifier='TEST_ONLY';original_sha256=$hash;curated_sha256=$hash;curated_bytes=$raw.Length;transformation='NONE';component_ids=@($id);component_versions=@([pscustomobject]@{id=$id;name=$id;version='1.0.0';declared_license=$r.declared_license});origins=@([pscustomobject]@{source_label=$label;version='1.0.0';official_url='https://example.invalid/TEST_ONLY';original_sha256=$hash;confidence='TEST_ONLY'})}
    }
    $inventory=[pscustomobject]@{status='DRAFT';version='0.3.0';source_head=('a'*40);records=$records;texts=$texts;copyright_source_files=$owners}
    Write-ReleaseNewText (Join-Path $root 'review.json') '{"records":[]}'
    $source=[pscustomobject]@{schema=1;kind='VERSIONED_NOTICE_SOURCE';status='DRAFT';version='0.3.0';formal_clearance=$false;license_clearance='UNRESOLVED';public_release='NO_GO';coverage=[pscustomobject]@{records=2;candidates=2;raw_texts=2;copyright_source_files=2};assets=$assets;components=$components;references=@()}
    $manifest=[pscustomobject]@{schema=1;kind='NOTICE_ASSEMBLY_DRAFT';source_mode='VERSIONED_CURATED';status='DRAFT';version='0.3.0';source_head=('a'*40);target='x86_64-pc-windows-msvc';inventory_file='inventory.json';inventory_sha256='';copyright_review_file='review.json';copyright_review_sha256=(Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $root 'review.json')));provenance_file='provenance.json';provenance_sha256='';expected_records=2;expected_candidates=2;expected_texts=2;bundle_reference='release/notice-source/manifest.json';component_contracts=@($records | ForEach-Object {[pscustomobject](Get-NoticeContract $_)})}
    $manifest=($manifest | ConvertTo-Json -Depth 60) | ConvertFrom-Json
    $f=[pscustomobject]@{Root=$root;Inventory=$inventory;Source=$source;Manifest=$manifest;ManifestPath=(Join-Path $root 'manifest.json')}; Save-Fixture $f; return $f
}
function Assemble($f) { return Invoke-NoticeDraftAssembly $repo $f.ManifestPath (New-Output) }
Case 'Original CRLF bytes stay distinct from normalized output' { $f=New-Fixture; $r=Assemble $f; Expect ($r.coverage.candidates -eq 2 -and $f.Source.assets[0].original_sha256 -ceq $f.Source.assets[0].curated_sha256 -and $r.formal_clearance -eq $false) }
Case 'Source manifest duplicate asset IDs rejected' { $f=New-Fixture; $f.Source.assets[1].asset_id=$f.Source.assets[0].asset_id; Save-Fixture $f; Reject { Assemble $f } }
Case 'Duplicate provenance component IDs rejected' { $f=New-Fixture; $f.Source.components[1].component_id=$f.Source.components[0].component_id; Save-Fixture $f; Reject { Assemble $f } }
Case 'Source component version cannot drift from inventory' { $f=New-Fixture; $f.Source.assets[0].component_versions[0].version='2.0.0'; Save-Fixture $f; Reject { Assemble $f } }
Case 'Curated SHA mismatch rejected despite repinned manifest' { $f=New-Fixture; $f.Source.assets[0].curated_sha256='0'*64; Save-Fixture $f; Reject { Assemble $f } }
Case 'Original hash cannot be silently substituted' { $f=New-Fixture; $f.Source.assets[0].original_sha256='0'*64; Save-Fixture $f; Reject { Assemble $f } }
Case 'Undeclared transformations rejected' { $f=New-Fixture; $f.Source.assets[0].transformation='NORMALIZE_OR_REPLACE'; Save-Fixture $f; Reject { Assemble $f } }
Case 'Missing source fails before output and has no ignored fallback' { $f=New-Fixture; $file=Join-Path $f.Root $f.Source.assets[0].file; $fallback=Join-Path $testRoot 'unrelated-ignored-copy.txt'; Copy-Item -LiteralPath $file -Destination $fallback; [IO.File]::Move($file,$file+'.missing'); $out=New-Output; Reject { Invoke-NoticeDraftAssembly $repo $f.ManifestPath $out }; Expect (-not (Test-Path -LiteralPath $out)) }
Case 'Unsupported required source is explicitly INCOMPLETE' { $f=New-Fixture; $f.Source.assets[0].category='D'; $f.Source.assets[0].disposition='DEFERRED'; Save-Fixture $f; $incomplete=$false; try { Assemble $f | Out-Null } catch { $incomplete=$_.Exception.Message.StartsWith('INCOMPLETE:') }; Expect $incomplete }
Case 'Reference-only contract cannot become a copied input' { $f=New-Fixture; $f.Source.references=@([pscustomobject]@{reference_id='TEST_ONLY-ref';category='C';curated_file='contract.txt';reason='TEST_ONLY reference only'}); Save-Fixture $f; Reject { Assemble $f } }
Case 'Missing rights basis is never treated as permission' { $f=New-Fixture; $f.Source.assets[0].rights_basis=''; Save-Fixture $f; Reject { Assemble $f } }
Case 'AND WITH expression preserved and unauthorized OR change rejected' { $f=New-Fixture; $f.Source.assets[0].component_versions[0].declared_license='TEST_ONLY_A OR TEST_ONLY_B'; Save-Fixture $f; Reject { Assemble $f } }
Case 'Copyright asset source mapping required' { $f=New-Fixture; $f.Source.assets[0].roles=@('LICENSE_TEXT'); Save-Fixture $f; Reject { Assemble $f } }
Case 'NOTICE mapping cannot be removed from pinned inventory' { $f=New-Fixture; $f.Inventory.records[0].NOTICE.texts=@(); Save-Fixture $f; Reject { Assemble $f } }
Case 'No false provenance completion' { $f=New-Fixture; $f.Source.components[0].provenance_completed=$true; Save-Fixture $f; Reject { Assemble $f } }
Case 'Unresolved review state must match inventory' { $f=New-Fixture; $f.Source.components[0].unresolved_obligations=@(); Save-Fixture $f; Reject { Assemble $f } }
Case 'No formal clearance from source curation' { $f=New-Fixture; $f.Source.formal_clearance=$true; Save-Fixture $f; Reject { Assemble $f } }
Case 'Provenance traversal rejected' { $f=New-Fixture; $f.Manifest.provenance_file='../outside.json'; Save-Fixture $f; Reject { Assemble $f } }
Case 'Absolute private source labels rejected' { $f=New-Fixture; $f.Source.assets[0].origins[0].source_label='C:/TEST_ONLY-private/user-data'; Save-Fixture $f; Reject { Assemble $f } }
Case 'Credential-bearing source URLs rejected' { $f=New-Fixture; $f.Source.assets[0].origins[0].official_url='https://TEST_ONLY:TEST_ONLY@example.invalid/source'; Save-Fixture $f; Reject { Assemble $f } }
Case 'Versioned folder cannot drop its source guard' { $f=New-Fixture; $f.Manifest.PSObject.Properties.Remove('source_mode'); Save-Fixture $f; Reject { Assemble $f } }
Case 'Component provenance text hashes stay bound to inventory' { $f=New-Fixture; $f.Source.components[0].text_sha256=@('0'*64); Save-Fixture $f; Reject { Assemble $f } }
Case 'Declared copyright coverage cannot omit sources' { $f=New-Fixture; $f.Source.coverage.copyright_source_files=0; Save-Fixture $f; Reject { Assemble $f } }
Case 'Provenance file itself must match the manifest hash' { $f=New-Fixture; $f.Manifest.provenance_sha256='0'*64; Save $f.ManifestPath $f.Manifest; Reject { Assemble $f } }

# Copy only declared versioned inputs and the source files used by the assembly entry.
# Git is used solely to check the ignored output location; no clone or Git mutation is needed.
$isolated=Join-Path $testRoot 'source-only'
$sourceRoot=Join-Path $repo 'release/notice-source'
$curatedManifest=Get-NoticeJson (Join-Path $sourceRoot 'manifest.json')
$curatedSource=Get-NoticeJson (Join-Path $sourceRoot 'provenance.json')
$inputFiles=@('package.json','.gitignore','scripts/build-third-party-notices.ps1','scripts/third-party-notices.ps1','scripts/notice-source.ps1','scripts/portable-package-safety.ps1','scripts/release-safety.ps1')
$inputFiles+=@('manifest.json',$curatedManifest.inventory_file,$curatedManifest.provenance_file,$curatedManifest.copyright_review_file)+@($curatedSource.assets.file) | ForEach-Object { 'release/notice-source/'+$_ }
foreach ($relative in $inputFiles) {
    $from=Join-Path $repo $relative; $to=Join-Path $isolated $relative
    Assert-ReleaseContained $repo $from; Assert-ReleaseNoReparse $from; Assert-ReleaseContained $isolated $to
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($to)) -Force | Out-Null
    [IO.File]::Copy($from,$to,$false)
}
Save (Join-Path $testRoot 'source-only-inputs.json') ([ordered]@{classification='TEST_ONLY';files=$inputFiles;ignored_audit_inputs=@();network_required=$false;dependency_cache_required=$false;git_mutations=$false;git_usage='Read-only output ignore guard inherited from enclosing repository'})
Case 'Clean-clone equivalent source-only execution reproduces all 207/148' {
    $names=@('CARGO_HOME','RUSTUP_HOME','NPM_CONFIG_CACHE','HTTP_PROXY','HTTPS_PROXY'); $saved=@{}
    foreach ($name in $names) { $saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
    try {
        foreach ($name in @('CARGO_HOME','RUSTUP_HOME','NPM_CONFIG_CACHE')) { [Environment]::SetEnvironmentVariable($name,(Join-Path $isolated 'NONEXISTENT-TEST_ONLY-CACHE'),'Process') }
        $env:HTTP_PROXY='http://127.0.0.1:9'; $env:HTTPS_PROXY='http://127.0.0.1:9'
        Push-Location $isolated
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-third-party-notices.ps1 -InputManifest release/notice-source/manifest.json -OutputDirectory tmp/one
            Expect ($LASTEXITCODE -eq 0)
            & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-third-party-notices.ps1 -InputManifest release/notice-source/manifest.json -OutputDirectory tmp/two
            Expect ($LASTEXITCODE -eq 0)
        } finally { Pop-Location }
        $a=Get-NoticeJson (Join-Path $isolated 'tmp/one/assembly-result.json')
        Expect ($a.coverage.candidates -eq 207 -and $a.coverage.distinct_raw_texts -eq 148 -and $a.coverage.records -eq 752 -and $a.formal_clearance -eq $false)
        Expect ($a.coverage.draft_sha256 -ceq $curatedSource.baseline_draft_sha256)
    } finally { foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$saved[$name],'Process') } }
}
Case 'Source-only all three output files repeat byte-for-byte' {
    foreach ($file in @('THIRD-PARTY-NOTICES.DRAFT.txt','notice-inventory.DRAFT.json','assembly-result.json')) {
        Expect ((Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $isolated ('tmp/one/'+$file)))) -ceq (Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $isolated ('tmp/two/'+$file)))))
    }
}
Case 'No network/cache discovery calls in source validator or assembly' {
    foreach ($file in @('scripts/notice-source.ps1','scripts/third-party-notices.ps1','scripts/build-third-party-notices.ps1')) {
        $text=Get-PortableText (Read-PortableBytes (Join-Path $repo $file))
        Expect ($text -notmatch '(?i)Invoke-WebRequest|Invoke-RestMethod|HttpClient|WebClient|cargo\s|npm\s|node_modules|CARGO_HOME|RUSTUP_HOME')
    }
}
Case 'Formal notice availability remains closed' { Reject { Assert-PortableNoticeAvailability $repo } }
$summary=[ordered]@{classification='TEST_ONLY';passed=$passed;failed=$failed;source_only_actual_candidates=207;source_only_actual_texts=148;source_only_input_files=$inputFiles.Count;application_executed=$false;formal_clearance=$false;network_required=$false;git_mutations=$false}
Save (Join-Path $testRoot 'test-result.json') $summary
Write-Output "Versioned notice source tests: $passed passed, $failed failed. TEST_ONLY; no application executed."
if ($failed -gt 0) { exit 1 }
exit 0
