#Requires -Version 5.1
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../verify-portable-package.ps1')
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$fixtures=Join-Path $repo ('tmp/phase-23d-c1b-2/tests/'+[Guid]::NewGuid().ToString('N'))
Assert-ReleaseContained $repo $fixtures; Assert-ReleaseNoReparse $fixtures
Get-PortableGit $repo @('check-ignore','--quiet','--','tmp/phase-23d-c1b-2/fixture.txt') | Out-Null
New-Item -ItemType Directory -Path $fixtures -ErrorAction Stop | Out-Null
Write-ReleaseNewText (Join-Path $fixtures 'TEST_ONLY.txt') 'Synthetic fixtures, never distribution inputs. No EXE execution.'
$passed=0; $failed=0; $counter=0
function Expect($Value) { if (-not $Value) { throw 'Test assertion failed.' } }
function Reject([scriptblock]$Action) { $rejected=$false; try { & $Action | Out-Null } catch { $rejected=$true }; Expect $rejected }
function Case([string]$Name,[scriptblock]$Action) {
    try { & $Action; $script:passed++; Write-Output "PASS $Name" }
    catch { $script:failed++; Write-Output ("FAIL $Name : "+(Protect-ReleaseText $_.Exception.Message ([ordered]@{Fixture=$fixtures;Repository=$repo}))) }
}
function New-TestPath([string]$Suffix) { $script:counter++; return Join-Path $fixtures ('TEST_ONLY_'+$script:counter+$Suffix) }
function New-PublicNoticeFixture {
    param([switch]$MissingInventory)
    $root=New-TestPath '.entry-root'
    New-Item -ItemType Directory -Path (Join-Path $root 'scripts'),(Join-Path $root 'release/notices') | Out-Null
    foreach ($name in @('build-portable-package.ps1','verify-portable-package.ps1','portable-package-safety.ps1','release-safety.ps1')) {
        Write-PortableBytes $root (Join-Path $root ('scripts/'+$name)) (Read-PortableBytes (Join-Path $repo ('scripts/'+$name)))
    }
    foreach ($name in @('manifest.json','inventory.json','review.json','source.json')) {
        if ($MissingInventory -and $name -ceq 'inventory.json') { continue }
        Write-ReleaseNewText (Join-Path $root ('release/notices/'+$name)) '{"schema":1,"status":"PENDING","test_only":true}'
    }
    Write-ReleaseNewText (Join-Path $root 'THIRD-PARTY-NOTICES.txt') 'TEST_ONLY synthetic notice; never distribution input.'
    return $root
}
function Put16([byte[]]$Bytes,[int]$Offset,[uint16]$Value) { [BitConverter]::GetBytes($Value).CopyTo($Bytes,$Offset) }
function Put32([byte[]]$Bytes,[int]$Offset,[uint32]$Value) { [BitConverter]::GetBytes($Value).CopyTo($Bytes,$Offset) }
function Fixture-Pe {
    # A minimal resource-only PE, with no executable application code.
    $b=New-Object byte[] 1024
    Put16 $b 0 0x5a4d; Put32 $b 60 128; Put32 $b 128 0x4550; Put16 $b 132 0x8664; Put16 $b 134 1; Put16 $b 148 240
    Put16 $b 152 0x20b; Put16 $b 220 2; Put32 $b 260 16; Put32 $b 280 4096; Put32 $b 284 512
    Put32 $b 400 512; Put32 $b 404 4096; Put32 $b 408 512; Put32 $b 412 512
    Put16 $b 526 1; Put32 $b 528 16; Put32 $b 532 2147483672
    Put16 $b 550 1; Put32 $b 552 1; Put32 $b 556 2147483696
    Put16 $b 574 1; Put32 $b 576 1033; Put32 $b 580 72
    Put32 $b 584 4352; Put32 $b 588 92
    Put16 $b 768 92; Put16 $b 770 52
    [Text.Encoding]::Unicode.GetBytes("VS_VERSION_INFO`0").CopyTo($b,774)
    Put32 $b 808 4277077181; Put32 $b 812 65536; Put32 $b 816 3; Put32 $b 824 3
    [Text.Encoding]::ASCII.GetBytes('TEST_ONLY').CopyTo($b,64)
    return ,$b
}
function Fixture-CompileState {
    $head='a'*40; $id='b'*32; $hash='0'*64
    # In-memory TEST_ONLY state vector; no artifact, signed HEAD or license clearance is fabricated.
    return [pscustomobject]@{
        Result=[pscustomobject]@{fixture_context='TEST_ONLY';run_id=$id;source_head=$head;source_state='CLEAN_SIGNED_CHECKPOINT';dirty_paths=@();classification='COMPILE_VALIDATED';exit_code=0;source_bytes_preserved=$true;target='x86_64-pc-windows-msvc';version='0.3.0';build_command='npm run tauri -- build --no-bundle -- --locked --offline';executable=[pscustomobject]@{name='dol-progress-manager.exe';sha256=$hash};output='output/dol-progress-manager.exe';privacy=[pscustomobject]@{pass=$true;definite_leak=0;review_required=0};log_privacy=[pscustomobject]@{pass=$true};manifest_guard=[pscustomobject]@{before=$hash;final=$hash}}
        Owner=[pscustomobject]@{schema=1;run_id=$id;source_head=$head;purpose='portable release compile validation'}
    }
}
$originalReadme=Read-PortableBytes (Join-Path $repo 'README.md')
$fixtureReadme=Get-PortableText $originalReadme
$fixtureReadme=$fixtureReadme.Replace('# DOL Progress Manager',"# DOL Progress Manager`r`n`r`nTEST_ONLY synthetic document fixture 0.3.0.")
$readme=ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme)) '0.3.0'
$payload=[ordered]@{'LICENSE.txt'=[Text.Encoding]::UTF8.GetBytes("TEST_ONLY license bytes`r`n");'README.txt'=$readme;'THIRD-PARTY-NOTICES.txt'=[Text.Encoding]::UTF8.GetBytes('TEST_ONLY synthetic notices. Not distribution clearance.');'dol-progress-manager.exe'=(Fixture-Pe)}
$prefixes=[ordered]@{CargoHome='Q:\Synthetic\Cargo';RustupHome='Q:\Synthetic\Rustup';Repository='R:\Synthetic\Source'}
$staging=New-TestPath '.staging'
$hashes=New-PortableStaging $staging $payload
$zipPath=New-TestPath '.zip'
Write-PortableZip $staging $zipPath
$zipBytes=Read-PortableBytes $zipPath
$externalPath=$zipPath+'.sha256'
Write-PortableBytes $fixtures $externalPath ([Text.Encoding]::UTF8.GetBytes((Get-ReleaseSHA256 $zipBytes)+'  '+[IO.Path]::GetFileName($zipPath)+"`n"))

