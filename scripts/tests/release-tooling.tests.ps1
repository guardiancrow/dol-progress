#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\release-safety.ps1')
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixtureRoot = Join-Path $repo ('tmp\release-tooling-tests\' + [Guid]::NewGuid().ToString('N'))
Assert-ReleaseContained $repo $fixtureRoot
Assert-ReleaseNoReparse $fixtureRoot
New-Item -ItemType Directory -Path $fixtureRoot -ErrorAction Stop | Out-Null
$script:passed = 0
$script:failed = 0
function Assert-True($Value) { if (-not $Value) { throw 'Assertion failed.' } }
function Assert-Rejected([scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected=$true }
    Assert-True $rejected
}
function Test-Case([string]$Name, [scriptblock]$Action) {
    try { & $Action; $script:passed++; Write-Output "PASS $Name" }
    catch { $script:failed++; Write-Output "FAIL $Name" }
}
function Invoke-TestScript([string]$Script, [string[]]$Arguments, $Environment) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $PSHOME 'powershell.exe'
    if (-not [IO.File]::Exists($info.FileName)) { $info.FileName = (Get-Process -Id $PID).Path }
    $info.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Script + '" ' + (($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    if ($null -ne $Environment) { foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name]=$Environment[$name] } }
    $process = New-Object Diagnostics.Process
    $process.StartInfo=$info
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{ code=$process.ExitCode; text=$stdout.Result + $stderr.Result }
    } finally { $process.Dispose() }
}
$synthetic = [ordered]@{ CargoHome='Q:\Synthetic\Cargo-A'; RustupHome='Q:\Synthetic\Rustup-B'; UserProfile='Q:\Synthetic\Profile-C'; Repository='R:\Fixture\Source-D' }
$script:fixtureId = 0
function Scan-Fixture([string]$Text, [string]$Encoding='UTF8', [switch]$Odd) {
    $script:fixtureId++
    $file = Join-Path $fixtureRoot ('bytes-' + $script:fixtureId + '.bin')
    $enc = if ($Encoding -eq 'UTF16LE') { [Text.Encoding]::Unicode } else { [Text.Encoding]::UTF8 }
    $bytes=$enc.GetBytes($Text)
    if ($Odd) { $bytes=[byte[]](@(255) + $bytes) }
    [IO.File]::WriteAllBytes($file,$bytes)
    return Test-PrivacyArtifact $file $synthetic 'synthetic-fixture'
}

