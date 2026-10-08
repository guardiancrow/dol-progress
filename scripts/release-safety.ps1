#Requires -Version 5.1
# Shared guards have no build/test switch; the entry scripts always run their checks.
function Get-ReleaseSHA256([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Assert-ReleasePlatform($Platform, [string]$Architecture, [int]$PointerSize, [string]$RustHost) {
    if ($Platform -ne [PlatformID]::Win32NT) { throw 'Platform: Windows required.' }
    if ($Architecture -ne 'AMD64' -or $PointerSize -ne 8) { throw 'Architecture: x64 process required.' }
    if ($RustHost -ne 'x86_64-pc-windows-msvc') { throw 'Toolchain: Windows x64 MSVC required.' }
}

function Assert-ReleaseSource([string]$ActualHead, [string]$ExpectedHead, [string[]]$DirtyPaths, [string[]]$StagedPaths) {
    if ($ExpectedHead -notmatch '^[0-9a-f]{40}$' -or $ActualHead -cne $ExpectedHead) { throw 'Source: HEAD mismatch.' }
    if ($StagedPaths.Count -gt 0) { throw 'Source: staged changes are not accepted for compile validation.' }
    $allowed = @('scripts/build-release.ps1', 'scripts/check-release-privacy.ps1', 'scripts/release-safety.ps1',
        'scripts/tests/release-tooling.tests.ps1', 'docs/release-build.md', 'src-tauri/tauri.conf.json')
    foreach ($file in $DirtyPaths) {
        if ($allowed -cnotcontains $file) { throw 'Source: changes outside compile tooling scope.' }
    }
}

function Assert-ReleaseCli([string]$Version, [string]$LockedVersion, [string]$Help) {
    if ($Version -notmatch '^2\.11\.\d+$' -or $Version -cne $LockedVersion -or $Help -notmatch '--no-bundle') {
        throw 'CLI: locked Tauri 2.11.x with no-bundle support required.'
    }
}

function Get-ReleaseDirectory([string]$Value, [string]$Category, [string]$RepoRoot) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '[\x00-\x1f]') { throw "$Category`: invalid directory." }
    $full = if ([IO.Path]::IsPathRooted($Value)) { [IO.Path]::GetFullPath($Value) } else { [IO.Path]::GetFullPath((Join-Path $RepoRoot $Value)) }
    if ([IO.Path]::IsPathRooted($Value) -and $Value -cne $full) { throw "$Category`: canonical Windows spelling required." }
    if (-not [IO.Directory]::Exists($full)) { throw "$Category`: directory unavailable." }
    return $full
}

function Assert-ReleaseContained([string]$Root, [string]$Child) {
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath($Child)
    if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Ownership: path outside generated root.' }
}

