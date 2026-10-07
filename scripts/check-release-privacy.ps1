#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string[]]$Path)

$ErrorActionPreference = 'Stop'
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows release checker only.' }
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    function Get-PrivacyDirectory([string]$value, [string]$category) {
        if ([string]::IsNullOrWhiteSpace($value)) { throw "$category could not be resolved." }
        $full = if ([IO.Path]::IsPathRooted($value)) { [IO.Path]::GetFullPath($value) } else { [IO.Path]::GetFullPath((Join-Path $repoRoot $value)) }
        if ([IO.Path]::IsPathRooted($value) -and $value -cne $full) { throw "$category requires a full Windows path with its exact spelling." }
        if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "$category directory does not exist: $full" }
        return $full
    }
    $profilePath = $env:USERPROFILE
    if ([string]::IsNullOrEmpty($profilePath)) { $profilePath = [Environment]::GetFolderPath('UserProfile') }
    $cargoPath = $env:CARGO_HOME
    if ([string]::IsNullOrEmpty($cargoPath)) { $cargoPath = Join-Path $profilePath '.cargo' }
    $rustupPath = $env:RUSTUP_HOME
    if ([string]::IsNullOrEmpty($rustupPath)) {
        $homeOutput = @(& rustup show home)
        if ($LASTEXITCODE -ne 0 -or $homeOutput.Count -ne 1) { throw 'rustup show home failed.' }
        $rustupPath = $homeOutput[0]
    }
    $prefixes = [ordered]@{
        CargoHome = Get-PrivacyDirectory $cargoPath 'CARGO_HOME'
        RustupHome = Get-PrivacyDirectory $rustupPath 'RUSTUP_HOME'
        Repository = Get-PrivacyDirectory $repoRoot 'Repository'
        UserProfile = Get-PrivacyDirectory $profilePath 'UserProfile'
    }
    $byteEncoding = [Text.Encoding]::GetEncoding(28591)
    $encodings = [ordered]@{ 'UTF8-bytes' = [Text.Encoding]::UTF8; 'UTF16LE-bytes' = [Text.Encoding]::Unicode }
    $total = 0
    foreach ($file in $Path) {
        $resolved = (Resolve-Path -LiteralPath $file).ProviderPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Not a file: $resolved" }
        # Latin-1 preserves every byte. Encoding the prefix first also handles non-ASCII homes.
        $text = $byteEncoding.GetString([IO.File]::ReadAllBytes($resolved))
        foreach ($category in $prefixes.Keys) {
            foreach ($encoding in $encodings.Keys) {
                $needle = $byteEncoding.GetString($encodings[$encoding].GetBytes($prefixes[$category]))
                $count = 0
                $offset = 0
                while (($offset = $text.IndexOf($needle, $offset, [StringComparison]::Ordinal)) -ge 0) {
                    $count++
                    $offset += $needle.Length
                }
                $total += $count
                Write-Output "File=$resolved Category=$category Encoding=$encoding Count=$count"
            }
        }
        foreach ($virtual in @('/cargo','/rustup')) {
            $count = 0; $offset = 0
            while (($offset = $text.IndexOf($virtual, $offset, [StringComparison]::Ordinal)) -ge 0) { $count++; $offset += $virtual.Length }
            Write-Output "File=$resolved InformationalVirtualPrefix=$virtual Count=$count"
        }
    }
    Write-Output "Host-sensitive findings=$total"
    if ($total -gt 0) { exit 1 }
    exit 0
} catch {
    [Console]::Error.WriteLine("Privacy check failed: " + $_.Exception.Message)
    exit 1
}
