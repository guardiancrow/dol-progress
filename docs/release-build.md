# Windows portable release compile

この手順はPhase 23D-C1B-1の**portable release compile validation**を扱う。Windows x64の単一application EXEを、privacy検査付きの専用runnerで生成する。versionは0.3.0。正式release candidate、配布可能判定、一般公開の手順ではない。

第三者通知と包含条件、MPL/Unicode、WebView2 Loader SDK由来、toolchain生成物の条件は未解決。ZIP、SHA256SUMS、配布README/NOTICE生成、package検証、最小acceptanceは後続Phaseで扱う。compile成功によってlicense clearanceや公開可否が変わることはない。

## 前提とsource guard

Windows x64上の64bit PowerShell 5.1以降、x86_64-pc-windows-msvcのRust toolchain、Node/npm、Git、Microsoft C++ Build Tools/Windows SDKが必要。npm依存とRust dependency cacheは事前にlockfileに従って準備する。runnerはinstall/updateやnetwork fallbackを行わない。

Tauri CLIはpackage-lockと一致する2.11.xを要求し、build helpのno-bundle対応を確認する。Rust host triple、CLI version、Node/npm/Cargo/rustc/PowerShellを記録する。arm64/x86/GNU toolchainや32bit processは拒否する。PEでもx64 GUIを再確認する。

callerはreviewしたsource HEADを明示する。actual HEAD不一致、Git署名検証失敗、staged変更は停止する。通常はclean signed sourceを使用する。今回の未commit compile検証に限り、以下6pathの変更だけを許可し、変更pathと全source inputのhashをresultへ記録する。

- scripts/build-release.ps1
- scripts/check-release-privacy.ps1
- scripts/release-safety.ps1
- scripts/tests/release-tooling.tests.ps1
- docs/release-build.md
- src-tauri/tauri.conf.json

application source、dependency/lock、schema等の変更や未知のuntracked sourceは拒否する。これはcompile検証の限定条件であり、公開sourceのclean/signature gateの代わりではない。検査skip、test mode、任意dirty-tree許可optionはない。

## 実行

scriptとして実行し、dot-sourceしない。ExpectedSourceHeadには確認した40桁commitを指定する。

    & ./scripts/build-release.ps1 -ExpectedSourceHead <reviewed-40-character-HEAD>
    if ($LASTEXITCODE -ne 0) { throw 'Portable compile validation failed' }

VerboseBuildはcompiler診断を増やすだけで、同じguardとprivacy検査を必ず通る。formal compile commandは次のとおり。

    npm run tauri -- build --no-bundle -- --locked --offline

beforeBuildCommandがnpm typecheckとVite production buildを実行し、frontendはTauriへ埋め込む。Rustはrelease profile。NSIS/MSI、bundle-all、Runtime/bootstrapper生成は呼ばない。

