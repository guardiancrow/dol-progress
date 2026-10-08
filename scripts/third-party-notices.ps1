#Requires -Version 5.1
. (Join-Path $PSScriptRoot 'portable-package-safety.ps1')

function Get-NoticeRelativeFile([string]$Root, [string]$Relative) {
    if ($Relative -cnotmatch '^[a-zA-Z0-9._/-]+$' -or $Relative.StartsWith('/') -or
        @($Relative.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) { throw 'Assembly: unsafe evidence reference.' }
    $file=[IO.Path]::GetFullPath((Join-Path $Root $Relative))
    Assert-ReleaseContained $Root $file
    Assert-ReleaseNoReparse $file
    return $file
}

function Get-NoticeJson([string]$Path) {
    return (Get-PortableText (Read-PortableBytes $Path 16777216) | ConvertFrom-Json)
}

function Get-NoticeContract($Record) {
    # The manifest pins these independently of the editable assembly inventory.
    return [ordered]@{
        component_id=$Record.component_id; name=$Record.name; version=$Record.version; group=$Record.group
        notice_candidate=$Record.notice_candidate; inclusion_classification=$Record.inclusion_classification
        declared_license=$Record.declared_license; license_selection=$Record.license_selection
        text_evidence=@($Record.text_evidence); copyright=$Record.copyright; NOTICE=$Record.NOTICE
        source_provision=$Record.source_provision; unresolved_obligations=@($Record.unresolved_obligations)
    }
}

function Get-NoticeOrdinalKeys($Map) {
    [string[]]$keys=@($Map.Keys)
    [Array]::Sort($keys, [StringComparer]::Ordinal)
    return ,$keys
}

function Invoke-NoticeDraftAssembly([string]$RepositoryRoot, [string]$ManifestPath, [string]$OutputDirectory) {
    Assert-ReleaseNoReparse $RepositoryRoot
    Assert-ReleaseContained $RepositoryRoot $ManifestPath
    $evidenceRoot=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ManifestPath))
    $manifest=Get-NoticeJson $ManifestPath
    if ($manifest.schema -ne 1 -or $manifest.kind -cne 'NOTICE_ASSEMBLY_DRAFT' -or $manifest.status -cne 'DRAFT' -or
        $manifest.target -cne 'x86_64-pc-windows-msvc' -or $manifest.source_head -cnotmatch '^[0-9a-f]{40}$' -or
        $manifest.version -cnotmatch '^\d+\.\d+\.\d+$' -or
        $manifest.expected_records -le 0 -or $manifest.expected_candidates -le 0 -or $manifest.expected_texts -le 0 -or
        $manifest.expected_candidates -gt $manifest.expected_records -or
        $manifest.bundle_reference -cnotmatch '^[a-zA-Z0-9._/-]+$' -or
        @($manifest.bundle_reference.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) { throw 'Assembly: invalid draft manifest.' }
    $package=Get-NoticeJson (Join-Path $RepositoryRoot 'package.json')
    if ($manifest.version -cne $package.version) { throw 'Assembly: application version mismatch.' }
    $inventoryPath=Get-NoticeRelativeFile $evidenceRoot $manifest.inventory_file
    $inventoryBytes=Read-PortableBytes $inventoryPath 16777216
    if ($manifest.inventory_sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-ReleaseSHA256 $inventoryBytes) -cne $manifest.inventory_sha256) { throw 'Assembly: inventory hash mismatch.' }
    $inventory=Get-PortableText $inventoryBytes | ConvertFrom-Json
    if ($inventory.status -cne 'DRAFT' -or $inventory.version -cne $manifest.version -or $inventory.source_head -cne $manifest.source_head) { throw 'Assembly: inventory identity mismatch.' }
    $records=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    $contracts=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    foreach ($contract in $manifest.component_contracts) {
        if ([string]::IsNullOrWhiteSpace($contract.component_id) -or $contracts.ContainsKey($contract.component_id)) { throw 'Assembly: duplicate contract ID.' }
        $contracts.Add($contract.component_id,$contract)
    }
    foreach ($record in $inventory.records) {
        if ([string]::IsNullOrWhiteSpace($record.component_id) -or $records.ContainsKey($record.component_id) -or
            [string]::IsNullOrWhiteSpace($record.name) -or [string]::IsNullOrWhiteSpace($record.version) -or
            $record.group -cnotin @('rust','frontend','native','toolchain','assets') -or $record.notice_candidate -isnot [bool] -or
            $record.unresolved_obligations -isnot [array] -or $record.obligations_completed -isnot [bool] -or $record.obligations_completed -ne $false -or
            $record.provenance_completed -isnot [bool] -or $record.provenance_completed -ne $false -or
            -not $contracts.ContainsKey($record.component_id)) { throw 'Assembly: incomplete unapproved component.' }
        $actual=Get-NoticeContract $record | ConvertTo-Json -Depth 60 -Compress
        $expected=$contracts[$record.component_id] | ConvertTo-Json -Depth 60 -Compress
        if ($actual -cne $expected) { throw 'Assembly: component/version/license/notice contract mismatch.' }
        if ($record.source_provision.state -ceq 'COMPLETE' -or $record.license_selection.status -cnotin @('PROPOSED_NOT_APPROVED','UNRESOLVED_LEGACY_EXPRESSION','PARTIAL_CODE_ONLY_DATA_UNRESOLVED')) { throw 'Assembly: false clearance metadata.' }
        $records.Add($record.component_id,$record)
    }
    if ($records.Count -ne $contracts.Count -or $records.Count -ne $manifest.expected_records) { throw 'Assembly: component coverage mismatch.' }
    $texts=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    $rawTexts=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    foreach ($item in $inventory.texts) {
        if ($item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $texts.ContainsKey($item.sha256) -or @($item.origins).Count -eq 0) { throw 'Assembly: duplicate or unproven raw text.' }
        $file=Get-NoticeRelativeFile $evidenceRoot $item.file
        $bytes=Read-PortableBytes $file 16777216
        if ($bytes.Length -ne $item.bytes -or (Get-ReleaseSHA256 $bytes) -cne $item.sha256) { throw 'Assembly: original text changed.' }
        $text=Get-PortableText $bytes
        foreach ($origin in $item.origins) {
            if ([string]::IsNullOrWhiteSpace($origin.source) -or [string]::IsNullOrWhiteSpace($origin.version)) { throw 'Assembly: missing original provenance.' }
        }
        $texts.Add($item.sha256,$item); $rawTexts.Add($item.sha256,$text)
    }
    if ($texts.Count -ne $manifest.expected_texts) { throw 'Assembly: raw text coverage mismatch.' }
    $owners=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    foreach ($item in $inventory.copyright_source_files) {
        if ($item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $owners.ContainsKey($item.sha256) -or @($item.sources).Count -eq 0) { throw 'Assembly: duplicate or unproven owner source.' }
        $bytes=Read-PortableBytes (Get-NoticeRelativeFile $evidenceRoot $item.file) 16777216
        if ((Get-ReleaseSHA256 $bytes) -cne $item.sha256) { throw 'Assembly: owner source changed.' }
        $owners.Add($item.sha256,[pscustomobject]@{text=(Get-PortableText $bytes).Replace("`r`n","`n");sources=@($item.sources)})
    }
    $reviewBytes=Read-PortableBytes (Get-NoticeRelativeFile $evidenceRoot $manifest.copyright_review_file) 16777216
    if ((Get-ReleaseSHA256 $reviewBytes) -cne $manifest.copyright_review_sha256) { throw 'Assembly: copyright assessment hash mismatch.' }
    $review=Get-PortableText $reviewBytes | ConvertFrom-Json
    $candidateCount=0; $ownerCount=0; $noticeCount=0; $textReferences=0; $unknown=0; $excluded=0; $linked=0; $links=0
    $used=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $body=New-Object Text.StringBuilder
    [void]$body.Append("DRAFT $([char]0x2014) NOT FOR DISTRIBUTION`nLICENSE CLEARANCE INCOMPLETE`n`n")
    [void]$body.Append("Version: $($manifest.version)`nSource HEAD: $($manifest.source_head)`nTarget: $($manifest.target)`n")
    [void]$body.Append("Unapproved assembly; inclusion, file obligations and source delivery require actual review.`n`n")
    foreach ($id in (Get-NoticeOrdinalKeys $records)) {
        $r=$records[$id]
        if ($r.inclusion_classification -ceq 'UNKNOWN') { $unknown++ }
        if ($r.inclusion_classification -ceq 'NOT_INCLUDED_CONFIRMED') { $excluded++ }
        if ($r.unresolved_obligations.Count -gt 0) { $linked++; $links+=$r.unresolved_obligations.Count }
        if (-not $r.notice_candidate) { continue }
        $candidateCount++
        if (@($r.text_evidence).Count -eq 0 -or [string]::IsNullOrWhiteSpace($r.declared_license) -or [string]::IsNullOrWhiteSpace($r.license_selection.expression)) { throw 'Assembly: candidate license evidence missing.' }
        foreach ($t in $r.text_evidence) {
            if (-not $texts.ContainsKey($t.sha256) -or $t.raw_file -cne $texts[$t.sha256].file -or
                @($texts[$t.sha256].origins | Where-Object { $_.source -ceq $t.source -and $_.version -ceq $t.version }).Count -eq 0) { throw 'Assembly: original component association mismatch.' }
            [void]$used.Add($t.sha256); $textReferences++
        }
        if (@($r.copyright.notices).Count -gt 0) {
            $ownerCount++
            foreach ($owner in $r.copyright.notices) {
                if ([string]::IsNullOrWhiteSpace($owner.text) -or [string]::IsNullOrWhiteSpace($owner.source) -or
                    -not $owners.ContainsKey($owner.sha256) -or $owners[$owner.sha256].sources -cnotcontains $owner.source -or
                    -not $owners[$owner.sha256].text.Contains($owner.text.Replace("`r`n","`n"))) { throw 'Assembly: actual copyright mapping missing.' }
            }
        } else {
            $assessment=@($review.records | Where-Object { $_.component_id -ceq $id })
            if ($assessment.Count -ne 1 -or $assessment[0].classification -cne 'no separate owner line required based on evidence' -or
                $r.copyright.b2a_detection_review -cne $assessment[0].classification -or [string]::IsNullOrWhiteSpace($assessment[0].basis) -or
                @($assessment[0].evidence).Count -eq 0) { throw 'Assembly: no-owner evidence assessment missing.' }
        }
        if (@($r.NOTICE.texts).Count -gt 0) {
            $noticeCount++
            foreach ($t in $r.NOTICE.texts) {
                if (@($r.text_evidence | Where-Object { $_.sha256 -ceq $t.sha256 -and $_.source -ceq $t.source -and $_.version -ceq $t.version }).Count -eq 0) { throw 'Assembly: NOTICE component mapping missing.' }
            }
        }
        [void]$body.Append("=== COMPONENT $id ===`n$($r.name) / $($r.version)`nGroup: $($r.group)`nInclusion: $($r.inclusion_classification)`n")
        [void]$body.Append("Declared license: $($r.declared_license)`nLicense proposal: $($r.license_selection.expression)`nSelection: $($r.license_selection.status)`n")
        foreach ($owner in $r.copyright.notices) { [void]$body.Append("Source attribution: $($owner.text.Replace("`r`n","`n"))`nSource: $($owner.source)`nSource SHA-256: $($owner.sha256)`n") }
        if (@($r.copyright.notices).Count -eq 0) { [void]$body.Append("Owner evidence: no separate owner line in examined sources; review remains open.`n") }
        [void]$body.Append("Full text SHA-256: $((@($r.text_evidence.sha256) -join ', '))`nNOTICE SHA-256: $((@($r.NOTICE.texts.sha256) -join ', '))`n")
        [void]$body.Append("Open conditions: $((@($r.unresolved_obligations) -join ', '))`nSource state: $($r.source_provision.state)`n`n")
    }
    if ($candidateCount -ne $manifest.expected_candidates -or $used.Count -ne $texts.Count) { throw 'Assembly: candidate/raw coverage mismatch.' }
    foreach ($hash in (Get-NoticeOrdinalKeys $texts)) {
        [void]$body.Append("=== FULL ORIGINAL TEXT $hash ===`n")
        [void]$body.Append($rawTexts[$hash].Replace("`r`n","`n")); [void]$body.Append("`n=== END ORIGINAL TEXT ===`n`n")
    }
    $encoding=New-Object Text.UTF8Encoding($false,$true)
    $bytes=$encoding.GetBytes($body.ToString())
    if ($bytes.Length -gt 16777216) { throw 'Assembly: draft exceeds 16 MiB.' }
    $inventory.records=@(foreach ($id in (Get-NoticeOrdinalKeys $records)) { $records[$id] })
    $inventory.texts=@(foreach ($hash in (Get-NoticeOrdinalKeys $texts)) { $texts[$hash] })
    # Evidence paths remain explicitly rooted in the input bundle; no absolute host path is emitted.
    $coverage=[ordered]@{status='DRAFT';records=$records.Count;candidates=$candidateCount;distinct_raw_texts=$texts.Count;text_references=$textReferences;owner_evidence_candidates=$ownerCount;named_notice_candidates=$noticeCount;unknown=$unknown;excluded_with_evidence=$excluded;unresolved_linked_components=$linked;component_obligation_links=$links;applicable_conditions_closed=0;source_provision_complete=0;legal_review_completed=0;draft_bytes=$bytes.Length;draft_sha256=(Get-ReleaseSHA256 $bytes);encoding='UTF-8 without BOM; LF';deduplication='Raw SHA-256; component/version/origin associations retained';formal_input=$false}
    $result=[ordered]@{schema=1;kind='NOTICE_ASSEMBLY_RESULT';status='DRAFT';version=$manifest.version;source_head=$manifest.source_head;manifest_sha256=(Get-ReleaseSHA256 (Read-PortableBytes $ManifestPath));inventory_sha256=$manifest.inventory_sha256;copyright_review_sha256=$manifest.copyright_review_sha256;coverage=$coverage;copyright_source_files_verified=$owners.Count;source_provision_complete=$false;formal_clearance=$false;public_release='NO_GO'}
    $tmpRoot=Join-Path $RepositoryRoot 'tmp'
    Assert-ReleaseContained $tmpRoot $OutputDirectory; Assert-ReleaseNoReparse $OutputDirectory
    $relative=[IO.Path]::GetFullPath($OutputDirectory).Substring([IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\').Length+1).Replace('\','/')
    Get-PortableGit $RepositoryRoot @('check-ignore','--quiet','--',($relative+'/notice-inventory.DRAFT.json')) | Out-Null
    if ([IO.Directory]::Exists($OutputDirectory) -or [IO.File]::Exists($OutputDirectory)) { throw 'Assembly: output already exists.' }
    # All input verification finishes before any output directory is created.
    New-Item -ItemType Directory -Path $OutputDirectory -ErrorAction Stop | Out-Null
    Write-PortableBytes $OutputDirectory (Join-Path $OutputDirectory 'THIRD-PARTY-NOTICES.DRAFT.txt') $bytes
    $outputInventory=[ordered]@{schema=1;kind='NOTICE_ASSEMBLY_DRAFT_OUTPUT';status='DRAFT';version=$inventory.version;source_head=$inventory.source_head;input_bundle_reference=$manifest.bundle_reference;input_inventory_sha256=$manifest.inventory_sha256;coverage=$coverage;records=$inventory.records;texts=$inventory.texts;copyright_source_files=$inventory.copyright_source_files;formal_clearance=$false}
    Write-ReleaseNewText (Join-Path $OutputDirectory 'notice-inventory.DRAFT.json') (($outputInventory | ConvertTo-Json -Depth 60)+"`n")
    Write-ReleaseNewText (Join-Path $OutputDirectory 'assembly-result.json') (($result | ConvertTo-Json -Depth 10)+"`n")
    return [pscustomobject]$result
}