function Assert-ReleaseNoReparse([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrEmpty($cursor)) {
        # Check the link itself, including a dangling link; do not follow a directory enumeration.
        try { $attributes = [IO.File]::GetAttributes($cursor) }
        catch [IO.FileNotFoundException] { $attributes = 0 }
        catch [IO.DirectoryNotFoundException] { $attributes = 0 }
        catch { throw 'Ownership: ancestor attributes unavailable.' }
        if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Ownership: reparse point rejected.' }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}

function Write-ReleaseNewText([string]$Path, [string]$Text) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($Text)
        $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
}

function New-ReleaseRun([string]$RepoRoot, [string]$Head) {
    $root = Join-Path $RepoRoot 'tmp\portable-release'
    Assert-ReleaseContained $RepoRoot $root
    Assert-ReleaseNoReparse $root
    & git -C $RepoRoot check-ignore --quiet -- 'tmp/portable-release/ownership.json'
    if ($LASTEXITCODE -ne 0) { throw 'Ownership: run root must be Git ignored.' }
    if (-not [IO.Directory]::Exists($root)) { New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null }
    Assert-ReleaseNoReparse $root
    $id = [Guid]::NewGuid().ToString('N')
    $run = Join-Path $root $id
    Assert-ReleaseContained $root $run
    # New-Item without Force rejects an existing run rather than reusing its cache/artifacts.
    New-Item -ItemType Directory -Path $run -ErrorAction Stop | Out-Null
    Assert-ReleaseNoReparse $run
    Write-ReleaseNewText (Join-Path $run 'ownership.json') (([ordered]@{ schema=1; run_id=$id; source_head=$Head; purpose='portable release compile validation' } | ConvertTo-Json) + "`n")
    foreach ($name in @('target','logs','output','temp')) {
        $child = Join-Path $run $name
        Assert-ReleaseContained $run $child
        New-Item -ItemType Directory -Path $child -ErrorAction Stop | Out-Null
    }
    return [pscustomobject]@{ Id=$id; Path=$run; Target=(Join-Path $run 'target'); Logs=(Join-Path $run 'logs'); Output=(Join-Path $run 'output'); Temp=(Join-Path $run 'temp') }
}

function Restore-ReleaseManifest([string]$Path, [byte[]]$Original) {
    $before = Get-ReleaseSHA256 $Original
    $after = [IO.File]::ReadAllBytes($Path)
    $afterHash = Get-ReleaseSHA256 $after
    $restored = $false
    if ($afterHash -cne $before) {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        if ($utf8.GetString($Original).Replace("`r`n", "`n") -cne $utf8.GetString($after).Replace("`r`n", "`n")) {
            throw 'Manifest: content changed; left untouched for review.'
        }
        [IO.File]::WriteAllBytes($Path, $Original)
        $restored = $true
    }
    $final = Get-ReleaseSHA256 ([IO.File]::ReadAllBytes($Path))
    if ($final -cne $before) { throw 'Manifest: original bytes not preserved.' }
    return [pscustomobject]@{ before=$before; after_build=$afterHash; final=$final; eol_restored=$restored }
}

function Get-ReleaseInputHashes([string]$RepoRoot, [string[]]$Files) {
    $result = [ordered]@{}
    foreach ($file in ($Files | Sort-Object -Unique)) {
        if ([IO.Path]::IsPathRooted($file) -or $file -match '(^|/)\.\.(/|$)') { throw 'Source: unexpected input path.' }
        $full = Join-Path $RepoRoot $file
        Assert-ReleaseContained $RepoRoot $full
        Assert-ReleaseNoReparse $full
        $result[$file] = Get-ReleaseSHA256 ([IO.File]::ReadAllBytes($full))
    }
    return $result
}

function Assert-ReleaseInputHashes($Before, $After) {
    if ($Before.Count -ne $After.Count) { throw 'Source: input inventory changed.' }
    foreach ($file in $Before.Keys) {
        if (-not $After.Contains($file) -or $Before[$file] -cne $After[$file]) { throw 'Source: input bytes changed during build.' }
    }
}

function Get-PrivacyPrefixes([string]$RepoRoot, [string]$BuildRoot) {
    $profile = [Environment]::GetEnvironmentVariable('USERPROFILE', 'Process')
    if ([string]::IsNullOrEmpty($profile)) { $profile = [Environment]::GetFolderPath('UserProfile') }
    $cargo = $env:CARGO_HOME
    if ([string]::IsNullOrEmpty($cargo)) { $cargo = Join-Path $profile '.cargo' }
    $rustup = $env:RUSTUP_HOME
    if ([string]::IsNullOrEmpty($rustup)) {
        $home = @(& rustup show home 2>$null)
        if ($LASTEXITCODE -ne 0 -or $home.Count -ne 1) { throw 'RustupHome: resolution failed.' }
        $rustup = $home[0]
    }
    $prefixes = [ordered]@{
        CargoHome=(Get-ReleaseDirectory $cargo 'CargoHome' $RepoRoot)
        RustupHome=(Get-ReleaseDirectory $rustup 'RustupHome' $RepoRoot)
        Repository=(Get-ReleaseDirectory $RepoRoot 'Repository' $RepoRoot)
        UserProfile=(Get-ReleaseDirectory $profile 'UserProfile' $RepoRoot)
    }
    foreach ($name in @('TEMP','TMP')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrEmpty($value)) { $prefixes[$name] = Get-ReleaseDirectory $value $name $RepoRoot }
    }
    if (-not [string]::IsNullOrEmpty($BuildRoot)) { $prefixes['BuildRoot'] = Get-ReleaseDirectory $BuildRoot 'BuildRoot' $RepoRoot }
    return $prefixes
}