tauri.confのbundle.activeはfalseとし、targets: allの明示指定を削除した。固定CLIのschemaではactiveはbundlingとEXE出力の切替である。tauri-build 2.6.3のWindows resource生成はactive判定から独立し、bundle.icon/copyright/productName/versionを使用するため、それらは維持する。identifier、frontendDist、Runtime preflight、保存契約は変更しない。[Tauri設定](https://v2.tauri.app/reference/config/#bundleconfig)。

## 環境と一意なrun

CARGO_HOMEはprocess値、未設定ならUSERPROFILE/.cargo。RUSTUP_HOMEはprocess値、未設定ならrustup show home。存在する正規のdirectoryを要求し、absolute値のslash/dot-segment正規化が必要なら停止する。実homeやcheckout pathをconsole/resultへ表示しない。

RUSTFLAGS、CARGO_ENCODED_RUSTFLAGS、CARGO_TARGET_DIR、CARGO_BUILD_TARGET、target linker/runner/rustflags、Cargo profile、Rust compiler/wrapper、TAURI_CONFIG等のoverrideは拒否する。Cargo homeとcheckout祖先の.cargo/config/config.tomlは存在だけを確認し、ambient configがあれば別途reviewするまで停止する。内容やcredentialsを読まず、暗黙のtarget変更を防ぐ。

runはGit ignoredなtmp/portable-releaseの下に新UUIDで作る。sourceとのcontainmentとancestorのreparseを検査し、既存runを再利用しない。ownership.jsonをcreate-newで作成する。

    tmp/portable-release/<run-id>/
      ownership.json
      target/
      logs/compile.txt
      output/
      temp/
      result.json

CARGO_TARGET_DIRはrun/target。TEMP/TMPはrun/tempにprocess内で切り替える。古いsrc-tauri/target/release、tmp/release-build、旧installer出力からEXEを探さない。expected inputはrun/target/release/dol-progress-manager.exeだけ。bundle/data/configの生成を検知したら失敗する。

outputへは全compile/privacy/source guardの成功後にEXEを非上書きcopyし、hashとprivacyを再検査する。cleanup/recursive deleteは実装しない。失敗runは診断用に残し、再実行は新UUIDを使う。旧成果物、production/user dataへアクセスしない。

## Privacy-safe compile

Cargo home→/cargo、rustup home→/rustupを維持し、checkout→/source、developer home→/user、元のTEMP/TMP→/temp、run→/build、target→/target、専用temp→/build-tempを追加する。Windows/backslashとforward slashを設定し、U+001F区切りのCARGO_ENCODED_RUSTFLAGSへ渡す。

rustcは最後に一致したmappingを採用するため、広いprefixを先、具体的prefixを後に置く。synthetic Rust sourceをLLVM IRへemitするtestで、実sourceを読めることとfile!文字列が最も具体的なvirtual prefixへ変わることを確認する。アプリのruntime path APIやstorage設定を改変しない。[rustc path remapping](https://doc.rust-lang.org/rustc/remap-source-paths.html)。

MSVCには/PDBALTPATH:%_PDB%をlink argumentとして渡す。EXE内のPDB locatorをbasenameへ限定し、実際のPDB生成先は変更しない。PDB自体はoutputへcopyしない。[Microsoft PDBALTPATH](https://learn.microsoft.com/en-us/cpp/build/reference/pdbaltpath-use-alternate-pdb-path?view=msvc-170)。

Rust remapがnative code、frontend、resource、generated code全てのpathを除くとは仮定しない。最終EXEのbyte検査を必須にし、明確な漏えいと根拠未確定のprintable pathはともに失敗させる。

## Scanner

    & ./scripts/check-release-privacy.ps1 -Path <artifact-file> -BuildRoot <owned-run-directory>
    if ($LASTEXITCODE -ne 0) { throw 'Privacy inspection failed' }

BuildRootは追加の検査prefixであり、検査を弱めるoptionではない。省略時もCargo/rustup/checkout/profile/TEMP/TMPを検査する。公開runnerは共通scanner関数を必ず呼び、skip optionを持たない。

known prefixはUTF-8とUTF-16LEのbyte検索で、非ASCIIやunaligned UTF-16LEも扱う。case、slash/backslash/混在separator、JSON escaped、Unicode separator escaped、percent encoded表現を検査する。virtual /cargo /rustup等はinformationalで件数を固定しない。

結果はartifact番号、category、encoding、count、pass/failだけ。入力path、検出substring、read errorのraw exceptionは出さない。複数categoryが同じbytesへ一致することがあり、件数は一意な秘密数ではない。

known prefixはdefinite leak。printableな未知のWindows absolute/UNC pathはreview requiredで、根拠なしに成功扱いしない。限定的なWindows System32/SysWOW64のDLL pathと、固定null deviceの`\\.\NUL`だけをallowed genericとして区別する。後者は最初のcompileで検出し、[Microsoftのdevice namespace仕様](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#win32-device-namespaces)と照合した。任意のdevice/UNC名を許可しない。単なるdrive-like machine bytesは自動漏えい扱いしない。無制限allowlistはない。heuristicは任意のsecret、全表現、他host由来のpathやmalwareの不存在を保証しない。

compile stdout/stderrはknown prefix、残るabsolute Windows path、代表的なsecret assignmentをredactしてからconsole/logへ出す。raw transcriptは保存しない。sanitized compile logもprivacy検査する。

## Manifest / source / failure

Cargo.tomlはcompile前のexact bytesとhashを保存する。変更がCRLF/LFだけでUTF-8正規化同一の場合に限り元bytesへ復元する。意味差分は復元せず、失敗としてreviewに残す。

trackedと許可したuntracked sourceの全inventory/hash、HEADを終了時に比較する。source変化、child command nonzero、missing/不正PE、bundle/data/config、privacy violation/review requiredはfailure。古いEXEの再利用はしない。childの失敗exit codeは維持し、guard failureは1。

finallyでCargo/rustup/flags/target/offline/TEMP/TMPとcwdを復元する。registry、user/machine environment、Runtime、Git index/historyは変更しない。成功はCOMPILE_VALIDATED、失敗はFAILEDとしてrun/result.jsonへ記録し、source HEAD・version・target・tool versions・input hashes・EXE name/hash・privacy・manifest guardをsanitizedな形で残す。途中失敗でoutput EXEが残ってもresult/exitが成功でなければ成果物として使わない。

## 検証と後続

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-tooling.tests.ps1
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
    npm run typecheck

testは専用ignored fixtureにsynthetic bytes/PE/sourceだけを作り、アプリEXEを起動しない。unreadable fixtureはFileShare.Noneで検証しACLを変更しない。process限定のexecution policy指定は恒久設定の変更ではない。

generated EXEはsize/hash、AMD64/PE32+/GUI、privacyをrunnerで検証する。詳細import/resource/package gateはC1B-2以降に分ける。application Rust/TS sourceが不変の場合、B3F full suiteを継承できる。必要な検証証拠は各Phase報告へ保存する。

C1B-2では5member staging、README/LICENSE/NOTICE input、内部manifest/外部ZIP hash、ZIP生成・独立verifierとnegative testsを実装する。C1Cでthird-party obligationsを解決し通知/metadataを確定する。一般公開にはpackage検証とminimal synthetic acceptanceが必要。

Authenticodeは別工程であり、今回は署名しない。WebView2 Runtimeは外部prerequisiteで、B2 native preflightを維持し、自動download/installしない。旧installer検証物は保存したまま新flowから隔離する。このrunnerはアプリ/installer/VM起動、Runtime導入、staging/commit/tag/push/公開を行わない。