function Fixture-Zip($Members) {
    $path=New-TestPath '.zip'; $stream=[IO.File]::Open($path,'CreateNew','ReadWrite','None')
    try {
        $archive=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$true,(New-Object Text.UTF8Encoding($false)))
        try { foreach ($member in $Members) {
            $entry=$archive.CreateEntry($member.name,[IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime=New-Object DateTimeOffset(1980,1,1,0,0,0,[TimeSpan]::Zero); $entry.ExternalAttributes=0
            $writer=$entry.Open(); try { $writer.Write($member.bytes,0,$member.bytes.Length) } finally { $writer.Dispose() }
        } } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
    return $path
}
$memberFixtures=@('LICENSE.txt','README.txt','SHA256SUMS.txt','THIRD-PARTY-NOTICES.txt','dol-progress-manager.exe') | ForEach-Object { [pscustomobject]@{name='DOL-Progress-Manager/'+$_;bytes=(Read-PortableBytes (Join-Path $staging $_))} }
function Mutated-Zip([scriptblock]$Mutation) {
    $b=[byte[]]$zipBytes.Clone(); & $Mutation $b
    $path=New-TestPath '.zip'; Write-PortableBytes $fixtures $path $b; return $path
}
function Header-Offsets([byte[]]$Bytes) {
    $end=$Bytes.Length-22; $p=[int][BitConverter]::ToUInt32($Bytes,$end+16); $result=@()
    for ($i=0;$i -lt 5;$i++) { $result+=$p; $p+=46+[BitConverter]::ToUInt16($Bytes,$p+28) }
    return $result
}
function Reject-Archive([string]$Path) {
    $verify=New-TestPath '.verify'
    Reject { Test-PortableArchive $Path '' $verify $hashes '0.3.0' $payload $prefixes }
}

# Run the production Output statements with synthetic files, without invoking package gates.
$outputTokens=$null; $outputErrors=$null
$packageAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'scripts/build-portable-package.ps1'),[ref]$outputTokens,[ref]$outputErrors)
if ($outputErrors.Count -ne 0) { throw 'Package script parse failed.' }
$copyLoops=@($packageAst.FindAll({param($node) $node -is [Management.Automation.Language.ForEachStatementAst] -and $node.Body.Extent.Text.Contains('[IO.File]::Copy($from,$to,$false)')},$true))
if ($copyLoops.Count -ne 1) { throw 'Expected one production Output loop.' }
$outputLoop=$copyLoops[0]
$afterOutput=@($outputLoop.Parent.Statements | Where-Object { $_.Extent.StartOffset -gt $outputLoop.Extent.EndOffset -and $_.Extent.Text -match '^\$exitCode\s*=\s*0$' })
if ($afterOutput.Count -ne 1) { throw 'Output success assignment missing.' }
$outputBlock=[scriptblock]::Create($outputLoop.Extent.Text+"`n"+$afterOutput[0].Extent.Text)
$outputNames=[scriptblock]::Create($outputLoop.Condition.Extent.Text)
$successBranches=@($packageAst.FindAll({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Clauses[0].Item1.Extent.Text.Trim() -ceq '$exitCode -eq 0'},$true))
if ($successBranches.Count -ne 1) { throw 'Package result success guard missing.' }
$resultSuccess=[scriptblock]::Create($successBranches[0].Extent.Text)
function New-OutputFixture {
    $root=New-TestPath '.output-root'
    New-Item -ItemType Directory -Path (Join-Path $root 'verify'),(Join-Path $root 'output') | Out-Null
    $base='DOL-Progress-Manager_0.3.0_windows-x64_portable.zip'
    Write-PortableBytes $root (Join-Path $root ('verify/'+$base)) $zipBytes
    Write-ReleaseNewText (Join-Path $root ('verify/'+$base+'.sha256')) ((Get-ReleaseSHA256 $zipBytes)+'  '+$base+"`n")
    return [pscustomobject]@{Path=$root;Verify=(Join-Path $root 'verify');Output=(Join-Path $root 'output')}
}

Case 'Production Output copies exactly ZIP and external hash' {
    $run=New-OutputFixture; $basename='DOL-Progress-Manager_0.3.0_windows-x64_portable.zip'
    $names=@(& $outputNames)
    Expect ($names.Count -eq 2 -and @($names | Select-Object -Unique).Count -eq 2)
    Expect ($names[0] -ceq $basename -and $names[1] -ceq ($basename+'.sha256'))
    $exitCode=1; . $outputBlock
    Expect ($exitCode -eq 0 -and @(Get-ChildItem -LiteralPath $run.Output).Count -eq 2)
    foreach ($name in $names) { Expect ((Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $run.Output $name))) -ceq (Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $run.Verify $name)))) }
    $result=[ordered]@{classification='FAILED'}; $verified=@{sha256=(Get-ReleaseSHA256 $zipBytes)}
    . $resultSuccess
    Expect ($result.classification -ceq 'PACKAGE_VERIFIED')
}
foreach ($collision in @('ZIP','external hash')) {
    Case ('Production Output preserves existing '+$collision+' and failed classification') {
        $run=New-OutputFixture; $basename='DOL-Progress-Manager_0.3.0_windows-x64_portable.zip'
        $existingName=if ($collision -ceq 'ZIP') { $basename } else { $basename+'.sha256' }
        $existing=Join-Path $run.Output $existingName
        Write-ReleaseNewText $existing 'TEST_ONLY existing output must stay unchanged'
        $before=Get-ReleaseSHA256 (Read-PortableBytes $existing)
        $exitCode=1; $rejected=$false
        try { . $outputBlock } catch { $rejected=$true }
        $result=[ordered]@{classification='FAILED'}; . $resultSuccess
        Expect ($rejected -and $exitCode -eq 1 -and $result.classification -ceq 'FAILED')
        Expect ((Get-ReleaseSHA256 (Read-PortableBytes $existing)) -ceq $before)
    }
}

