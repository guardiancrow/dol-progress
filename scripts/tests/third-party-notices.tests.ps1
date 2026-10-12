#Requires -Version 5.1
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../third-party-notices.ps1')
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixtures=Join-Path $repo ('tmp/phase-23d-c1c-b2b/tests/'+[Guid]::NewGuid().ToString('N'))
Assert-ReleaseContained $repo $fixtures; Assert-ReleaseNoReparse $fixtures
Get-PortableGit $repo @('check-ignore','--quiet','--','tmp/phase-23d-c1c-b2b/test.txt') | Out-Null
New-Item -ItemType Directory -Path $fixtures | Out-Null
$passed=0; $failed=0; $counter=0
function Expect($Value) { if (-not $Value) { throw 'Synthetic assertion failed.' } }
function Reject([scriptblock]$Action) { $ok=$false; try { & $Action | Out-Null } catch { $ok=$true }; Expect $ok }
function Case([string]$Name,[scriptblock]$Action) {
    try { & $Action; $script:passed++; Write-Output "PASS $Name" }
    catch { $script:failed++; Write-Output ("FAIL $Name : "+(Protect-ReleaseText $_.Exception.Message ([ordered]@{Fixture=$fixtures;Repository=$repo;User=$env:USERPROFILE}))) }
}
function New-Path { $script:counter++; return Join-Path $fixtures ('TEST_ONLY_'+$script:counter) }
function Save-Json([string]$Path,$Value) { [IO.File]::WriteAllText($Path,(($Value | ConvertTo-Json -Depth 60)+"`n"),(New-Object Text.UTF8Encoding($false))) }
function Save-Model($Fixture) {
    Save-Json (Join-Path $Fixture.Root 'inventory.json') $Fixture.Inventory
    $Fixture.Manifest.inventory_sha256=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $Fixture.Root 'inventory.json'))
    Save-Json $Fixture.ManifestPath $Fixture.Manifest
}
function New-Fixture {
    $root=New-Path; New-Item -ItemType Directory -Path (Join-Path $root 'texts') | Out-Null
    $texts=@(); $ownerFiles=@(); $records=@()
    for ($i=0;$i -lt 148;$i++) {
        $body="TEST_ONLY original $i; synthetic evidence, no real license.`nCopyright (c) 2000 TEST_ONLY Fictional Owner`n$([char]0x65e5)$([char]0x672c)`n"
        $bytes=[Text.Encoding]::UTF8.GetBytes($body); $hash=Get-ReleaseSHA256 $bytes; $file='texts/'+$hash+'.txt'; $source='synthetic-origin-'+$i
        Write-PortableBytes $root (Join-Path $root $file) $bytes
        $texts+=[pscustomobject]@{sha256=$hash;file=$file;bytes=$bytes.Length;origins=@([pscustomobject]@{source=$source;version='1.0.0';source_kind='TEST_ONLY'})}
        $ownerFiles+=[pscustomobject]@{sha256=$hash;file=$file;sources=@($source)}
    }
    for ($i=0;$i -lt 207;$i++) {
        $t=$texts[$i % 148]; $ref=[pscustomobject]@{sha256=$t.sha256;raw_file=$t.file;source=$t.origins[0].source;version='1.0.0'}
        $records+=[pscustomobject]@{
            component_id=('TEST_ONLY-'+$i.ToString('D4'));name=('Synthetic component '+$i);version='1.0.0';group='rust';notice_candidate=$true;inclusion_classification='INCLUDED_LIKELY'
            declared_license='TEST_ONLY_A AND TEST_ONLY_B';license_selection=[pscustomobject]@{status='PROPOSED_NOT_APPROVED';expression='TEST_ONLY_A AND TEST_ONLY_B';basis='Synthetic AND contract'}
            text_evidence=@($ref);copyright=[pscustomobject]@{state='OWNER_DISPLAY_EVIDENCE_PRESERVED_NOT_COMPLETE';notices=@([pscustomobject]@{text='Copyright (c) 2000 TEST_ONLY Fictional Owner';source=$ref.source;sha256=$t.sha256});coverage_complete=$false}
            NOTICE=[pscustomobject]@{state='SYNTHETIC_EVIDENCE';texts=@();coverage_complete=$false};source_provision=[pscustomobject]@{state='NOT_ASSESSED';url=$null}
            unresolved_obligations=@('A07','A12');obligations_completed=$false;provenance_completed=$false
        }
        if ($i -lt 5) { $records[-1].NOTICE.texts=@($ref) }
    }
    $inventory=[pscustomobject]@{status='DRAFT';version='0.3.0';source_head=('a'*40);records=$records;texts=$texts;copyright_source_files=$ownerFiles}
    Write-ReleaseNewText (Join-Path $root 'copyright-review.json') '{"records":[]}'
    $manifest=[pscustomobject]@{schema=1;kind='NOTICE_ASSEMBLY_DRAFT';status='DRAFT';version='0.3.0';source_head=('a'*40);target='x86_64-pc-windows-msvc';inventory_file='inventory.json';inventory_sha256='';copyright_review_file='copyright-review.json';copyright_review_sha256=(Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $root 'copyright-review.json')));expected_records=207;expected_candidates=207;expected_texts=148;bundle_reference='tmp/TEST_ONLY/assembly-manifest.json';component_contracts=@($records | ForEach-Object { [pscustomobject](Get-NoticeContract $_) })}
    # Roundtrip isolates contract objects from the subsequently mutated inventory.
    $manifest=($manifest | ConvertTo-Json -Depth 60) | ConvertFrom-Json
    $fixture=[pscustomobject]@{Root=$root;Inventory=$inventory;Manifest=$manifest;ManifestPath=(Join-Path $root 'assembly-manifest.json')}
    Save-Model $fixture
    return $fixture
}
function Assemble($Fixture) { return Invoke-NoticeDraftAssembly $repo $Fixture.ManifestPath (New-Path) }
function New-NoOwnerFixture {
    $f=New-Fixture; $index=147
    $bytes=[Text.Encoding]::UTF8.GetBytes("TEST_ONLY synthetic permission original; no separately stated owner line.`n")
    $hash=Get-ReleaseSHA256 $bytes; $relative='texts/'+$hash+'.txt'
    Write-PortableBytes $f.Root (Join-Path $f.Root $relative) $bytes
    $f.Inventory.texts[$index].sha256=$hash; $f.Inventory.texts[$index].file=$relative; $f.Inventory.texts[$index].bytes=$bytes.Length
    $r=$f.Inventory.records[$index]; $r.text_evidence[0].sha256=$hash; $r.text_evidence[0].raw_file=$relative
    $r.copyright.notices=@(); $r.copyright.state='NO_SEPARATE_OWNER_LINE_IN_EXAMINED_ORIGINALS_SCOPE_LIMITED'
    $classification='no separate owner line required based on evidence'
    $r.copyright | Add-Member -NotePropertyName b2a_detection_review -NotePropertyValue $classification
    $assessment=[pscustomobject]@{records=@([pscustomobject]@{component_id=$r.component_id;classification=$classification;basis='TEST_ONLY original scoped review, no owner was invented';evidence=@([pscustomobject]@{file=$relative;sha256=$hash});legal_clearance=$false})}
    Save-Json (Join-Path $f.Root 'copyright-review.json') $assessment
    $f.Manifest.copyright_review_sha256=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $f.Root 'copyright-review.json'))
    $f.Manifest.component_contracts[$index]=[pscustomobject](Get-NoticeContract $r)
    Save-Model $f
    return $f
}
$fixture=New-Fixture
Case '207 candidate mapping and 148 raw references' { $r=Assemble $fixture; Expect ($r.coverage.candidates -eq 207 -and $r.coverage.distinct_raw_texts -eq 148 -and $r.coverage.text_references -eq 207) }
Case 'Deterministic output hash' { $a=Assemble $fixture; $b=Assemble $fixture; Expect ($a.coverage.draft_sha256 -ceq $b.coverage.draft_sha256) }
Case 'Stable ordinal component and text ordering after shuffled input' {
    $a=Assemble $fixture; $other=New-Fixture
    [array]::Reverse($other.Inventory.records); [array]::Reverse($other.Inventory.texts); [array]::Reverse($other.Manifest.component_contracts); Save-Model $other
    $b=Assemble $other; Expect ($a.coverage.draft_sha256 -ceq $b.coverage.draft_sha256)
}
Case 'Source hash exact and duplicate full bodies emitted once' {
    $out=New-Path; [void](Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $out)
    $text=Get-PortableText (Read-PortableBytes (Join-Path $out 'THIRD-PARTY-NOTICES.DRAFT.txt'))
    Expect ([regex]::Matches($text,'=== FULL ORIGINAL TEXT ').Count -eq 148)
    foreach ($t in $fixture.Inventory.texts) { Expect ($text.Contains((Get-PortableText (Read-PortableBytes (Join-Path $fixture.Root $t.file))))) }
}
Case 'Output UTF-8 without BOM and LF preserves non-ASCII originals' {
    $out=New-Path; [void](Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $out); $b=Read-PortableBytes (Join-Path $out 'THIRD-PARTY-NOTICES.DRAFT.txt')
    Expect (-not ($b[0] -eq 239 -and $b[1] -eq 187 -and $b[2] -eq 191)); $s=Get-PortableText $b
    Expect (-not $s.Contains("`r") -and $s.Contains("$([char]0x65e5)$([char]0x672c)"))
}
Case 'Draft marker and no formal clearance' { $out=New-Path; $r=Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $out; $text=Get-PortableText (Read-PortableBytes (Join-Path $out 'THIRD-PARTY-NOTICES.DRAFT.txt')); Expect ($text.StartsWith("DRAFT $([char]0x2014) NOT FOR DISTRIBUTION`nLICENSE CLEARANCE INCOMPLETE`n") -and $r.status -ceq 'DRAFT' -and $r.formal_clearance -eq $false -and $r.source_provision_complete -eq $false -and $r.public_release -ceq 'NO_GO') }
Case 'All three output files repeat exactly for identical inputs' {
    $a=New-Path; $b=New-Path; [void](Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $a); [void](Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $b)
    foreach ($name in @('THIRD-PARTY-NOTICES.DRAFT.txt','notice-inventory.DRAFT.json','assembly-result.json')) { Expect ((Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $a $name))) -ceq (Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $b $name)))) }
}
Case 'No separate owner drafting evidence accepted without invented owner' { $r=Assemble (New-NoOwnerFixture); Expect ($r.coverage.owner_evidence_candidates -eq 206 -and $r.coverage.legal_review_completed -eq 0) }
Case 'No-owner missing assessment rejected independently of contract' { $f=New-NoOwnerFixture; Write-ReleaseNewText (Join-Path $f.Root 'empty-review.json') '{"records":[]}'; $f.Manifest.copyright_review_file='empty-review.json'; $f.Manifest.copyright_review_sha256=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $f.Root 'empty-review.json')); Save-Model $f; Reject { Assemble $f } }
Case 'All unresolved component arrays retained' { $r=Assemble $fixture; Expect ($r.coverage.unresolved_linked_components -eq 207 -and $r.coverage.component_obligation_links -eq 414) }
Case 'Missing original fails before output creation' { $f=New-Fixture; $file=Join-Path $f.Root $f.Inventory.texts[0].file; [IO.File]::Move($file,$file+'.missing'); $out=New-Path; Reject { Invoke-NoticeDraftAssembly $repo $f.ManifestPath $out }; Expect (-not [IO.Directory]::Exists($out)) }
Case 'Changed original bytes rejected' { $f=New-Fixture; [IO.File]::AppendAllText((Join-Path $f.Root $f.Inventory.texts[0].file),'changed'); Reject { Assemble $f } }
Case 'Wrong original hash rejected' { $f=New-Fixture; $f.Inventory.texts[0].sha256='0'*64; Save-Model $f; Reject { Assemble $f } }
Case 'Version mismatch rejected even with rehashed inventory' { $f=New-Fixture; $f.Inventory.records[0].version='2.0.0'; Save-Model $f; Reject { Assemble $f } }
Case 'Duplicate component ID rejected' { $f=New-Fixture; $f.Inventory.records[1].component_id=$f.Inventory.records[0].component_id; Save-Model $f; Reject { Assemble $f } }
Case 'Missing component contract rejected' { $f=New-Fixture; $f.Manifest.component_contracts=@($f.Manifest.component_contracts | Select-Object -Skip 1); Save-Model $f; Reject { Assemble $f } }
Case 'Incorrect AND to OR treatment rejected' { $f=New-Fixture; $f.Inventory.records[0].license_selection.expression='TEST_ONLY_A OR TEST_ONLY_B'; Save-Model $f; Reject { Assemble $f } }
Case 'Explicit OR proposal retained without approving it' { $f=New-Fixture; $f.Inventory.records[0].declared_license='TEST_ONLY_A OR TEST_ONLY_B'; $f.Inventory.records[0].license_selection.expression='TEST_ONLY_A'; $f.Manifest.component_contracts[0]=[pscustomobject](Get-NoticeContract $f.Inventory.records[0]); Save-Model $f; $r=Assemble $f; Expect ($r.coverage.legal_review_completed -eq 0 -and $r.formal_clearance -eq $false) }
Case 'Missing copyright mapping rejected' { $f=New-Fixture; $f.Inventory.records[0].copyright.notices=@(); Save-Model $f; Reject { Assemble $f } }
Case 'Missing NOTICE mapping rejected' { $f=New-Fixture; $f.Inventory.records[0].NOTICE.texts=@(); Save-Model $f; Reject { Assemble $f } }
Case 'NOTICE linked to other component original rejected' { $f=New-Fixture; $f.Inventory.records[0].NOTICE.texts=@($f.Inventory.records[1].text_evidence[0]); Save-Model $f; Reject { Assemble $f } }
Case 'Unresolved removal rejected' { $f=New-Fixture; $f.Inventory.records[0].unresolved_obligations=@(); Save-Model $f; Reject { Assemble $f } }
Case 'Duplicate raw hash references rejected' { $f=New-Fixture; $f.Inventory.texts+=@($f.Inventory.texts[0]); Save-Model $f; Reject { Assemble $f } }
Case 'Missing source provenance rejected' { $f=New-Fixture; $f.Inventory.texts[0].origins[0].source=''; Save-Model $f; Reject { Assemble $f } }
Case 'Copyright literal not in original rejected independently of contract' { $f=New-Fixture; $f.Inventory.records[0].copyright.notices[0].text='Invented owner'; $f.Manifest.component_contracts[0].copyright.notices[0].text='Invented owner'; Save-Model $f; Reject { Assemble $f } }
Case 'Owner source label must match the original index' { $f=New-Fixture; $f.Inventory.copyright_source_files[0].sources=@('Different source'); Save-Model $f; Reject { Assemble $f } }
Case 'Null unresolved not silently converted to empty' { $f=New-Fixture; $f.Inventory.records[0].unresolved_obligations=$null; Save-Model $f; Reject { Assemble $f } }
Case 'False completed obligations rejected' { $f=New-Fixture; $f.Inventory.records[0].obligations_completed=$true; Save-Model $f; Reject { Assemble $f } }
Case 'False REVIEWED manifest rejected' { $f=New-Fixture; $f.Manifest.status='REVIEWED'; Save-Model $f; Reject { Assemble $f } }
Case 'Raw source traversal rejected' { $f=New-Fixture; $f.Inventory.texts[0].file='../outside.txt'; Save-Model $f; Reject { Assemble $f } }
Case 'Nonignored formal output is never written' { Reject { Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath (Join-Path $repo 'release/notices') } }
Case 'Output collision preserves original draft' { $out=New-Path; [void](Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $out); $hash=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $out 'THIRD-PARTY-NOTICES.DRAFT.txt')); Reject { Invoke-NoticeDraftAssembly $repo $fixture.ManifestPath $out }; Expect ($hash -ceq (Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $out 'THIRD-PARTY-NOTICES.DRAFT.txt')))) }
Case 'Invalid UTF-8 original rejected' { $f=New-Fixture; [IO.File]::WriteAllBytes((Join-Path $f.Root $f.Inventory.texts[0].file),[byte[]]@(255,255)); Reject { Assemble $f } }
Case 'Combined full text cannot exceed 16 MiB even with matching hashes' {
    $f=New-Fixture
    for ($i=0;$i -lt 2;$i++) {
        $old=$f.Inventory.texts[$i].sha256
        $b=[Text.Encoding]::UTF8.GetBytes("TEST_ONLY original $i`nCopyright (c) 2000 TEST_ONLY Fictional Owner`n"+('x'*(8*1024*1024)))
        $h=Get-ReleaseSHA256 $b; $relative='texts/'+$h+'.txt'; Write-PortableBytes $f.Root (Join-Path $f.Root $relative) $b
        $f.Inventory.texts[$i].sha256=$h; $f.Inventory.texts[$i].file=$relative; $f.Inventory.texts[$i].bytes=$b.Length
        $f.Inventory.copyright_source_files[$i].sha256=$h; $f.Inventory.copyright_source_files[$i].file=$relative
        foreach ($r in $f.Inventory.records) { if ($r.text_evidence[0].sha256 -ceq $old) { $r.text_evidence[0].sha256=$h; $r.text_evidence[0].raw_file=$relative; $r.copyright.notices[0].sha256=$h } }
    }
    $f.Manifest.component_contracts=@($f.Inventory.records | ForEach-Object { [pscustomobject](Get-NoticeContract $_) }); Save-Model $f
    $out=New-Path; $rejected=$false
    try { Invoke-NoticeDraftAssembly $repo $f.ManifestPath $out | Out-Null } catch { $rejected=$_.Exception.Message -ceq 'Assembly: draft exceeds 16 MiB.' }
    Expect ($rejected -and -not [IO.Directory]::Exists($out))
}

