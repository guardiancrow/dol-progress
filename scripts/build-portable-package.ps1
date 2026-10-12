#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedSourceHead,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{32}$')][string]$CompileRunId
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'verify-portable-package.ps1') -ExpectedSourceHead $ExpectedSourceHead -CompileRunId $CompileRunId
$run=$null; $source=$null; $gate='Notices'; $exitCode=1; $verified=$null
try {
    if ($MyInvocation.InvocationName -eq '.') { throw 'Invocation: script required.' }
    $root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    # No owned run or ZIP is created before genuine notice inputs and signed source pass.
    Assert-PortableNoticeAvailability $root
    $gate='Source'; $source=Get-PortableSource $root $ExpectedSourceHead
    $gate='Notices'; $notices=Read-PortableNotices $root $source.Version $source.Hashes
    $prefixes=Get-PrivacyPrefixes $root ''
    $gate='Compile'; $exe=Get-PortableCompile $root $CompileRunId $source $prefixes
    $gate='Documents'
    $payload=[ordered]@{
        'LICENSE.txt'=(Read-PortableBytes (Join-Path $root 'LICENSE') 2097152)
        'README.txt'=(ConvertTo-PortableReadme (Read-PortableBytes (Join-Path $root 'README.md') 2097152) $source.Version)
        'THIRD-PARTY-NOTICES.txt'=$notices
        'dol-progress-manager.exe'=$exe
    }
    [PortableZipVerifier]::Pe($exe,$source.Version)
    $run=New-PortablePackageRun $root $source.Head $CompileRunId
    $prefixes['PackageRoot']=$run.Path
    $staging=Join-Path $run.Staging 'DOL-Progress-Manager'
    $gate='Staging'; $hashes=New-PortableStaging $staging $payload
    foreach ($name in $hashes.Keys) { Assert-ReleasePrivacy (Test-PrivacyArtifact (Join-Path $staging $name) $prefixes ('staged-'+[Array]::IndexOf([string[]]@($hashes.Keys),$name))) }
    if ($hashes['LICENSE.txt'] -cne $source.Hashes['LICENSE']) { throw 'LICENSE: copy mismatch.' }
    $gate='Archive'
    $basename='DOL-Progress-Manager_'+$source.Version+'_windows-x64_portable.zip'
    $candidate=Join-Path $run.Verify $basename
    Write-PortableZip $staging $candidate
    $gate='Verification'
    $verified=Test-PortableArchive $candidate '' (Join-Path $run.Verify 'extracted') $hashes $source.Version $payload $prefixes
    # External hash is only created after close, decompression/CRC and independent verification.
    $externalPath=$candidate+'.sha256'
    Write-PortableBytes $run.Path $externalPath ([Text.Encoding]::UTF8.GetBytes($verified.sha256+'  '+$basename+"`n"))
    if ((Get-ReleaseSHA256 (Read-PortableBytes $candidate)) -cne $verified.sha256) { throw 'Archive: changed after verification.' }
    $externalText=(New-Object Text.UTF8Encoding($false,$true)).GetString((Read-PortableBytes $externalPath 4096))
    if ($externalText -cne ($verified.sha256+'  '+$basename+"`n")) { throw 'Archive: external hash mismatch.' }
    $log=Join-Path $run.Logs 'package.txt'
    Write-ReleaseNewText $log "FixedMembers=5 CRCVerified=5 ExtractedHashes=5 Privacy=PASS LicenseEvidence=REVIEWED`n"
    $namesLog=Join-Path $run.Logs 'member-names.txt'
    Write-ReleaseNewText $namesLog ((@('LICENSE.txt','README.txt','SHA256SUMS.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe') | ForEach-Object { 'DOL-Progress-Manager/'+$_ }) -join "`n")
    Assert-ReleasePrivacy (Test-PrivacyArtifact $namesLog $prefixes 'member-names')
    Assert-ReleasePrivacy (Test-PrivacyArtifact $log $prefixes 'generation-log')
    Assert-ReleasePrivacy (Test-PrivacyArtifact $externalPath $prefixes 'external-manifest')
    Assert-PortableSourceUnchanged $root $source
    $gate='Output'
    foreach ($name in @($basename, ($basename + '.sha256'))) {
        $from=Join-Path $run.Verify $name; $to=Join-Path $run.Output $name
        Assert-ReleaseContained $run.Path $to; Assert-ReleaseNoReparse $to
        [IO.File]::Copy($from,$to,$false)
        if ((Get-ReleaseSHA256 (Read-PortableBytes $from)) -cne (Get-ReleaseSHA256 (Read-PortableBytes $to))) { throw 'Output: copy mismatch.' }
    }
    $exitCode=0
} catch { [Console]::Error.WriteLine("Portable package FAILED Gate=$gate") }
finally {
    if ($null -ne $source) {
        try { Assert-PortableSourceUnchanged $root $source }
        catch { $exitCode=1; $gate='Source'; [Console]::Error.WriteLine('Portable package FAILED Gate=Source') }
    }
}
if ($null -ne $run) {
    try {
        $result=[ordered]@{classification='FAILED';source_head=$source.Head;version=$source.Version;compile_run_id=$CompileRunId;package_run_id=$run.Id;gate=$gate;exit_code=$exitCode;public_release='NOT_AUTHORIZED'}
        if ($exitCode -eq 0) { $result.classification='PACKAGE_VERIFIED'; $result['zip']=$basename; $result['zip_sha256']=$verified.sha256; $result['license_evidence']='REVIEWED'; $result['staged_hashes']=$hashes }
        Write-ReleaseNewText (Join-Path $run.Path 'result.json') (($result | ConvertTo-Json -Depth 5)+"`n")
        Write-Output "PackageRun=$($run.Id) Classification=$($result.classification) PublicRelease=NOT_AUTHORIZED"
    } catch { $exitCode=1; [Console]::Error.WriteLine('Portable package FAILED Gate=Result') }
}
exit $exitCode