Case 'CRC32 known vector' { Expect ([PortableZipVerifier]::Crc([Text.Encoding]::ASCII.GetBytes('123456789')) -eq 3421780262) }
Case 'PE x64 GUI version resource' { [PortableZipVerifier]::Pe($payload['dol-progress-manager.exe'],'0.3.0') }
Case 'Fixed five members independent verifier positive' {
    $verify=New-TestPath '.verify'
    $result=Test-PortableArchive $zipPath $externalPath $verify $hashes '0.3.0' $payload $prefixes
    Expect ($result.members -eq 5 -and $result.crc_verified -eq 5 -and $result.extracted_hashes_verified -eq 5)
    Expect (@(Get-ChildItem -LiteralPath (Join-Path $verify 'DOL-Progress-Manager') -Force).Count -eq 5)
}
Case 'Independent existing archive read leaves ZIP bytes unchanged' { [void][PortableZipVerifier]::Read($zipBytes); Expect ((Get-ReleaseSHA256 (Read-PortableBytes $zipPath)) -ceq (Get-ReleaseSHA256 $zipBytes)) }
Case 'Deterministic ZIP bytes and fixed header timestamps' {
    $again=New-TestPath '.zip'; Write-PortableZip $staging $again
    Expect ((Get-ReleaseSHA256 (Read-PortableBytes $again)) -ceq (Get-ReleaseSHA256 $zipBytes))
    foreach ($p in (Header-Offsets $zipBytes)) { Expect ([BitConverter]::ToUInt16($zipBytes,$p+12) -eq 0 -and [BitConverter]::ToUInt16($zipBytes,$p+14) -eq 33) }
}
Case 'README BOM CRLF complete section and external URL retention' {
    Expect ($readme[0] -eq 239 -and $readme[1] -eq 187 -and $readme[2] -eq 191)
    $text=Get-PortableText $readme; Assert-PortableReadme $text
    Expect ($text -notmatch '(?<!\r)\n' -and $text -notmatch '## 開発と検証|## Windows build|## 仕様書')
    Expect ($text.Contains('https://gvdb.mydns.jp/db/') -and $text.Contains('https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section'))
    Expect ($text.Contains('大航海時代データベースからのマスターデータ取得と取り込み') -and $text -cnotmatch 'GVDB')
    Expect ($text.Contains('Microsoft Visual C++ Redistributable x64') -and $text.Contains('https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist'))
    Expect ($text.Contains('LICENSE.txt') -and $text.Contains('THIRD-PARTY-NOTICES.txt') -and $text.Contains('data/configを削除・上書きしない'))
    Expect (-not $text.Contains('ユーザーレビュー待ち') -and $text.Contains('通知の正式レビューは完了しています'))
    Expect ($text.Contains('配布物内のTHIRD-PARTY-NOTICES.txtを参照してください') -and $text.Contains('一般公開の承認や正式license clearanceの完了を意味しません'))
    Expect (-not $text.Contains('当面、実行ファイルもソースコードも一般公開しません'))
}
Case 'README public distribution and integrity guidance retained' {
    $text=Get-PortableText $readme
    Expect ($text.Contains('https://github.com/guardiancrow/dol-progress/releases'))
    Expect ($text.Contains('DOL-Progress-Manager_0.3.0_windows-x64_portable.zip.sha256'))
    Expect ($text.Contains('Source code') -and $text.Contains('実行用Portable ZIPとは別'))
    Expect ($text.Contains('Get-FileHash -Algorithm SHA256 -LiteralPath') -and $text.Contains('Get-Content -LiteralPath'))
    Expect ($text.Contains('先頭64桁') -and $text.Contains('一致しない場合は起動・更新せず'))
    Expect ($text.Contains('Authenticode未署名') -and $text.Contains('ソースのGit署名は、EXEのAuthenticode署名とは別'))
}
Case 'README portable operation and data safety retained' {
    $text=Get-PortableText $readme
    Expect ($text.Contains('書き込み可能な新しいフォルダーへZIP全体を展開'))
    Expect ($text.Contains('外部Runtime、インストーラー、進捗DB、設定、マスターデータはZIPに含みません'))
    Expect ($text.Contains('初回は使用許諾を確認') -and $text.Contains('拒否または画面を閉じた場合は起動しません'))
    Expect ($text.Contains('更新前に内蔵バックアップを保存') -and $text.Contains('完全に終了'))
    Expect ($text.Contains('既存のアプリとは別の新しいフォルダーへ全体を展開'))
    Expect ($text.Contains('展開したEXEと同梱文書だけ') -and $text.Contains('data/configを削除・上書きしない'))
    Expect ($text.Contains('カスタム利用では、アプリのフォルダーをコピーするだけでは外部DBを保管できません'))
    Expect ($text.Contains('consent.json') -and $text.Contains('空DBを自動作成しません'))
}
Case 'README unofficial tool and license boundaries retained with SDK terms' {
    $text=Get-PortableText $readme
    Expect ($text.Contains('非公式のファンツール') -and $text.Contains('提携・公認を示すものでもありません'))
    Expect ($text.Contains('MIT License') -and $text.Contains('第三者の権利を本プロジェクトのMIT Licenseで再licenseするものではありません'))
    Expect ($text.Contains('THIRD-PARTY-NOTICES.txt') -and $text.Contains('通知の正式レビューは完了しています'))
    Expect ($text.Contains('SDK対象コード') -and $text.Contains('Microsoft Windows SDK由来コードの利用・再配布条件'))
}
function Get-TestSdkConditions([string]$Text,[string]$Heading) {
    $normalized=$Text.Replace("`r`n","`n").TrimStart([char]0xfeff)
    $pattern='(?ms)^'+[regex]::Escape($Heading)+'\n\n(?<body>.*?)(?=^## |^「同意する」|\z)'
    $matches=[regex]::Matches($normalized,$pattern)
    if ($matches.Count -ne 1) { throw 'SDK terms: missing or duplicate section.' }
    $body=$matches[0].Groups['body'].Value.Trim([char]10)
    if ([regex]::Split($body,'\n\n').Count -ne 9) { throw 'SDK terms: expected nine paragraphs.' }
    return $body
}
function Assert-TestSdkMatchesConsent([string]$ReadmeText,[string]$ConsentText) {
    $actual=Get-TestSdkConditions $ReadmeText '### Microsoft Windows SDK由来コードの利用・再配布条件'
    $expected=Get-TestSdkConditions $ConsentText 'Microsoft Windows SDK由来コードの条件'
    if (-not [String]::Equals($actual,$expected,[StringComparison]::Ordinal)) { throw 'SDK terms: README and Consent differ.' }
}
$consentSource=Get-PortableText (Read-PortableBytes (Join-Path $repo 'src-tauri/src/consent/first_run.rs'))
$consentMatch=[regex]::Match($consentSource,'(?ms)^const APPROVED_BODY: &str = r#"(?<body>.*?)"#;')
Expect $consentMatch.Success
$consentBody=$consentMatch.Groups['body'].Value
Case 'SDK nine paragraphs match actual Consent and generated Portable README' {
    Assert-TestSdkMatchesConsent $fixtureReadme $consentBody
    Assert-TestSdkMatchesConsent (Get-PortableText $readme) $consentBody
}
Case 'SDK section omission fails comparison' {
    $missing=[regex]::Replace($fixtureReadme,'(?ms)^### Microsoft Windows SDK由来コードの利用・再配布条件\r?\n.*?(?=^## |\z)','')
    Reject { Assert-TestSdkMatchesConsent $missing $consentBody }
}
Case 'SDK README liability or scope drift fails comparison' {
    foreach ($old in @('5米ドル','この条件はSDK対象コードだけに適用')) {
        Expect $fixtureReadme.Contains($old)
        Reject { Assert-TestSdkMatchesConsent ($fixtureReadme.Replace($old,($old+'TEST_ONLY変更'))) $consentBody }
    }
}
Case 'SDK Consent-only change fails comparison' {
    Expect $consentBody.Contains('認識すべきであった場合')
    Reject { Assert-TestSdkMatchesConsent $fixtureReadme ($consentBody.Replace('認識すべきであった場合','TEST_ONLY変更')) }
}
Case 'README missing Windows x64' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes([regex]::Replace($fixtureReadme,'Windows[ \t]+[^。\r\n]*x64','Windows'))) } }
Case 'README missing VC Runtime guidance' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('Microsoft Visual C++ Redistributable','Microsoft native Runtime'))) } }
Case 'README VC Runtime x86 only' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('Redistributable x64','Redistributable x86'))) } }
Case 'README missing VC official URL' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist','https://example.invalid'))) } }
Case 'README Japanese VC official URL retained' {
    $converted=ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist','https://learn.microsoft.com/ja-jp/cpp/windows/latest-supported-vc-redist')))
    Expect ((Get-PortableText $converted).Contains('https://learn.microsoft.com/ja-jp/cpp/windows/latest-supported-vc-redist'))
}
Case 'README canonical notice link mapped' {
    Expect ((Get-PortableText $readme).Contains('THIRD-PARTY-NOTICES.txt (THIRD-PARTY-NOTICES.txt)'))
}
Case 'README missing section' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('## 更新','## Unknown'))) } }
Case 'README duplicate section' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme+"`n## 更新`nDuplicate")) } }
Case 'README missing official URL' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section','https://example.invalid'))) } }
Case 'README unknown relative link' { Reject { ConvertTo-PortableReadme ([Text.Encoding]::UTF8.GetBytes($fixtureReadme.Replace('(LICENSE)','(../unknown.txt)'))) } }
Case 'LICENSE bytes copied without text transformation' { Expect ((Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $staging 'LICENSE.txt'))) -ceq (Get-ReleaseSHA256 $payload['LICENSE.txt'])) }
Case 'Manifest exact four lines no BOM final LF' { $b=Read-PortableBytes (Join-Path $staging 'SHA256SUMS.txt'); $text=Get-PortableText $b; Expect ($b[0] -ne 239 -and $text.Split([char]10).Count -eq 5 -and $text.EndsWith("`n") -and -not $text.Contains("`r")) }
Case 'Wrong external ZIP hash' { $bad=New-TestPath '.sha256'; Write-PortableBytes $fixtures $bad ([Text.Encoding]::UTF8.GetBytes(('0'*64)+'  '+[IO.Path]::GetFileName($zipPath)+"`n")); Reject { Test-PortableArchive $zipPath $bad (New-TestPath '.verify') $hashes '0.3.0' $payload $prefixes } }
Case 'Missing external ZIP hash file' { Reject { Test-PortableArchive $zipPath (New-TestPath '.sha256') (New-TestPath '.verify') $hashes '0.3.0' $payload $prefixes } }
foreach ($index in 0..4) {
    Case ('Missing member '+$index) { $members=@($memberFixtures | Where-Object { $_.name -cne $memberFixtures[$index].name }); Reject-Archive (Fixture-Zip $members) }
}
foreach ($unsafe in @('../outside','/absolute','DOL-Progress-Manager\..\outside','C:/outside','DOL-Progress-Manager/README.txt:stream','DOL-Progress-Manager/','DOL-Progress-Manager/data/','DOL-Progress-Manager/config/','DOL-Progress-Manager/private.db','\\server\share','DOL-Progress-Manager/../README.txt')) {
    Case ('Unsafe member '+$unsafe) {
        $members=@($memberFixtures | ForEach-Object { [pscustomobject]@{name=$_.name;bytes=$_.bytes} }); $members[0].name=$unsafe
        $path=Fixture-Zip $members; $verify=New-TestPath '.verify'
        Reject { Test-PortableArchive $path '' $verify $hashes '0.3.0' $payload $prefixes }; Expect (-not [IO.Directory]::Exists($verify))
    }
}
Case 'Extra member' { Reject-Archive (Fixture-Zip (@($memberFixtures)+@([pscustomobject]@{name='hidden.txt';bytes=[byte[]](1)}))) }
Case 'Duplicate member' { $members=@($memberFixtures | ForEach-Object { [pscustomobject]@{name=$_.name;bytes=$_.bytes} }); $members[1].name=$members[0].name; Reject-Archive (Fixture-Zip $members) }
Case 'Case colliding member' { $members=@($memberFixtures | ForEach-Object { [pscustomobject]@{name=$_.name;bytes=$_.bytes} }); $members[1].name=$members[0].name.ToLowerInvariant(); Reject-Archive (Fixture-Zip $members) }
Case 'Wrong root' { Reject-Archive (Fixture-Zip @($memberFixtures | ForEach-Object { [pscustomobject]@{name=$_.name.Replace('DOL-Progress-Manager','OtherRoot');bytes=$_.bytes} })) }
Case 'Wrong member order' { Reject-Archive (Fixture-Zip @($memberFixtures[1],$memberFixtures[0],$memberFixtures[2],$memberFixtures[3],$memberFixtures[4])) }
Case 'Symlink external attributes' { Reject-Archive (Mutated-Zip {param($b) Put32 $b ((Header-Offsets $b)[0]+38) 2684354560}) }
Case 'DOS directory attribute' { Reject-Archive (Mutated-Zip {param($b) Put32 $b ((Header-Offsets $b)[0]+38) 16}) }
Case 'Encryption flag' { Reject-Archive (Mutated-Zip {param($b) Put16 $b ((Header-Offsets $b)[0]+8) 2049; Put16 $b 6 2049}) }
Case 'Unsupported compression' { Reject-Archive (Mutated-Zip {param($b) Put16 $b ((Header-Offsets $b)[0]+10) 99; Put16 $b 8 99}) }
Case 'Unexpected data descriptor flag' { Reject-Archive (Mutated-Zip {param($b) Put16 $b ((Header-Offsets $b)[0]+8) 2056; Put16 $b 6 2056}) }
Case 'Wrong timestamp' { Reject-Archive (Mutated-Zip {param($b) Put16 $b ((Header-Offsets $b)[0]+14) 34; Put16 $b 12 34}) }
Case 'Central local name mismatch' { Reject-Archive (Mutated-Zip {param($b) $b[30]=88}) }
Case 'Central local size mismatch' { Reject-Archive (Mutated-Zip {param($b) Put32 $b 22 99}) }
Case 'CRC mismatch in matching central local headers' { Reject-Archive (Mutated-Zip {param($b) Put32 $b ((Header-Offsets $b)[0]+16) 0; Put32 $b 14 0}) }
Case 'Corrupt compressed content' { Reject-Archive (Mutated-Zip {param($b) $p=30+[BitConverter]::ToUInt16($b,26); $b[$p]=255; $b[$p+1]=255}) }
Case 'Size limit and ZIP bomb header' { Reject-Archive (Mutated-Zip {param($b) Put32 $b ((Header-Offsets $b)[0]+24) 4294967295; Put32 $b 22 4294967295}) }
Case 'Unexpected extra metadata' { Reject-Archive (Mutated-Zip {param($b) Put16 $b ((Header-Offsets $b)[0]+30) 1}) }
Case 'ZIP64 version rejected' { Reject-Archive (Mutated-Zip {param($b) Put16 $b ((Header-Offsets $b)[0]+6) 45; Put16 $b 4 45}) }
Case 'Trailing bytes rejected' { $path=New-TestPath '.zip'; Write-PortableBytes $fixtures $path ([byte[]](@($zipBytes)+@(0))); Reject-Archive $path }
Case 'Truncated archive' { $path=New-TestPath '.zip'; Write-PortableBytes $fixtures $path $zipBytes[0..($zipBytes.Length-4)]; Reject-Archive $path }
Case 'Wrong central offset' { Reject-Archive (Mutated-Zip {param($b) Put32 $b ($b.Length-6) 1}) }
Case 'Overlapping local entries' { Reject-Archive (Mutated-Zip {param($b) Put32 $b ((Header-Offsets $b)[1]+42) 0}) }
$manifestText=Get-PortableText (Read-PortableBytes (Join-Path $staging 'SHA256SUMS.txt'))
$badManifests=[ordered]@{
    'malformed grammar'='malformed'
    'uppercase hash'=$manifestText.ToUpperInvariant()
    'CRLF'=$manifestText.Replace("`n","`r`n")
    'BOM'=([string][char]0xfeff+$manifestText)
    'missing final LF'=$manifestText.TrimEnd([char]10)
    'extra record'=($manifestText+('0'*64)+"  extra.txt`n")
    'duplicate record'=$manifestText.Replace('README.txt','LICENSE.txt')
    'wrong hash'=(('0'*64)+$manifestText.Substring(64))
}
foreach ($badManifestName in $badManifests.Keys) {
    Case ('Manifest '+$badManifestName) {
        $badManifest=$badManifests[$badManifestName]
        $members=@($memberFixtures | ForEach-Object { [pscustomobject]@{name=$_.name;bytes=$_.bytes} }); $members[2].bytes=[Text.Encoding]::UTF8.GetBytes($badManifest)
        Reject-Archive (Fixture-Zip $members)
    }
}
Case 'Manifest payload hash mismatch' { $members=@($memberFixtures | ForEach-Object { [pscustomobject]@{name=$_.name;bytes=$_.bytes} }); $members[0].bytes=[Text.Encoding]::UTF8.GetBytes('changed'); Reject-Archive (Fixture-Zip $members) }
Case 'Wrong PE version' { Reject { Test-PortableArchive $zipPath '' (New-TestPath '.verify') $hashes '0.4.0' $payload $prefixes } }
Case 'Wrong PE architecture' { $b=[byte[]]$payload['dol-progress-manager.exe'].Clone(); Put16 $b 132 0x14c; Reject { [PortableZipVerifier]::Pe($b,'0.3.0') } }
Case 'PE missing version resource' { $b=[byte[]]$payload['dol-progress-manager.exe'].Clone(); Put32 $b 280 0; Reject { [PortableZipVerifier]::Pe($b,'0.3.0') } }
Case 'Privacy leak in payload returns failure' { $leaky=[ordered]@{}; foreach ($key in $payload.Keys) { $leaky[$key]=$payload[$key] }; $leaky['THIRD-PARTY-NOTICES.txt']=[Text.Encoding]::Unicode.GetBytes($prefixes.CargoHome); $stage=New-TestPath '.staging'; $h=New-PortableStaging $stage $leaky; $path=New-TestPath '.zip'; Write-PortableZip $stage $path; Reject { Test-PortableArchive $path '' (New-TestPath '.verify') $h '0.3.0' $leaky $prefixes } }
Case 'Unknown UNC requires privacy failure' { $file=New-TestPath '.bin'; Write-PortableBytes $fixtures $file ([Text.Encoding]::UTF8.GetBytes('\\UnknownHost\PrivateShare\data')); Reject { Assert-ReleasePrivacy (Test-PrivacyArtifact $file $prefixes 'test') } }
Case 'Unresolved notice availability fails with no genuine inputs' { Reject { Assert-PortableNoticeAvailability (New-TestPath '.missing-notices') } }
Case 'Canonical notice inputs preserve review and source gates TEST_ONLY' {
    $root=New-TestPath '.canonical-notices'; $folder=Join-Path $root 'release/notices'
    New-Item -ItemType Directory -Path (Join-Path $folder 'texts') -Force | Out-Null
    $original='Copyright (c) Example contributors. Permission and disclaimer.'
    $originalPath='release/notices/texts/example.txt'
    Write-ReleaseNewText (Join-Path $root $originalPath) $original
    Write-ReleaseNewText (Join-Path $root 'THIRD-PARTY-NOTICES.txt') $original
    $textHash=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $root 'THIRD-PARTY-NOTICES.txt'))
    $components=@(); $coverage=@()
    foreach ($group in @('rust','frontend','native','toolchain','assets')) {
        $components+=@{id=$group;version='1.0.0';group=$group;included=$true}
        $coverage+=@{id=$group;included=$true;obligations_completed=$true;provenance_completed=$true;evidence=@($originalPath);selected_license='MIT';required_texts=@(@{path=$originalPath;sha256=$textHash});copyrights=@('Copyright (c) Example contributors.');source_provision='NOT_REQUIRED'}
    }
    $source=@{schema=1;purpose='PACKAGE_NOTICE_SOURCE';version='0.3.0';target='x86_64-pc-windows-msvc';canonical_file='THIRD-PARTY-NOTICES.txt';sha256=$textHash;source_commit=('a'*40);formal_review_state='REVIEWED';cargo_lock_sha256=('b'*64);npm_lock_sha256=('c'*64)}
    $review=@{schema=1;status='REVIEWED';version='0.3.0';test_only=$false;reviewer='TEST FIXTURE';reviewed_at='2000-01-01T00:00:00Z';unresolved=@();coverage=$coverage}
    $inventory=@{schema=1;version='0.3.0';target='x86_64-pc-windows-msvc';components=$components}
    foreach ($pair in @(@('source.json',$source),@('review.json',$review),@('inventory.json',$inventory))) {
        Write-ReleaseNewText (Join-Path $folder $pair[0]) (($pair[1] | ConvertTo-Json -Depth 12)+"`n")
    }
    $manifest=@{schema=1;status='REVIEWED';scope='DISTRIBUTION';test_only=$false;version='0.3.0';unresolved=@();cargo_lock_sha256=('b'*64);npm_lock_sha256=('c'*64);notices_sha256=$textHash}
    foreach ($name in @('source','review','inventory')) { $manifest[$name+'_sha256']=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $folder ($name+'.json'))) }
    Write-ReleaseNewText (Join-Path $folder 'manifest.json') (($manifest | ConvertTo-Json -Depth 12)+"`n")
    $map=[ordered]@{'src-tauri/Cargo.lock'= ('b'*64);'package-lock.json'= ('c'*64);'THIRD-PARTY-NOTICES.txt'=$textHash}
    foreach ($name in @('manifest.json','inventory.json','review.json','source.json','texts/example.txt')) { $map['release/notices/'+$name]=Get-ReleaseSHA256 (Read-PortableBytes (Join-Path $folder $name)) }
    $actual=Read-PortableNotices $root '0.3.0' $map
    Expect ((Get-ReleaseSHA256 $actual) -ceq $textHash)
    $noOwner=@{copyrights=@();evidence=@($originalPath);copyright_review=@{state='NO_SEPARATE_NOTICE_IN_REVIEWED_SOURCES';reason='Synthetic no-owner mapping test only';source_evidence=@(@{path=$originalPath;sha256=$textHash})}}
    Assert-PortableCopyrightMapping $root $noOwner $map $original
    $noOwner.copyright_review.state='PENDING_USER_APPROVAL'
    Reject { Assert-PortableCopyrightMapping $root $noOwner $map $original }
    $noOwner.copyright_review.state='NO_SEPARATE_NOTICE_IN_REVIEWED_SOURCES'
    $noOwner.copyright_review.source_evidence[0].sha256='e'*64
    Reject { Assert-PortableCopyrightMapping $root $noOwner $map $original }
    $source.formal_review_state='PENDING'
    [IO.File]::WriteAllText((Join-Path $folder 'source.json'),($source | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Reject { Read-PortableNotices $root '0.3.0' $map }
    $source.formal_review_state='REVIEWED'; $source.sha256='d'*64
    [IO.File]::WriteAllText((Join-Path $folder 'source.json'),($source | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    Reject { Read-PortableNotices $root '0.3.0' $map }
    $map.Remove('THIRD-PARTY-NOTICES.txt'); Reject { Read-PortableNotices $root '0.3.0' $map }
}
Case 'Incomplete notice metadata fails closed' {
    $root=New-TestPath '.notice-root'; $folder=Join-Path $root 'release/notices'; New-Item -ItemType Directory -Path $folder | Out-Null
    foreach ($name in @('manifest.json','inventory.json','review.json')) { Write-ReleaseNewText (Join-Path $folder $name) '{"schema":1,"status":"UNRESOLVED","test_only":true}' }
    Write-ReleaseNewText (Join-Path $folder 'THIRD-PARTY-NOTICES.txt') 'TEST_ONLY synthetic notice'
    $map=[ordered]@{}; foreach ($name in @('manifest.json','inventory.json','review.json','THIRD-PARTY-NOTICES.txt')) { $map['release/notices/'+$name]='0'*64 }
    Reject { Read-PortableNotices $root '0.3.0' $map }
}
Case 'Stale compile result rejects old uncommitted run without EXE access' {
    $state=Fixture-CompileState; $r=$state.Result; $o=$state.Owner
    Reject { Assert-PortableCompileState $r $o ('c'*40) '0.3.0' $r.run_id }
    $r.source_state='UNCOMMITTED_COMPILE_TOOLING_ONLY'; $r.dirty_paths=@('scripts/build-release.ps1')
    Reject { Assert-PortableCompileState $r $o $r.source_head '0.3.0' $r.run_id }
}
Case 'Compile provenance validates all required fields in memory TEST_ONLY' {
    $state=Fixture-CompileState; $r=$state.Result; $o=$state.Owner
    Assert-PortableCompileState $r $o $r.source_head '0.3.0' $r.run_id
    $r.privacy.pass=$false; Reject { Assert-PortableCompileState $r $o $r.source_head '0.3.0' $r.run_id }; $r.privacy.pass=$true
    Reject { Assert-PortableCompileState $r $o $r.source_head '0.4.0' $r.run_id }
    $r.target='x86_64-pc-windows-gnu'; Reject { Assert-PortableCompileState $r $o $r.source_head '0.3.0' $r.run_id }
}
Case 'Dirty source rejected with no compile bypass' { Reject { Assert-PortableSourceState ('a'*40) ('a'*40) @('scripts/new.ps1') } }
Case 'Source version roots and lock application entries agree' {
    Assert-PortableVersions '0.3.0' '0.3.0' "[package]`nversion = `"0.3.0`"" "name = `"dol-progress-manager`"`nversion = `"0.3.0`"" @('0.3.0','0.3.0')
    Reject { Assert-PortableVersions '0.3.0' '0.4.0' "[package]`nversion = `"0.3.0`"" "name = `"dol-progress-manager`"`nversion = `"0.3.0`"" @('0.3.0','0.3.0') }
    Reject { Assert-PortableVersions '0.3.0' '0.3.0' "[package]`nversion = `"0.4.0`"" "name = `"dol-progress-manager`"`nversion = `"0.3.0`"" @('0.3.0','0.3.0') }
    Reject { Assert-PortableVersions '0.3.0' '0.3.0' "[package]`nversion = `"0.3.0`"" "name = `"dol-progress-manager`"`nversion = `"0.4.0`"" @('0.3.0','0.3.0') }
    Reject { Assert-PortableVersions '0.3.0' '0.3.0' "[package]`nversion = `"0.3.0`"" "name = `"dol-progress-manager`"`nversion = `"0.3.0`"" @('0.3.0','0.4.0') }
}
Case 'Cargo dependency version cannot mask application version mismatch' {
    Reject { Assert-PortableVersions '0.3.0' '0.3.0' "[package]`nversion = `"0.4.0`"`n[dependencies.fixture]`nversion = `"0.3.0`"" "name = `"dol-progress-manager`"`nversion = `"0.3.0`"" @('0.3.0','0.3.0') }
}
Case 'Exact toolchain match and drift rejection use production reader TEST_ONLY' {
    $root=New-TestPath '.toolchain-fixture'
    $id='b'*32; $head='a'*40
    $run=Join-Path $root ('tmp/portable-release/'+$id)
    foreach ($dir in @('release/notices',('tmp/portable-release/'+$id+'/output'),('tmp/portable-release/'+$id+'/target/release'),('tmp/portable-release/'+$id+'/logs'))) {
        New-Item -ItemType Directory -Path (Join-Path $root $dir) -Force | Out-Null
    }
    $state=Fixture-CompileState
    $result=$state.Result
    $result | Add-Member -NotePropertyName toolchain -NotePropertyValue ((Get-PortableText (Read-PortableBytes (Join-Path $repo 'release/notices/mapping.json'))) | ConvertFrom-Json).toolchain
    $result | Add-Member -NotePropertyName input_hashes -NotePropertyValue ([ordered]@{'TEST_ONLY.source'=('c'*64)})
    $result.executable.sha256=Get-ReleaseSHA256 $payload['dol-progress-manager.exe']
    $source=[pscustomobject]@{Head=$head;Version='0.3.0';Hashes=[ordered]@{'TEST_ONLY.source'=('c'*64)}}
    Write-ReleaseNewText (Join-Path $run 'ownership.json') (($state.Owner | ConvertTo-Json)+"`n")
    Write-PortableBytes $root (Join-Path $run 'output/dol-progress-manager.exe') $payload['dol-progress-manager.exe']
    Write-PortableBytes $root (Join-Path $run 'target/release/dol-progress-manager.exe') $payload['dol-progress-manager.exe']
    Write-ReleaseNewText (Join-Path $run 'logs/compile.txt') 'TEST_ONLY resource-only PE; no application executed.'
    $approved=(Get-PortableText (Read-PortableBytes (Join-Path $repo 'release/notices/manifest.json')) | ConvertFrom-Json).toolchain_sha256
    Write-ReleaseNewText (Join-Path $root 'release/notices/manifest.json') ((@{toolchain_sha256=$approved} | ConvertTo-Json)+"`n")
    $resultPath=Join-Path $run 'result.json'
    [IO.File]::WriteAllText($resultPath,($result | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    $actual=Get-PortableCompile $root $id $source $prefixes
    Expect ((Get-ReleaseSHA256 $actual) -ceq $result.executable.sha256)
    foreach ($field in @('rustc','cargo','node','npm','tauri_cli','powershell')) {
        $original=$result.toolchain.$field
        $result.toolchain.$field='TEST_ONLY unapproved version'
        [IO.File]::WriteAllText($resultPath,($result | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
        $reason=''
        try { [void](Get-PortableCompile $root $id $source $prefixes) } catch { $reason=$_.Exception.Message }
        Expect ($reason -ceq 'Notices: compile toolchain was not reviewed.')
        $result.toolchain.$field=$original
    }
    $result.source_head='d'*40
    [IO.File]::WriteAllText($resultPath,($result | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
    $reason=''
    try { [void](Get-PortableCompile $root $id $source $prefixes) } catch { $reason=$_.Exception.Message }
    Expect ($reason -ceq 'Compile: provenance mismatch.')
}
Case 'Output collision preserves existing ZIP' { Reject { Write-PortableZip $staging $zipPath }; Expect ((Get-ReleaseSHA256 (Read-PortableBytes $zipPath)) -ceq (Get-ReleaseSHA256 $zipBytes)) }
Case 'Extraction collision preserves existing files' { $root=New-TestPath '.verify'; New-Item -ItemType Directory -Path $root | Out-Null; Write-ReleaseNewText (Join-Path $root 'keep.txt') 'keep'; Reject { Test-PortableArchive $zipPath '' $root $hashes '0.3.0' $payload $prefixes }; Expect ([IO.File]::ReadAllText((Join-Path $root 'keep.txt')) -ceq 'keep') }
Case 'Hidden unexpected staging file' { $stage=New-TestPath '.staging'; [void](New-PortableStaging $stage $payload); Write-ReleaseNewText (Join-Path $stage '.hidden') 'extra'; Reject { Write-PortableZip $stage (New-TestPath '.zip') } }
Case 'Unreadable ZIP fails with no ACL modification' { $stream=[IO.File]::Open($zipPath,'Open','ReadWrite','None'); try { Reject { Read-PortableBytes $zipPath } } finally { $stream.Dispose() } }
Case 'Reparse extraction ancestor rejected before writes' {
    $destination=New-TestPath '.link-target'; New-Item -ItemType Directory -Path $destination | Out-Null
    $link=New-TestPath '.link'; New-Item -ItemType Junction -Path $link -Target $destination | Out-Null
    Reject { Test-PortableArchive $zipPath '' (Join-Path $link 'extracted') $hashes '0.3.0' $payload $prefixes }
    Expect (-not [IO.Directory]::Exists((Join-Path $destination 'extracted')))
}
Case 'Missing ZIP' { Reject { Read-PortableBytes (New-TestPath '.zip') } }
Case 'Public package entrypoint refuses notices before creating a run' {
    $root=New-PublicNoticeFixture
    $publicScript=Join-Path $root 'scripts/build-portable-package.ps1'
    $preference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $lines=@(& powershell -NoProfile -ExecutionPolicy Bypass -File $publicScript -ExpectedSourceHead ('a'*40) -CompileRunId ('a'*32) 2>&1); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$preference }
    Expect ($code -ne 0 -and ($lines -join ' ').Contains('Gate=Notices') -and -not ($lines -join ' ').Contains($repo))
    Expect (-not [IO.Directory]::Exists((Join-Path $root 'tmp/portable-release')))
    # Availability may succeed, but a synthetic root has no valid signed source checkpoint.
    foreach ($name in @('manifest.json','review.json')) {
        [IO.File]::WriteAllText((Join-Path $root ('release/notices/'+$name)), '{"schema":1,"status":"REVIEWED","test_only":true}', [Text.UTF8Encoding]::new($false))
    }
    Assert-PortableNoticeAvailability $root
    try { $ErrorActionPreference='Continue'; $lines=@(& powershell -NoProfile -ExecutionPolicy Bypass -File $publicScript -ExpectedSourceHead ('a'*40) -CompileRunId ('a'*32) 2>&1); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$preference }
    Expect ($code -ne 0 -and ($lines -join ' ').Contains('Gate=Source') -and -not ($lines -join ' ').Contains($repo))
    Expect (-not [IO.Directory]::Exists((Join-Path $root 'tmp/portable-release')))
}
Case 'Public verifier refuses unavailable notice evidence' {
    $root=New-PublicNoticeFixture -MissingInventory
    $publicScript=Join-Path $root 'scripts/verify-portable-package.ps1'
    $preference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $lines=@(& powershell -NoProfile -ExecutionPolicy Bypass -File $publicScript -ExpectedSourceHead ('a'*40) -CompileRunId ('a'*32) -PackageRunId ('b'*32) 2>&1); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$preference }
    Expect ($code -ne 0 -and ($lines -join ' ').Contains('Gate=Notices') -and -not ($lines -join ' ').Contains($repo))
}
$summary=[ordered]@{classification='TEST_ONLY';passed=$passed;failed=$failed;exe_executed=$false;formal_package_generated=$false}
Write-ReleaseNewText (Join-Path $fixtures 'test-result.json') (($summary | ConvertTo-Json)+"`n")
Write-Output "Portable package tests: $passed passed, $failed failed. TEST_ONLY; no application executed."
if ($failed -gt 0) { exit 1 }
exit 0
