#Requires -Version 5.1
. (Join-Path $PSScriptRoot 'release-safety.ps1')
Add-Type -AssemblyName System.IO.Compression

function Read-PortableBytes([string]$Path, [long]$Limit=100663296) {
    Assert-ReleaseNoReparse $Path
    $stream = [IO.File]::Open($Path, 'Open', 'Read', 'Read')
    try {
        if ($stream.Length -le 0 -or $stream.Length -gt $Limit) { throw 'Input: invalid size.' }
        $bytes = New-Object byte[] ([int]$stream.Length)
        $offset=0
        while ($offset -lt $bytes.Length) { $n=$stream.Read($bytes,$offset,$bytes.Length-$offset); if ($n -eq 0) { throw 'Input: truncated.' }; $offset+=$n }
        return ,$bytes
    } finally { $stream.Dispose() }
}

function Write-PortableBytes([string]$Root, [string]$Path, [byte[]]$Bytes) {
    Assert-ReleaseContained $Root $Path
    Assert-ReleaseNoReparse $Path
    $stream=[IO.File]::Open($Path,'CreateNew','Write','None')
    try { $stream.Write($Bytes,0,$Bytes.Length) } finally { $stream.Dispose() }
}

function Get-PortableText([byte[]]$Bytes) {
    $text=(New-Object Text.UTF8Encoding($false,$true)).GetString($Bytes).TrimStart([char]0xfeff)
    if ($text.Contains([char]0xfffd) -or $text.Contains([char]0)) { throw 'Document: invalid text.' }
    return $text
}

function Get-PortableReadmeSections {
    return @('主な機能','動作環境と起動方法','GVDBマスターデータの取得と取り込み','データと設定の保存場所','バックアップと復元',
        'アプリのフォルダーの移動','更新','削除','旧版からの移行と既存カスタム保存場所','謝辞','License')
}

function Assert-PortableReadme([string]$Text) {
    foreach ($title in (Get-PortableReadmeSections)) {
        if ([regex]::Matches($Text,'(?m)^## '+[regex]::Escape($title)+'\r?$').Count -ne 1) { throw 'README: missing or duplicate section.' }
    }
    foreach ($pattern in @('DOL Progress Manager','Windows[^\r\n]*x64','dol-progress-manager\.exe','ZIP','展開','WebView2',
        'https://developer\.microsoft\.com/en-us/microsoft-edge/webview2/#download-section','data','config','書き込|書き込み',
        '標準','カスタム','バックアップ','更新','移動','削除','手動','オフライン','MIT')) {
        if ($Text -notmatch $pattern) { throw 'README: required guidance missing.' }
    }
    if ($Text -match '(?i)\b(PLACEHOLDER|TODO|TBD)\b') { throw 'README: unfinished guidance.' }
}

function ConvertTo-PortableReadme([byte[]]$MarkdownBytes, [string]$Version='') {
    $markdown=(Get-PortableText $MarkdownBytes).Replace("`r`n","`n")
    if ($markdown -notmatch '^# DOL Progress Manager\n' -or $markdown -match '(?m)^\[[^\]]+\]:|!\[|<[^>]+>|\]\([^)]*\([^)]*\)') { throw 'README: unsupported Markdown.' }
    $blocks=[regex]::Split($markdown,'(?m)(?=^## )')
    $selected=New-Object 'Collections.Generic.List[string]'
    $selected.Add($blocks[0].TrimEnd())
    foreach ($title in (Get-PortableReadmeSections)) {
        $matching=@($blocks | Where-Object { $_ -match ('^## '+[regex]::Escape($title)+'\n') })
        if ($matching.Count -ne 1) { throw 'README: section extraction failed.' }
        $selected.Add($matching[0].TrimEnd())
    }
    $text=$selected -join "`n`n"
    $text=[regex]::Replace($text,'\[([^\]\r\n]+)\]\(([^\s()]+)\)',[Text.RegularExpressions.MatchEvaluator]{ param($m)
        $label=$m.Groups[1].Value; $target=$m.Groups[2].Value
        if ($target -match '^https://') { return $label+' ('+$target+')' }
        if ($target -ceq 'LICENSE') { return $label+' (LICENSE.txt)' }
        if ($target -ceq 'docs/third-party-licenses.md') { return $label+' (THIRD-PARTY-NOTICES.txt)' }
        # Supplementary development references are explicitly identified; no URL is discarded.
        if ($target -match '^docs/[a-z-]+\.md$') { return $label+' (開発資料: '+$target+'、ZIPには含みません)' }
        throw 'README: unresolved link.'
    })
    if ($text -match '\]\(' -or $text -match '(?m)^## (開発と検証|Windows build|仕様書)$') { throw 'README: incomplete conversion.' }
    Assert-PortableReadme $text
    if ($Version -ne '') {
        if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'README: invalid source version.' }
        $text='Application version: '+$Version+"`n`n"+$text
    }
    $body=($text.Replace("`n","`r`n")+"`r`n")
    $encoding=New-Object Text.UTF8Encoding($true)
    return ,([byte[]](@($encoding.GetPreamble())+@($encoding.GetBytes($body))))
}

