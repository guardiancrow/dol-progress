#Requires -Version 5.1

function Assert-NoticeVersionedSource([string]$Root, $Manifest, $Inventory) {
    if ($null -eq $Manifest.source_mode) { return }
    if ($Manifest.source_mode -cne 'VERSIONED_CURATED') { throw 'Source: unsupported source mode.' }
    $bytes=Read-PortableBytes (Get-NoticeRelativeFile $Root $Manifest.provenance_file) 16777216
    if ($Manifest.provenance_sha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-ReleaseSHA256 $bytes) -cne $Manifest.provenance_sha256) { throw 'Source: provenance hash mismatch.' }
    $source=Get-PortableText $bytes | ConvertFrom-Json
    if ($source.schema -ne 1 -or $source.kind -cne 'VERSIONED_NOTICE_SOURCE' -or $source.status -cne 'DRAFT' -or
        $source.version -cne $Manifest.version -or $source.formal_clearance -isnot [bool] -or $source.formal_clearance -ne $false -or
        $source.license_clearance -cne 'UNRESOLVED' -or $source.public_release -cne 'NO_GO' -or
        $source.coverage.records -ne $Manifest.expected_records -or $source.coverage.candidates -ne $Manifest.expected_candidates -or
        $source.coverage.raw_texts -ne $Manifest.expected_texts -or
        $source.coverage.copyright_source_files -ne @($Inventory.copyright_source_files).Count -or $source.assets -isnot [array]) { throw 'Source: incomplete draft source manifest.' }
    $records=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    foreach ($record in $Inventory.records) {
        if ([string]::IsNullOrWhiteSpace($record.component_id) -or $records.ContainsKey($record.component_id)) { throw 'Source: duplicate component ID.' }
        $records.Add($record.component_id,$record)
    }
    if ($source.components -isnot [array] -or $source.components.Count -ne $records.Count) { throw 'Source: component source coverage incomplete.' }
    $provenanceIds=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($component in $source.components) {
        if (-not $provenanceIds.Add($component.component_id) -or -not $records.ContainsKey($component.component_id)) { throw 'Source: duplicate or unknown provenance component.' }
        $record=$records[$component.component_id]
        if ($component.name -cne $record.name -or $component.version -cne $record.version -or
            $component.inclusion -cne $record.inclusion_classification -or $component.declared_license -cne $record.declared_license -or
            $component.notice_candidate -isnot [bool] -or $component.notice_candidate -ne $record.notice_candidate -or
            $component.provenance_completed -isnot [bool] -or $component.provenance_completed -ne $false -or
            $component.text_sha256 -isnot [array] -or
            (ConvertTo-Json -InputObject $component.text_sha256 -Compress) -cne (ConvertTo-Json -InputObject @($record.text_evidence | ForEach-Object { $_.sha256 }) -Compress) -or
            $component.unresolved_obligations -isnot [array] -or
            (ConvertTo-Json -InputObject $component.unresolved_obligations -Compress) -cne (ConvertTo-Json -InputObject $record.unresolved_obligations -Compress)) { throw 'Source: component source metadata mismatch.' }
    }
    $ids=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $files=New-Object 'Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    $hashes=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($asset in $source.assets) {
        if ([string]::IsNullOrWhiteSpace($asset.asset_id) -or -not $ids.Add($asset.asset_id) -or
            $files.ContainsKey([string]$asset.file) -or -not $hashes.Add([string]$asset.curated_sha256)) { throw 'Source: duplicate source manifest entry.' }
        if ($asset.disposition -cne 'INCLUDE' -or $asset.category -cnotin @('A','B')) { throw 'INCOMPLETE: required source is deferred; no fallback.' }
        if ([string]::IsNullOrWhiteSpace($asset.rights_basis) -or [string]::IsNullOrWhiteSpace($asset.license_identifier) -or
            $asset.original_sha256 -cnotmatch '^[a-f0-9]{64}$' -or $asset.curated_sha256 -cnotmatch '^[a-f0-9]{64}$' -or
            $asset.transformation -cne 'NONE' -or $asset.original_sha256 -cne $asset.curated_sha256 -or
            $asset.roles -isnot [array] -or $asset.roles.Count -eq 0 -or
            @($asset.roles | Where-Object { $_ -cnotin @('LICENSE_TEXT','COPYRIGHT_SOURCE') }).Count -gt 0) { throw 'Source: unsupported transformation or rights evidence.' }
        $raw=Read-PortableBytes (Get-NoticeRelativeFile $Root $asset.file) 16777216
        if ($raw.Length -ne $asset.curated_bytes -or (Get-ReleaseSHA256 $raw) -cne $asset.curated_sha256) { throw 'Source: curated bytes changed.' }
        if ($asset.component_ids -isnot [array] -or $asset.component_ids.Count -eq 0 -or
            @($asset.component_versions).Count -ne $asset.component_ids.Count -or @($asset.origins).Count -eq 0) { throw 'Source: component provenance missing.' }
        $components=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        foreach ($component in $asset.component_versions) {
            if (-not $components.Add($component.id) -or -not $records.ContainsKey($component.id) -or
                $asset.component_ids -cnotcontains $component.id -or $component.name -cne $records[$component.id].name -or
                $component.version -cne $records[$component.id].version -or
                $component.declared_license -cne $records[$component.id].declared_license) { throw 'Source: component/version/license mismatch.' }
        }
        if (@($asset.component_ids | Select-Object -Unique).Count -ne $components.Count) { throw 'Source: duplicate component association.' }
        foreach ($origin in $asset.origins) {
            if ([string]::IsNullOrWhiteSpace($origin.source_label) -or [string]::IsNullOrWhiteSpace($origin.version) -or
                [string]::IsNullOrWhiteSpace($origin.confidence) -or $origin.original_sha256 -cne $asset.original_sha256 -or
                $origin.source_label -match '(?i)(?:[a-z]:[\\/]|\\\\|file://)') { throw 'Source: unsafe original provenance.' }
            if ($origin.official_url) {
                $uri=$null
                if (-not [Uri]::TryCreate($origin.official_url,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -cne 'https' -or
                    -not [string]::IsNullOrEmpty($uri.UserInfo)) { throw 'Source: invalid public source reference.' }
            } elseif ([string]::IsNullOrWhiteSpace($origin.url_absence_reason)) { throw 'Source: original URL missing.' }
        }
        $files.Add($asset.file,$asset)
    }
    $used=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($item in $Inventory.texts) {
        if (-not $files.ContainsKey($item.file) -or $files[$item.file].roles -cnotcontains 'LICENSE_TEXT' -or
            $files[$item.file].curated_sha256 -cne $item.sha256 -or $files[$item.file].curated_bytes -ne $item.bytes) { throw 'Source: original text mapping missing.' }
        $asset=$files[$item.file]
        foreach ($origin in $item.origins) {
            if (@($asset.origins | Where-Object { $_.source_label -ceq $origin.source -and $_.version -ceq $origin.version }).Count -eq 0) { throw 'Source: original version association missing.' }
        }
        foreach ($record in $Inventory.records) {
            if (@($record.text_evidence | Where-Object { $_.sha256 -ceq $item.sha256 }).Count -gt 0 -and $asset.component_ids -cnotcontains $record.component_id) { throw 'Source: original component association missing.' }
        }
        [void]$used.Add($item.file)
    }
    foreach ($item in $Inventory.copyright_source_files) {
        if (-not $files.ContainsKey($item.file) -or $files[$item.file].roles -cnotcontains 'COPYRIGHT_SOURCE' -or
            $files[$item.file].curated_sha256 -cne $item.sha256) { throw 'Source: copyright evidence mapping missing.' }
        foreach ($label in $item.sources) {
            if (@($files[$item.file].origins | Where-Object { $_.source_label -ceq $label }).Count -eq 0) { throw 'Source: copyright origin missing.' }
        }
        [void]$used.Add($item.file)
    }
    if ($used.Count -ne $files.Count) { throw 'Source: unsupported unused source file.' }
    $referenceIds=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($reference in $source.references) {
        if ($reference.category -cnotin @('C','D','E') -or $null -ne $reference.curated_file -or
            [string]::IsNullOrWhiteSpace($reference.reason) -or [string]::IsNullOrWhiteSpace($reference.reference_id) -or
            -not $referenceIds.Add($reference.reference_id)) { throw 'Source: reference-only document cannot become an input.' }
    }
}
