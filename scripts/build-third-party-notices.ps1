#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$InputManifest,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
$exitCode=1
try {
    . (Join-Path $PSScriptRoot 'third-party-notices.ps1')
    $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $manifest=[IO.Path]::GetFullPath($InputManifest)
    $output=[IO.Path]::GetFullPath($OutputDirectory)
    $result=Invoke-NoticeDraftAssembly $root $manifest $output
    Write-Output ("NoticeAssembly=DRAFT Candidates="+$result.coverage.candidates+" Texts="+$result.coverage.distinct_raw_texts+" PublicRelease=NO_GO")
    $exitCode=0
} catch { [Console]::Error.WriteLine('Notice assembly FAILED; inputs or output guard rejected. No formal clearance.') }
exit $exitCode