function Get-PortableGit([string]$Root, [string[]]$Arguments) {
    $preference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $lines=@(& git -C $Root @Arguments 2>$null); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$preference }
    if ($code -ne 0) { throw 'Source: Git check failed.' }
    return $lines
}

function Assert-PortableSourceState([string]$Actual, [string]$Expected, [string[]]$Dirty) {
    if ($Expected -notmatch '^[0-9a-f]{40}$' -or $Actual -cne $Expected -or $Dirty.Count -ne 0) { throw 'Source: clean expected checkpoint required.' }
}

function Assert-PortableVersions([string]$Version, [string]$TauriVersion, [string]$CargoText, [string]$CargoLock, [string[]]$NpmVersions) {
    $packageSection=[regex]::Match($CargoText,'(?ms)^\[package\]\r?\n(.*?)(?=^\[|\z)')
    if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $Version -cne $TauriVersion -or $NpmVersions.Count -ne 2 -or
        $NpmVersions[0] -cne $Version -or $NpmVersions[1] -cne $Version -or
        -not $packageSection.Success -or $packageSection.Groups[1].Value -cnotmatch ('(?m)^version = "'+[regex]::Escape($Version)+'"\r?$') -or
        $CargoLock -cnotmatch ('(?m)^name = "dol-progress-manager"\r?\nversion = "'+[regex]::Escape($Version)+'"\r?$')) { throw 'Source: version mismatch.' }
}

function Get-PortableSource([string]$Root, [string]$Expected) {
    Assert-ReleasePlatform ([Environment]::OSVersion.Platform) $env:PROCESSOR_ARCHITECTURE ([IntPtr]::Size) 'x86_64-pc-windows-msvc'
    Assert-ReleaseNoReparse $Root
    $head=@(Get-PortableGit $Root @('rev-parse','HEAD'))
    Assert-PortableSourceState $head[0] $Expected @(Get-PortableGit $Root @('status','--porcelain','--untracked-files=all'))
    Get-PortableGit $Root @('verify-commit','HEAD') | Out-Null
    $files=@(Get-PortableGit $Root @('ls-files'))
    $hashes=Get-ReleaseInputHashes $Root $files
    $package=Get-PortableText (Read-PortableBytes (Join-Path $Root 'package.json')) | ConvertFrom-Json
    $tauri=Get-PortableText (Read-PortableBytes (Join-Path $Root 'src-tauri/tauri.conf.json')) | ConvertFrom-Json
    $query="const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(p.version);console.log(p.packages[''].version);"
    $preference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $npmVersions=@(& node -e $query (Join-Path $Root 'package-lock.json') 2>$null); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$preference }
    if ($code -ne 0) { throw 'Source: npm lock version unavailable.' }
    Assert-PortableVersions $package.version $tauri.version (Get-PortableText (Read-PortableBytes (Join-Path $Root 'src-tauri/Cargo.toml'))) (Get-PortableText (Read-PortableBytes (Join-Path $Root 'src-tauri/Cargo.lock'))) $npmVersions
    return [pscustomobject]@{Head=$head[0];Version=$package.version;Hashes=$hashes}
}