# The formal copyright extension is tested alone with in-memory synthetic review state;
# these are not signed distribution inputs or a claim of genuine clearance.
$proofRoot=New-Path; New-Item -ItemType Directory -Path (Join-Path $proofRoot 'release/notices/evidence') | Out-Null
$proofRelative='release/notices/evidence/TEST_ONLY-source-review.txt'; $proofPath=Join-Path $proofRoot $proofRelative
Write-ReleaseNewText $proofPath 'TEST_ONLY original has a permission statement without a separate owner notice; synthetic source review.'
$proofHash=Get-ReleaseSHA256 (Read-PortableBytes $proofPath)
$proofMap=[ordered]@{}; $proofMap[$proofRelative]=$proofHash
function No-OwnerRecord { return [pscustomobject]@{copyrights=@();evidence=@($proofRelative);copyright_review=[pscustomobject]@{state='NO_SEPARATE_NOTICE_IN_REVIEWED_SOURCES';reason='TEST_ONLY source scope reviewed; no separately stated owner notice.';source_evidence=@([pscustomobject]@{path=$proofRelative;sha256=$proofHash})}} }
Case 'Explicit no-owner assessment accepted with signed-map hash binding' { Assert-PortableCopyrightMapping $proofRoot (No-OwnerRecord) $proofMap 'TEST_ONLY license text' }
Case 'Empty copyrights without assessment rejected' { Reject { Assert-PortableCopyrightMapping $proofRoot ([pscustomobject]@{copyrights=@();evidence=@($proofRelative)}) $proofMap 'TEST_ONLY' } }
Case 'No-owner assessment wrong state rejected' { $r=No-OwnerRecord; $r.copyright_review.state='NOT_ASSESSED'; Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY' } }
Case 'No-owner assessment no reason rejected' { $r=No-OwnerRecord; $r.copyright_review.reason=''; Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY' } }
Case 'No-owner unsigned evidence rejected' { Reject { Assert-PortableCopyrightMapping $proofRoot (No-OwnerRecord) ([ordered]@{}) 'TEST_ONLY' } }
Case 'No-owner evidence must be in component review evidence' { $r=No-OwnerRecord; $r.evidence=@(); Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY' } }
Case 'No-owner evidence hash mismatch rejected' { $r=No-OwnerRecord; $r.copyright_review.source_evidence[0].sha256='0'*64; Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY' } }
Case 'No-owner evidence duplicate rejected' { $r=No-OwnerRecord; $r.copyright_review.source_evidence+=@($r.copyright_review.source_evidence[0]); Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY' } }
Case 'No-owner evidence traversal rejected' { $r=No-OwnerRecord; $r.copyright_review.source_evidence[0].path='release/notices/evidence/../TEST_ONLY.txt'; Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY' } }
Case 'Existing owner still requires literal notice' { $r=[pscustomobject]@{copyrights=@('TEST_ONLY actual owner')}; Reject { Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'missing' }; Assert-PortableCopyrightMapping $proofRoot $r $proofMap 'TEST_ONLY actual owner' }
Case 'Missing copyrights field rejected' { Reject { Assert-PortableCopyrightMapping $proofRoot ([pscustomobject]@{evidence=@($proofRelative)}) $proofMap 'TEST_ONLY' } }
Case 'Unapproved synthetic notice availability stays closed' {
    $root=New-Path
    New-Item -ItemType Directory -Path (Join-Path $root 'release/notices') | Out-Null
    foreach ($name in @('manifest.json','inventory.json','review.json','source.json')) {
        Save-Json (Join-Path $root ('release/notices/'+$name)) @{schema=1;status='PENDING';test_only=$true}
    }
    Write-ReleaseNewText (Join-Path $root 'THIRD-PARTY-NOTICES.txt') 'TEST_ONLY synthetic notice'
    $reason=''
    try { Assert-PortableNoticeAvailability $root } catch { $reason=$_.Exception.Message }
    Expect ($reason -ceq 'Notices: user review pending.')
    Reject { Assert-PortableNoticeAvailability (New-Path) }
}
$summary=[ordered]@{classification='TEST_ONLY';passed=$passed;failed=$failed;application_executed=$false;formal_clearance=$false;real_license_fixture_copies=0}
Write-ReleaseNewText (Join-Path $fixtures 'test-result.json') (($summary | ConvertTo-Json)+"`n")
Write-Output "Third-party notices tests: $passed passed, $failed failed. TEST_ONLY; no application executed."
if ($failed -gt 0) { exit 1 }
exit 0