function Get-PrivacyForms([string]$Prefix) {
    $forward = $Prefix.Replace('\', '/')
    $back = $Prefix.Replace('/', '\')
    return @($Prefix, $forward, $back, $back.Replace('\', '\\'), $forward.Replace('/', '\/'),
        $back.Replace('\', '\u005c'), [Uri]::EscapeDataString($forward), [Uri]::EscapeDataString($back)) | Select-Object -Unique
}

function Protect-ReleaseText([string]$Text, $Prefixes) {
    $clean = [regex]::Replace($Text, '\x1b\[[0-9;]*[A-Za-z]', '')
    foreach ($category in ($Prefixes.Keys | Sort-Object { $Prefixes[$_].Length } -Descending)) {
        foreach ($form in (Get-PrivacyForms $Prefixes[$category])) {
            $clean = [regex]::Replace($clean, [regex]::Escape($form), ('{' + $category + '}'), [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
    }
    $clean = [regex]::Replace($clean, '(?i)(?<![A-Za-z0-9])(?:[A-Z]:[\\/]|\\\\)[^\r\n"<>|]*', '{HOST_PATH}')
    $clean = [regex]::Replace($clean, '(?i)\b([A-Z0-9_]*(?:TOKEN|PASSWORD|SECRET|PRIVATE_KEY)[A-Z0-9_]*)=[^\s]+', '$1={REDACTED}')
    return $clean
}

function Write-ReleaseLogLine($Writer, [string]$Text, $Prefixes) {
    $ErrorActionPreference = 'Stop'
    try {
        $line = Protect-ReleaseText $Text $Prefixes
        $Writer.WriteLine($line)
        Write-Host $line
    } catch { throw 'Log: sanitized output could not be written.' }
}

function Get-ReleaseRemapTokens($Prefixes) {
    $virtual = @{ CargoHome='/cargo'; RustupHome='/rustup'; Repository='/source'; UserProfile='/user'; TEMP='/temp'; TMP='/temp'; BuildRoot='/build'; Target='/target'; BuildTemp='/build-temp' }
    $tokens = New-Object 'Collections.Generic.List[string]'
    # rustc uses the last matching mapping, so more specific paths must come last.
    foreach ($category in ($Prefixes.Keys | Sort-Object { $Prefixes[$_].Length })) {
        foreach ($form in @($Prefixes[$category], $Prefixes[$category].Replace('\', '/')) | Select-Object -Unique) {
            $tokens.Add('--remap-path-prefix'); $tokens.Add($form + '=' + $virtual[$category])
        }
    }
    # This changes only the locator embedded by MSVC link.exe, not the actual PDB output path.
    $tokens.Add('-C'); $tokens.Add('link-arg=/PDBALTPATH:%_PDB%')
    return $tokens.ToArray()
}

function Test-PrivacyArtifact([string]$Path, $Prefixes, [string]$ArtifactId) {
    $counts = New-Object 'Collections.Generic.List[object]'
    $total = 0
    $review = 0
    $generic = 0
    $bytes = [IO.File]::ReadAllBytes($Path)
    $latin = [Text.Encoding]::GetEncoding(28591)
    $view = $latin.GetString($bytes)
    $encodings = [ordered]@{ UTF8=[Text.Encoding]::UTF8; UTF16LE=[Text.Encoding]::Unicode }
    foreach ($category in $Prefixes.Keys) {
        foreach ($encoding in $encodings.Keys) {
            $offsets = New-Object 'Collections.Generic.HashSet[int]'
            foreach ($form in (Get-PrivacyForms $Prefixes[$category])) {
                foreach ($caseForm in @($form, $form.ToUpperInvariant(), $form.ToLowerInvariant()) | Select-Object -Unique) {
                    $needle = $latin.GetString($encodings[$encoding].GetBytes($caseForm))
                    $offset = 0
                    while (($offset = $view.IndexOf($needle, $offset, [StringComparison]::OrdinalIgnoreCase)) -ge 0) {
                        [void]$offsets.Add($offset); $offset += $needle.Length
                    }
                }
            }
            # Normalizing each separator detects mixed slash/backslash representations as well.
            $slashView = $view.Replace('\', '/')
            $needle = $latin.GetString($encodings[$encoding].GetBytes($Prefixes[$category].Replace('\', '/')))
            $offset = 0
            while (($offset = $slashView.IndexOf($needle, $offset, [StringComparison]::OrdinalIgnoreCase)) -ge 0) { [void]$offsets.Add($offset); $offset += $needle.Length }
            $counts.Add([pscustomobject]@{ category=$category; encoding=$encoding; count=$offsets.Count })
            $total += $offsets.Count
        }
    }
    # These heuristics are deliberately narrower than arbitrary drive-like machine bytes.
    $views = @($view, [Text.Encoding]::Unicode.GetString($bytes))
    if ($bytes.Length -gt 1) { $views += [Text.Encoding]::Unicode.GetString($bytes, 1, $bytes.Length - 1) }
    foreach ($text in $views) {
        foreach ($match in [regex]::Matches($text, '(?i)(?<![A-Za-z0-9])(?:[A-Z]:[\\/]|\\\\[A-Za-z0-9._-]+[\\/])[A-Za-z0-9_.\\/ ()-]{3,240}')) {
            $candidate = $match.Value.TrimEnd(' ', '.', ')')
            $known = $false
            foreach ($category in $Prefixes.Keys) {
                if ($candidate.Replace('\', '/').IndexOf($Prefixes[$category].Replace('\', '/'), [StringComparison]::OrdinalIgnoreCase) -ge 0) { $known=$true; break }
            }
            if ($known) { continue }
            # NUL is a fixed Windows null device, not a server/share or developer-specific name.
            if ($candidate -match '(?i)^[A-Z]:[\\/]Windows[\\/](System32|SysWOW64)[\\/][A-Za-z0-9_.-]+\.dll$' -or $candidate -match '(?i)^\\\\\.\\NUL$') { $generic++ }
            else { $review++ }
        }
    }
    $virtual = @()
    foreach ($prefix in @('/cargo','/rustup','/source','/build','/target')) {
        $virtual += [pscustomobject]@{ prefix=$prefix; count=[regex]::Matches($view, [regex]::Escape($prefix)).Count }
    }
    return [pscustomobject]@{ artifact=$ArtifactId; definite_leak=$total; review_required=$review; allowed_generic_path=$generic; counts=$counts.ToArray(); virtual=$virtual; pass=($total -eq 0 -and $review -eq 0); scope='Known current-host prefixes and printable Windows path heuristics; not a secrets/malware guarantee.' }
}

function Assert-ReleasePrivacy($Result) {
    if (-not $Result.pass) { throw 'Privacy: definite leak or unresolved path review.' }
}

function Get-ReleasePe([string]$Path) {
    if ([IO.Path]::GetFileName($Path) -cne 'dol-progress-manager.exe') { throw 'Artifact: unexpected executable name.' }
    $b = [IO.File]::ReadAllBytes($Path)
    if ($b.Length -lt 256 -or $b[0] -ne 0x4d -or $b[1] -ne 0x5a) { throw 'Artifact: missing or invalid EXE.' }
    $pe = [BitConverter]::ToInt32($b, 60)
    if ($pe -lt 64 -or $pe + 96 -gt $b.Length -or [BitConverter]::ToUInt32($b, $pe) -ne 0x4550) { throw 'Artifact: invalid PE header.' }
    $machine = [BitConverter]::ToUInt16($b, $pe + 4)
    $magic = [BitConverter]::ToUInt16($b, $pe + 24)
    $subsystem = [BitConverter]::ToUInt16($b, $pe + 92)
    if ($machine -ne 0x8664 -or $magic -ne 0x20b -or $subsystem -ne 2) { throw 'Artifact: Windows x64 GUI required.' }
    return [pscustomobject]@{ name='dol-progress-manager.exe'; size=$b.Length; machine='AMD64'; format='PE32+'; subsystem='GUI'; sha256=(Get-ReleaseSHA256 $b) }
}

function Assert-ReleaseOutput([string]$Target, [string]$Exe) {
    $expected = Join-Path $Target 'release\dol-progress-manager.exe'
    if ([IO.Path]::GetFullPath($Exe) -cne [IO.Path]::GetFullPath($expected)) { throw 'Artifact: unexpected output location.' }
    Assert-ReleaseNoReparse $Exe
    foreach ($name in @('bundle','data','config')) {
        if (Test-Path -LiteralPath (Join-Path $Target ('release\' + $name))) { throw 'Artifact: unexpected bundle or application data output.' }
    }
    return Get-ReleasePe $Exe
}

function Assert-ReleaseChildExit([int]$Code, [string]$Stage) {
    if ($Code -ne 0) {
        $errorRecord = New-Object InvalidOperationException("$Stage`: child command failed (exit $Code).")
        $errorRecord.Data['ExitCode'] = $Code
        throw $errorRecord
    }
}