function Assert-PortableNoticeAvailability([string]$Root) {
    foreach ($name in @('manifest.json','inventory.json','review.json','THIRD-PARTY-NOTICES.txt')) {
        if (-not [IO.File]::Exists((Join-Path $Root ('release/notices/'+$name)))) { throw 'Notices: reviewed inputs unavailable.' }
    }
}

function Assert-PortableCopyrightMapping([string]$Root, $Record, $SourceHashes, [string]$Text) {
    if ($Record.copyrights -isnot [array]) { throw 'Notices: explicit copyright mapping required.' }
    if ($Record.copyrights.Count -gt 0) {
        foreach ($copyright in $Record.copyrights) {
            if ([string]::IsNullOrWhiteSpace($copyright) -or -not $Text.Contains($copyright)) { throw 'Notices: copyright missing.' }
        }
        return
    }
    # Only an explicit, signed source assessment can represent an original with no separate notice.
    # The caller still requires a real REVIEWED record and completed obligations/provenance.
    $assessment=$Record.copyright_review
    if ($null -eq $assessment -or $assessment.state -cne 'NO_SEPARATE_NOTICE_IN_REVIEWED_SOURCES' -or
        [string]::IsNullOrWhiteSpace($assessment.reason) -or $assessment.source_evidence -isnot [array] -or
        $assessment.source_evidence.Count -eq 0) { throw 'Notices: no-owner source assessment absent.' }
    $paths=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($evidence in $assessment.source_evidence) {
        if ($evidence.path -cnotmatch '^release/notices/evidence/[a-zA-Z0-9._-]+\.txt$' -or
            -not $paths.Add($evidence.path) -or -not $SourceHashes.Contains($evidence.path) -or
            @($Record.evidence) -cnotcontains $evidence.path -or $evidence.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Notices: untrusted no-owner assessment.' }
        $bytes=Read-PortableBytes (Join-Path $Root $evidence.path) 16777216
        if ((Get-ReleaseSHA256 $bytes) -cne $evidence.sha256 -or $SourceHashes[$evidence.path] -cne $evidence.sha256 -or
            [string]::IsNullOrWhiteSpace((Get-PortableText $bytes))) { throw 'Notices: no-owner assessment hash mismatch.' }
    }
}

function Read-PortableNotices([string]$Root, [string]$Version, $SourceHashes) {
    Assert-PortableNoticeAvailability $Root
    $raw=@{}
    foreach ($name in @('manifest.json','inventory.json','review.json','THIRD-PARTY-NOTICES.txt')) {
        $relative='release/notices/'+$name
        if (-not $SourceHashes.Contains($relative)) { throw 'Notices: input must be committed.' }
        $raw[$name]=Read-PortableBytes (Join-Path $Root $relative) 16777216
    }
    $manifest=Get-PortableText $raw['manifest.json'] | ConvertFrom-Json
    $inventory=Get-PortableText $raw['inventory.json'] | ConvertFrom-Json
    $review=Get-PortableText $raw['review.json'] | ConvertFrom-Json
    $text=Get-PortableText $raw['THIRD-PARTY-NOTICES.txt']
    if ($manifest.schema -ne 1 -or $manifest.status -cne 'REVIEWED' -or $manifest.scope -cne 'DISTRIBUTION' -or $manifest.test_only -isnot [bool] -or $manifest.test_only -ne $false -or
        $manifest.version -cne $Version -or $manifest.unresolved -isnot [array] -or @($manifest.unresolved).Count -ne 0 -or [string]::IsNullOrWhiteSpace($text) -or
        $text -match '(?i)\b(TEST_ONLY|SYNTHETIC|PLACEHOLDER|TODO|TBD|UNRESOLVED)\b|DRAFT\s+.\s+NOT FOR DISTRIBUTION|LICENSE CLEARANCE INCOMPLETE') { throw 'Notices: unresolved or fixture input.' }
    foreach ($pair in @(@('inventory.json','inventory_sha256'),@('review.json','review_sha256'),@('THIRD-PARTY-NOTICES.txt','notices_sha256'))) {
        if ($manifest.($pair[1]) -cne (Get-ReleaseSHA256 $raw[$pair[0]])) { throw 'Notices: evidence hash mismatch.' }
    }
    if ($manifest.cargo_lock_sha256 -cne $SourceHashes['src-tauri/Cargo.lock'] -or $manifest.npm_lock_sha256 -cne $SourceHashes['package-lock.json'] -or
        $inventory.schema -ne 1 -or $inventory.target -cne 'x86_64-pc-windows-msvc' -or $inventory.version -cne $Version -or
        $review.schema -ne 1 -or $review.status -cne 'REVIEWED' -or $review.version -cne $Version -or $review.test_only -isnot [bool] -or $review.test_only -ne $false -or
        [string]::IsNullOrWhiteSpace($review.reviewer) -or [string]::IsNullOrWhiteSpace($review.reviewed_at) -or $review.unresolved -isnot [array] -or @($review.unresolved).Count -ne 0) { throw 'Notices: incomplete review.' }
    $components=@($inventory.components); $coverage=@($review.coverage)
    if ($components.Count -eq 0 -or $coverage.Count -ne $components.Count) { throw 'Notices: coverage incomplete.' }
    $ids=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($group in @('rust','frontend','native','toolchain','assets')) {
        if (@($components | Where-Object { $_.group -ceq $group }).Count -eq 0) { throw 'Notices: inventory group absent.' }
    }
    foreach ($component in $components) {
        if ([string]::IsNullOrWhiteSpace($component.id) -or -not $ids.Add($component.id) -or [string]::IsNullOrWhiteSpace($component.version) -or $component.included -isnot [bool] -or
            $component.group -cnotin @('rust','frontend','native','toolchain','assets')) { throw 'Notices: invalid component.' }
        $record=@($coverage | Where-Object { $_.id -ceq $component.id })
        if ($record.Count -ne 1 -or $record[0].included -isnot [bool] -or $record[0].included -ne $component.included -or
            $record[0].obligations_completed -isnot [bool] -or $record[0].obligations_completed -ne $true -or
            $record[0].provenance_completed -isnot [bool] -or $record[0].provenance_completed -ne $true -or @($record[0].evidence).Count -eq 0) { throw 'Notices: incomplete component review.' }
        $record=$record[0]
        foreach ($evidence in $record.evidence) { if (-not $SourceHashes.Contains([string]$evidence)) { throw 'Notices: evidence outside signed inputs.' } }
        if (-not $component.included) { if ([string]::IsNullOrWhiteSpace($record.exclusion_reason)) { throw 'Notices: exclusion lacks reason.' }; continue }
        if ([string]::IsNullOrWhiteSpace($record.selected_license) -or @($record.required_texts).Count -eq 0 -or
            $record.source_provision -cnotin @('NOT_REQUIRED','COMPLETE')) { throw 'Notices: required obligations absent.' }
        if ($record.selected_license -match 'MPL' -and ($record.source_provision -cne 'COMPLETE' -or $record.source_url -notmatch '^https://')) { throw 'Notices: source provision incomplete.' }
        foreach ($required in $record.required_texts) {
            if ($required.path -notmatch '^release/notices/texts/[a-zA-Z0-9._-]+\.txt$' -or -not $SourceHashes.Contains($required.path)) { throw 'Notices: untrusted original text.' }
            $original=Read-PortableBytes (Join-Path $Root $required.path) 16777216
            if ((Get-ReleaseSHA256 $original) -cne $required.sha256 -or -not $text.Replace("`r`n","`n").Contains((Get-PortableText $original).Replace("`r`n","`n"))) { throw 'Notices: original text missing.' }
        }
        Assert-PortableCopyrightMapping $Root $record $SourceHashes $text
    }
    return ,$raw['THIRD-PARTY-NOTICES.txt']
}

function Assert-PortableCompileState($Result, $Owner, [string]$Head, [string]$Version, [string]$Id) {
    if ($Owner.schema -ne 1 -or $Owner.run_id -cne $Id -or $Owner.source_head -cne $Head -or $Owner.purpose -cne 'portable release compile validation' -or
        $Result.run_id -cne $Id -or $Result.source_head -cne $Head -or $Result.source_state -cne 'CLEAN_SIGNED_CHECKPOINT' -or @($Result.dirty_paths).Count -ne 0 -or
        $Result.classification -cne 'COMPILE_VALIDATED' -or $Result.exit_code -ne 0 -or $Result.source_bytes_preserved -ne $true -or
        $Result.target -cne 'x86_64-pc-windows-msvc' -or $Result.version -cne $Version -or $Result.build_command -cne 'npm run tauri -- build --no-bundle -- --locked --offline' -or
        $Result.executable.name -cne 'dol-progress-manager.exe' -or $Result.executable.sha256 -notmatch '^[0-9a-f]{64}$' -or $Result.output -cne 'output/dol-progress-manager.exe' -or
        $Result.privacy.pass -ne $true -or $Result.privacy.definite_leak -ne 0 -or $Result.privacy.review_required -ne 0 -or $Result.log_privacy.pass -ne $true -or
        $Result.manifest_guard.before -notmatch '^[0-9a-f]{64}$' -or $Result.manifest_guard.before -cne $Result.manifest_guard.final -or $Result.test_only -eq $true) { throw 'Compile: provenance mismatch.' }
}

function Get-PortableCompile([string]$Root, [string]$Id, $Source, $Prefixes) {
    if ($Id -notmatch '^[0-9a-f]{32}$') { throw 'Compile: invalid run identifier.' }
    $run=Join-Path $Root ('tmp/portable-release/'+$Id)
    Assert-ReleaseContained $Root $run; Assert-ReleaseNoReparse $run
    $owner=Get-PortableText (Read-PortableBytes (Join-Path $run 'ownership.json')) | ConvertFrom-Json
    $result=Get-PortableText (Read-PortableBytes (Join-Path $run 'result.json')) | ConvertFrom-Json
    Assert-PortableCompileState $result $owner $Source.Head $Source.Version $Id
    $noticeManifest=Get-PortableText (Read-PortableBytes (Join-Path $Root 'release/notices/manifest.json')) | ConvertFrom-Json
    $toolchainText=@()
    foreach ($name in @('rustc','cargo','node','npm','tauri_cli','powershell')) {
        $value=@($result.toolchain.$name)
        if ($value.Count -eq 0 -or [string]::IsNullOrWhiteSpace(($value -join "`n"))) { throw 'Compile: toolchain metadata absent.' }
        $toolchainText+=($name+'='+($value -join "`n"))
    }
    $toolchainHash=Get-ReleaseSHA256 ([Text.Encoding]::UTF8.GetBytes(($toolchainText -join "`n")+"`n"))
    if ($noticeManifest.toolchain_sha256 -cne $toolchainHash) { throw 'Notices: compile toolchain was not reviewed.' }
    $hashes=[ordered]@{}
    foreach ($entry in $result.input_hashes.PSObject.Properties) { $hashes[$entry.Name]=$entry.Value }
    Assert-ReleaseInputHashes $Source.Hashes $hashes
    $Prefixes['CompileRoot']=$run
    $output=Join-Path $run 'output/dol-progress-manager.exe'
    $target=Join-Path $run 'target/release/dol-progress-manager.exe'
    $bytes=Read-PortableBytes $output 67108864
    if ((Get-ReleaseSHA256 $bytes) -cne $result.executable.sha256 -or (Get-ReleaseSHA256 (Read-PortableBytes $target 67108864)) -cne $result.executable.sha256) { throw 'Compile: artifact hash mismatch.' }
    if ([IO.File]::GetLastWriteTimeUtc($target) -lt [IO.File]::GetCreationTimeUtc((Join-Path $run 'ownership.json'))) { throw 'Compile: artifact predates run.' }
    Assert-ReleasePrivacy (Test-PrivacyArtifact $output $Prefixes 'compile-exe')
    Assert-ReleasePrivacy (Test-PrivacyArtifact (Join-Path $run 'logs/compile.txt') $Prefixes 'compile-log')
    return ,$bytes
}

function New-PortablePackageRun([string]$Root, [string]$Head, [string]$CompileId) {
    $base=Join-Path $Root 'tmp/portable-release'
    Assert-ReleaseContained $Root $base; Assert-ReleaseNoReparse $base
    Get-PortableGit $Root @('check-ignore','--quiet','--','tmp/portable-release/ownership.json') | Out-Null
    if (-not [IO.Directory]::Exists($base)) { New-Item -ItemType Directory -Path $base -ErrorAction Stop | Out-Null }
    $id=[Guid]::NewGuid().ToString('N'); $path=Join-Path $base $id
    New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
    Assert-ReleaseNoReparse $path
    Write-ReleaseNewText (Join-Path $path 'ownership.json') (([ordered]@{schema=1;run_id=$id;source_head=$Head;compile_run_id=$CompileId;purpose='portable package verification'} | ConvertTo-Json)+"`n")
    foreach ($name in @('staging','verify','logs','output')) { New-Item -ItemType Directory -Path (Join-Path $path $name) -ErrorAction Stop | Out-Null }
    return [pscustomobject]@{Id=$id;Path=$path;Staging=(Join-Path $path 'staging');Verify=(Join-Path $path 'verify');Logs=(Join-Path $path 'logs');Output=(Join-Path $path 'output')}
}

function New-PortableStaging([string]$Root, $Payload) {
    $names=@('LICENSE.txt','README.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe')
    if ($Payload.Count -ne 4 -or (Compare-Object $names @($Payload.Keys))) { throw 'Staging: exact payload required.' }
    Assert-ReleaseNoReparse $Root
    New-Item -ItemType Directory -Path $Root -ErrorAction Stop | Out-Null
    $hashes=[ordered]@{}
    foreach ($name in $names) { Write-PortableBytes $Root (Join-Path $Root $name) $Payload[$name]; $hashes[$name]=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $Root $name)) }
    $manifest=($names | ForEach-Object { $hashes[$_]+'  '+$_ }) -join "`n"
    Write-PortableBytes $Root (Join-Path $Root 'SHA256SUMS.txt') ([Text.Encoding]::UTF8.GetBytes($manifest+"`n"))
    $hashes['SHA256SUMS.txt']=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $Root 'SHA256SUMS.txt'))
    return $hashes
}