Test-Case 'Cargo UTF8 regression' { Assert-True ((Scan-Fixture $synthetic.CargoHome).definite_leak -gt 0) }
Test-Case 'Rustup UTF8 regression' { Assert-True ((Scan-Fixture $synthetic.RustupHome).definite_leak -gt 0) }
Test-Case 'UTF16LE regression' { Assert-True ((Scan-Fixture $synthetic.CargoHome 'UTF16LE').definite_leak -gt 0) }
Test-Case 'UTF16LE unaligned regression' { Assert-True ((Scan-Fixture $synthetic.RustupHome 'UTF16LE' -Odd).definite_leak -gt 0) }
Test-Case 'Case variant' { Assert-True (-not (Scan-Fixture $synthetic.CargoHome.ToLowerInvariant()).pass) }
Test-Case 'Slash variant' { Assert-True (-not (Scan-Fixture $synthetic.CargoHome.Replace('\','/')).pass) }
Test-Case 'Mixed separator variant' { Assert-True (-not (Scan-Fixture 'Q:\Synthetic/Cargo-A').pass) }
Test-Case 'JSON escaped variant' { Assert-True (-not (Scan-Fixture $synthetic.RustupHome.Replace('\','\\')).pass) }
Test-Case 'Unicode slash escaped variant' { Assert-True (-not (Scan-Fixture $synthetic.CargoHome.Replace('\','\u005c')).pass) }
Test-Case 'Percent encoded variant' { Assert-True (-not (Scan-Fixture ([Uri]::EscapeDataString($synthetic.CargoHome))).pass) }
Test-Case 'UTF16 slash and case' { Assert-True (-not (Scan-Fixture $synthetic.CargoHome.Replace('\','/').ToLowerInvariant() 'UTF16LE').pass) }
Test-Case 'Virtual paths are informational' { Assert-True (Scan-Fixture '/cargo/a /rustup/b /source/c /build/d').pass }
Test-Case 'Generic system DLL path' { $r=Scan-Fixture 'C:\Windows\System32\kernel32.dll'; Assert-True ($r.pass -and $r.allowed_generic_path -gt 0) }
Test-Case 'Generic Windows null device UTF8' { $r=Scan-Fixture '\\.\NUL'; Assert-True ($r.pass -and $r.allowed_generic_path -eq 1) }
Test-Case 'Generic Windows null device UTF16LE' { $r=Scan-Fixture '\\.\NUL' 'UTF16LE'; Assert-True ($r.pass -and $r.allowed_generic_path -eq 1) }
Test-Case 'Unknown device path is not allowlisted' { $r=Scan-Fixture '\\.\PrivateDevice'; Assert-True (-not $r.pass -and $r.review_required -gt 0) }
Test-Case 'Unknown printable path requires review' { $r=Scan-Fixture 'Z:\UnknownVendor\PrivateBuild\module.cpp'; Assert-True (-not $r.pass -and $r.review_required -gt 0) }
Test-Case 'Drive-like machine bytes are not automatically leaks' { Assert-True (Scan-Fixture 'A:xyz B:').pass }
Test-Case 'Missing artifact fails' { Assert-Rejected { Test-PrivacyArtifact (Join-Path $fixtureRoot 'missing.bin') $synthetic 'missing' } }
Test-Case 'Unreadable artifact fails without mutating ACL' {
    $file=Join-Path $fixtureRoot 'locked.bin'; [IO.File]::WriteAllBytes($file,[byte[]](1,2,3))
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try { Assert-Rejected { Test-PrivacyArtifact $file $synthetic 'locked' } } finally { $stream.Dispose() }
}
Test-Case 'Sanitizer does not echo known/unknown host paths' {
    $text=Protect-ReleaseText ($synthetic.CargoHome + '/a Z:\Other\Host\b SECRET_TOKEN=value') $synthetic
    Assert-True ($text -notmatch 'Cargo-A|Z:\\Other|=value')
}
Test-Case 'Privacy failure propagation' { Assert-Rejected { Assert-ReleasePrivacy (Scan-Fixture $synthetic.CargoHome) } }
Test-Case 'Log write failure propagates with sanitized error' {
    $writer=New-Object IO.StringWriter; $writer.Dispose()
    Assert-Rejected { Write-ReleaseLogLine $writer $synthetic.CargoHome $synthetic }
}
Test-Case 'Wrong platform' { Assert-Rejected { Assert-ReleasePlatform ([PlatformID]::Unix) 'AMD64' 8 'x86_64-pc-windows-msvc' } }
Test-Case 'Wrong architecture' { Assert-Rejected { Assert-ReleasePlatform ([PlatformID]::Win32NT) 'ARM64' 8 'x86_64-pc-windows-msvc' } }
Test-Case '32-bit process' { Assert-Rejected { Assert-ReleasePlatform ([PlatformID]::Win32NT) 'AMD64' 4 'x86_64-pc-windows-msvc' } }
Test-Case 'GNU toolchain rejection' { Assert-Rejected { Assert-ReleasePlatform ([PlatformID]::Win32NT) 'AMD64' 8 'x86_64-pc-windows-gnu' } }
$head='a' * 40
Test-Case 'Wrong source HEAD' { Assert-Rejected { Assert-ReleaseSource ('b' * 40) $head @() @() } }
Test-Case 'Application dirty tree rejection' { Assert-Rejected { Assert-ReleaseSource $head $head @('src/App.tsx') @() } }
Test-Case 'Compile tooling dirty tree accepted and bounded' { Assert-ReleaseSource $head $head @('scripts/build-release.ps1','scripts/release-safety.ps1') @() }
Test-Case 'Staged change rejection' { Assert-Rejected { Assert-ReleaseSource $head $head @() @('scripts/build-release.ps1') } }
Test-Case 'CLI unsupported assumptions' { Assert-Rejected { Assert-ReleaseCli '3.0.0' '3.0.0' '--no-bundle' } }
Test-Case 'CLI lock mismatch' { Assert-Rejected { Assert-ReleaseCli '2.11.4' '2.11.3' '--no-bundle' } }
Test-Case 'CLI missing argument support' { Assert-Rejected { Assert-ReleaseCli '2.11.4' '2.11.4' '--debug' } }
Test-Case 'Child failure preserves exit code' {
    $code=0
    try { Assert-ReleaseChildExit 23 'synthetic' } catch { $code=$_.Exception.Data['ExitCode'] }
    Assert-True ($code -eq 23)
}
Test-Case 'Containment boundary' { Assert-Rejected { Assert-ReleaseContained $fixtureRoot ($fixtureRoot + '-other\x') } }
Test-Case 'Create-new refuses overwrite' {
    $file=Join-Path $fixtureRoot 'owned.txt'; Write-ReleaseNewText $file 'original'
    Assert-Rejected { Write-ReleaseNewText $file 'replacement' }
    Assert-True ([IO.File]::ReadAllText($file) -ceq 'original')
}
Test-Case 'Reparse directory rejected' {
    $destination=Join-Path $fixtureRoot 'junction-target'; New-Item -ItemType Directory -Path $destination | Out-Null
    $link=Join-Path $fixtureRoot 'junction-link'; New-Item -ItemType Junction -Path $link -Target $destination | Out-Null
    Assert-Rejected { Assert-ReleaseNoReparse (Join-Path $link 'output') }
}
Test-Case 'Manifest EOL restore' {
    $file=Join-Path $fixtureRoot 'manifest-eol.toml'; $original=[Text.Encoding]::UTF8.GetBytes("version=1`r`n")
    [IO.File]::WriteAllText($file,"version=1`n")
    $guard=Restore-ReleaseManifest $file $original
    Assert-True ($guard.eol_restored -and $guard.before -ceq $guard.final)
}
Test-Case 'Manifest content change fails and remains reviewable' {
    $file=Join-Path $fixtureRoot 'manifest-content.toml'; [IO.File]::WriteAllText($file,'version=2')
    Assert-Rejected { Restore-ReleaseManifest $file ([Text.Encoding]::UTF8.GetBytes('version=1')) }
    Assert-True ([IO.File]::ReadAllText($file) -ceq 'version=2')
}
Test-Case 'Input guard detects modification' { Assert-Rejected { Assert-ReleaseInputHashes ([ordered]@{a='1'}) ([ordered]@{a='2'}) } }
$peFolder=Join-Path $fixtureRoot 'pe'; New-Item -ItemType Directory -Path $peFolder | Out-Null
$peFile=Join-Path $peFolder 'dol-progress-manager.exe'
$peBytes=New-Object byte[] 256; $peBytes[0]=0x4d; $peBytes[1]=0x5a
[BitConverter]::GetBytes([int]128).CopyTo($peBytes,60); [BitConverter]::GetBytes([int]0x4550).CopyTo($peBytes,128)
[BitConverter]::GetBytes([uint16]0x8664).CopyTo($peBytes,132); [BitConverter]::GetBytes([uint16]0x20b).CopyTo($peBytes,152)
[BitConverter]::GetBytes([uint16]2).CopyTo($peBytes,220); [IO.File]::WriteAllBytes($peFile,$peBytes)
Test-Case 'PE x64 GUI basics' { Assert-True ((Get-ReleasePe $peFile).machine -ceq 'AMD64') }
Test-Case 'Wrong EXE name' { Assert-Rejected { Get-ReleasePe (Join-Path $peFolder 'old.exe') } }
Test-Case 'Wrong EXE output location' { Assert-Rejected { Assert-ReleaseOutput $fixtureRoot $peFile } }
Test-Case 'Wrong PE architecture' {
    [BitConverter]::GetBytes([uint16]0x14c).CopyTo($peBytes,132); [IO.File]::WriteAllBytes($peFile,$peBytes)
    Assert-Rejected { Get-ReleasePe $peFile }
}
Test-Case 'Scanner CLI missing artifact sanitized' {
    $r=Invoke-TestScript (Join-Path $repo 'scripts\check-release-privacy.ps1') @('-Path',(Join-Path $fixtureRoot 'not-found.bin')) $null
    Assert-True ($r.code -ne 0 -and -not $r.text.Contains($fixtureRoot))
}
Test-Case 'Scanner CLI privacy violation returns nonzero and omits host paths' {
    $cargo=Join-Path $fixtureRoot 'fake-cargo'; $rustup=Join-Path $fixtureRoot 'fake-rustup'; $profile=Join-Path $fixtureRoot 'fake-profile'
    foreach ($directory in @($cargo,$rustup,$profile)) { New-Item -ItemType Directory -Path $directory | Out-Null }
    $file=Join-Path $fixtureRoot 'cli-leak.bin'; [IO.File]::WriteAllBytes($file,[Text.Encoding]::Unicode.GetBytes($cargo.Replace('\','/').ToUpperInvariant()))
    $r=Invoke-TestScript (Join-Path $repo 'scripts\check-release-privacy.ps1') @('-Path',$file) @{ CARGO_HOME=$cargo; RUSTUP_HOME=$rustup; USERPROFILE=$profile }
    Assert-True ($r.code -ne 0 -and $r.text.Contains('Pass=False') -and -not $r.text.Contains($fixtureRoot) -and -not $r.text.Contains('FAKE-CARGO'))
}
Test-Case 'Scanner CLI unreadable artifact returns nonzero without path echo' {
    $file=Join-Path $fixtureRoot 'cli-locked.bin'; [IO.File]::WriteAllBytes($file,[byte[]](1,2,3))
    $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        $r=Invoke-TestScript (Join-Path $repo 'scripts\check-release-privacy.ps1') @('-Path',$file) $null
        Assert-True ($r.code -ne 0 -and -not $r.text.Contains($fixtureRoot))
    } finally { $stream.Dispose() }
}
Test-Case 'Runner entry rejects environmental flags before build' {
    $r=Invoke-TestScript (Join-Path $repo 'scripts\build-release.ps1') @('-ExpectedSourceHead',$head) @{ RUSTFLAGS='synthetic-override' }
    Assert-True ($r.code -ne 0 -and $r.text.Contains('RUSTFLAGS') -and -not $r.text.Contains($repo))
}
Test-Case 'Remap specificity and source reading via rustc LLVM output' {
    $nested=Join-Path $fixtureRoot 'remap-cargo'; New-Item -ItemType Directory -Path $nested | Out-Null
    $source=Join-Path $nested 'probe.rs'; [IO.File]::WriteAllText($source,'fn main() { println!("{}", file!()); }')
    $llvm=Join-Path $fixtureRoot 'probe.ll'; $tokens=@(Get-ReleaseRemapTokens ([ordered]@{ UserProfile=$fixtureRoot; CargoHome=$nested }))
    & rustc --emit=llvm-ir $source -o $llvm @tokens
    Assert-True ($LASTEXITCODE -eq 0)
    $text=[IO.File]::ReadAllText($llvm)
    Assert-True ($text.Contains('/cargo') -and -not $text.Contains($fixtureRoot))
}
Write-Output "Tests: $script:passed passed, $script:failed failed. Synthetic fixtures only; no EXE executed."
if ($script:failed -gt 0) { exit 1 }
exit 0
