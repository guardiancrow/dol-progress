#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string[]]$Path,
    [string]$BuildRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-safety.ps1')
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Platform: Windows privacy checker required.' }
    $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $prefixes = Get-PrivacyPrefixes $repoRoot $BuildRoot
    $exitCode = 0
    $id = 0
    foreach ($file in $Path) {
        $id++
        # Numeric artifact IDs avoid echoing supplied paths, including read errors.
        $result = Test-PrivacyArtifact $file $prefixes "artifact-$id"
        foreach ($record in $result.counts) { Write-Output "Artifact=artifact-$id Category=$($record.category) Encoding=$($record.encoding) Count=$($record.count)" }
        foreach ($record in $result.virtual) { Write-Output "Artifact=artifact-$id Virtual=$($record.prefix) Count=$($record.count)" }
        Write-Output "Artifact=artifact-$id DefiniteLeak=$($result.definite_leak) ReviewRequired=$($result.review_required) AllowedGeneric=$($result.allowed_generic_path) Pass=$($result.pass)"
        if (-not $result.pass) { $exitCode=1 }
    }
    exit $exitCode
} catch {
    # Exception text may contain an inaccessible file's full host path; never echo it.
    [Console]::Error.WriteLine('Privacy check failed: artifact or prefix could not be inspected.')
    exit 1
}