function Write-PortableZip([string]$Staging, [string]$Path) {
    # The verifier owns its own allowlist and does not import this member list.
    $names=@('LICENSE.txt','README.txt','SHA256SUMS.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe')
    $actual=@(Get-ChildItem -LiteralPath $Staging -Force | ForEach-Object { $_.Name })
    if (Compare-Object $names $actual) { throw 'Staging: unexpected file.' }
    Assert-ReleaseNoReparse $Path
    $stream=[IO.File]::Open($Path,'CreateNew','ReadWrite','None')
    try {
        $zip=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$true,(New-Object Text.UTF8Encoding($false)))
        try {
            foreach ($name in $names) {
                $bytes=Read-PortableBytes (Join-Path $Staging $name)
                $entry=$zip.CreateEntry('DOL-Progress-Manager/'+$name,[IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime=New-Object DateTimeOffset(1980,1,1,0,0,0,[TimeSpan]::Zero)
                $entry.ExternalAttributes=0
                $writer=$entry.Open()
                try { $writer.Write($bytes,0,$bytes.Length) } finally { $writer.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }
}

function Assert-PortableSourceUnchanged([string]$Root, $Source) {
    Assert-PortableSourceState (@(Get-PortableGit $Root @('rev-parse','HEAD'))[0]) $Source.Head @(Get-PortableGit $Root @('status','--porcelain','--untracked-files=all'))
    Assert-ReleaseInputHashes $Source.Hashes (Get-ReleaseInputHashes $Root @(Get-PortableGit $Root @('ls-files')))
}
