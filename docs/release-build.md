# Windows portable release compile / package verification

この手順はPhase 23D-C1B-1の**portable release compile validation**と、C1B-2の固定ZIP生成・独立検証を扱う。Windows x64の単一application EXEを専用runnerでcompileし、package工程はその検証済みrunを入力にする。versionは0.3.0。正式release candidate、一般公開の手順ではない。

第三者通知と包含条件、MPL/Unicode、WebView2 Loader SDK由来、toolchain生成物の条件は未解決。ZIP/hash/verifierのlogicは合成fixtureで検証するが、正式通知入力がない現在は正式packageを拒否する。READMEにはWindows x64と外部Runtimeの前提条件を記載し、generatorは不足説明を捏造しない。通知原本・review evidence、最終versionとminimal acceptanceの完成は後続Phaseに残る。compile成功によってlicense clearanceや公開可否が変わることはない。

## Windows CRTの動的リンク

lock済みTauri CLI 2.11.4／tauri-build 2.6.3では、最新資料の
`build.windows.staticVCRuntime`はschema未対応である。`src-tauri/build.rs`はCargoの
target OS=windows／target env=msvcの場合だけ、tauri_buildの呼出し前に
`STATIC_VCRUNTIME=false`を設定する。これでTauriの静的CRT強制helperを無効にする。
Cargoの`crt-static`や外部RUSTFLAGSを追加せず、SQLite bundled／Loader staticを維持する。
`bundle.windows.bundleVCRuntime`も追加せず、Runtime DLL非同梱は固定5member契約で保つ。

最初の診断buildは0.3.0の署名済みclean HEADから既存runnerのVerboseBuildで行う。
SQLite C compileの`/MD`、objectのMSVCRT directive、最終VCRuntime DLL imports、
Tauriの静的DEFAULTLIB／NODEFAULTLIB強制の解消とCRT競合警告の不在を照合する。
必要なstartup／import stubの静的寄与までゼロとは要求しない。compiler診断を増やす場合も
flagsやgateを変更せず、既存sanitized log／privacy検査を通す。
EXE起動とsynthetic DBの複数回読み書き・再起動後の永続性は後続の実行時検証とし、
compile成功だけで動作上の安全性を最終PASSにしない。

## 未承認third-party noticeの組立

Phase 23D-C1C-B2Bの組立scriptはcompile/package runnerと独立している。application build、
network取得、cache探索、formal入力の作成を行わず、明示された証拠bundleだけを読む。

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-third-party-notices.ps1 `
      -InputManifest release/notice-source/manifest.json `
      -OutputDirectory tmp/notice-source-draft
    if ($LASTEXITCODE -ne 0) { throw 'Draft assembly failed' }

OutputDirectoryはignored `tmp/`内の未使用directoryを指定する。成功時は
`THIRD-PARTY-NOTICES.DRAFT.txt`、`notice-inventory.DRAFT.json`、`assembly-result.json`を作る。
失敗時はnonzeroで、pathやraw例外をconsoleへ表示しない。入力検証を終えてから出力先を作り、
既存directoryを再利用しない。I/O途中で失敗したdirectoryは診断用に残し、次は新しいdirectoryを使う。

入力manifestはschema1、kind `NOTICE_ASSEMBLY_DRAFT`、status DRAFT、version/target/source HEAD、
inventory file/hash、copyright assessment file/hash、期待件数、component contractsを持つ。
inventoryはrecords、hash/version/originを持つtexts、実owner表示を検証するsource filesを持つ。
file参照はbundle内の相対pathだけを認め、traversal/absolute/reparseを拒否する。
原文148種類はraw bytesのSHA-256で照合し、本文はLFで組み立てる。COPYRIGHT/NOTICEと
componentの対応をcontractで固定し、同本文のorigin/version associationを保つ。

NOTICEとinventory/result JSONは同じ入力とPowerShell環境で再実行してbyte一致を検証する。
componentと本文はcultureに依存しないordinal順。契約は入力inventoryのhashも固定し、
version/OR/AND/表示/未解決項目の変更を無条件に受け入れない。入力manifest自体の正当性・
全適用条件は実reviewとversion管理で確定するもので、hash照合だけでclearanceを証明しない。

Phase 23D-C1C-C1の[正本候補](../release/notice-source/README.md)はmanifest/inventory/provenance、
148原文、6公開source証拠、限定copyright reviewを持つ。752IDと未解決状態を維持する。
source_mode=VERSIONED_CURATEDでは、provenance hash、個別収録根拠、原本/curated hash、
component/version/式・出典・必要assetを追加検証する。原本は変換なしだけを認める。
必要assetが保留ならINCOMPLETEで止め、旧tmp/cache/networkへfallbackしない。
本文を収録しない契約・data・監査資料は独立したreferenceで、assembly inputとして使わない。
生成inventoryのfile参照は`input_bundle_reference`で識別する入力bundleを基準とし、
出力directoryに原文があるとは扱わない。

formal `release/notices/`へのmappingは別工程である。manifest/inventory/reviewと原文を
署名対象へ含め、実reviewer、全ID coverage、必要表示、source実提供、hash/locksを揃える。
原本に独立owner表示がない場合の限定schema表現は
[third-party方針](third-party-licenses.md#独立した著作権者表示がない原本)を参照する。
既存のREVIEWED・signed evidence・MPL COMPLETE/HTTPS・本文/表示・16MiB gateは維持し、
draft markerも明示拒否する。未公開source候補や今回のdraft成功でpackage gateを開けない。

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/third-party-notices.tests.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/notice-source.tests.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/portable-package.tests.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-tooling.tests.ps1

既存testsと新validatorのnegative testsは合成データを使う。新source-only検証は宣言済み正本と
必要source filesだけを隔離directoryへcopyし、空のcache指定・無効proxyで実207/148を組み立てる。
入力に旧ignored監査bundleを使わず、同じ入力から3出力fileのbyte一致と旧通知hashを確認する。
Gitは出力先のignore確認にだけ使う。新clone/Git変更は不要で、原本の存在・hashと正式な条件履行は別。
application source不変のため既存full suiteを継承し、fmt/typecheckを
再実行する。新application compileが必要な最終helper/native帰属は、目的・privacy対策・
検証方法を別Phaseで明示する。

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

C1B-2のpackage/verifierは以下の工程を実装する。C1Cでthird-party obligationsとREADMEを完成し、metadataを確定する。一般公開にはclean checkpointからの正式compile/packageとminimal synthetic acceptanceが必要。

Authenticodeは別工程であり、今回は署名しない。VC++ Redistributable x64とWebView2 Runtimeは外部prerequisiteで、B2 native preflightを維持し、自動download/installしない。VC++不足はRust entry前に起動失敗し得るため、アプリ内preflightを保証しない。旧installer検証物は保存したまま新flowから隔離する。このrunnerはアプリ/installer/VM起動、Runtime導入、staging/commit/tag/push/公開を行わない。

## Package entryとsource trust

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-portable-package.ps1 -ExpectedSourceHead <signed-clean-HEAD> -CompileRunId <compile-run-UUID>
    if ($LASTEXITCODE -ne 0) { throw 'Portable package failed' }

packageはcompileを呼ばない。EXE pathや任意OutputPath、notice/test/skip optionは受け付けない。必要なnotice inputがない時点でfail closedに停止し、run/ZIPを作らない。入力がある場合はGit署名、ExpectedSourceHead、完全clean source、source versionを要求する。compileの限定dirty例外をpackageへ拡張しない。C1B-2の未commit sourceから正式packageを作ることもできない。

compile runはtmp/portable-release/<UUID>のownership/resultから特定する。current signed HEAD、CLEAN_SIGNED_CHECKPOINT、dirty_paths空、COMPILE_VALIDATED/exit 0、target、version、formal build command、EXE名/hash、privacy/log PASS、manifest guard、全source input hashを検査する。target/outputの双方のEXE hashを照合し、markerより古いtarget EXEを拒否する。privacyを現在のhost prefixで再検査する。C1B-1の未commit compile runを現在のHEADの成果物に流用しない。

### 固定5member

ZIPには次のファイル5件だけをOrdinal順で入れる。directory entryは入れない。writerはこの固定mappingを使用し、directoryを再帰的にZIPへ詰めない。hidden/extra staging fileも拒否する。

```text
DOL-Progress-Manager/LICENSE.txt
DOL-Progress-Manager/README.txt
DOL-Progress-Manager/SHA256SUMS.txt
DOL-Progress-Manager/THIRD-PARTY-NOTICES.txt
DOL-Progress-Manager/dol-progress-manager.exe
```

data/config/DB/WAL/SHM、PDB/ILK/log、source/.git/node_modules/target/tmp/tests/scripts、NSIS/MSI/Runtime/bootstrapper/GVDB/user backupは含めない。初回起動の保存契約はapplication側のまま維持する。

### READMEとLICENSE

README.mdから概要、主な機能、動作環境と起動、GVDB手動import、保存場所、backup/restore、folder移動、更新、削除、旧版/Custom、謝辞、Licenseの各節を全文抽出する。開発と検証、Windows build、仕様書一覧は除外する。必須sectionの一意性、Windows x64、VC++ Redistributable x64とofficial導入URL、official WebView2 URL、各運用説明を確認し、不足や未対応Markdown/未解決linkはfailureとする。Runtimeの前提条件と未導入時の案内は利用者向けREADMEに保持する。

HTTP URLはhttpsのみを扱い、labelとURLを保持する。LICENSEはLICENSE.txt、third-party方針はTHIRD-PARTY-NOTICES.txtへ明示mappingする。その他の補助docs参照はlabelと元のrelative targetを残し、「開発資料、ZIPには含みません」と説明する。C1Aの補助relative link処理案を、C1B-2指示のlink先保持に合わせた。配布に必須の安全説明を非同梱docsへ依存させる改訂は行わない。

README.txtはUTF-8 BOM、CRLF、末尾CRLF。見出し/表/箇条書き/code fence等の本文構造はtextとして保持し、要約しない。先頭にtrusted sourceからApplication versionを付記し、verifierで一致を要求する。LICENSE.txtはLICENSE原本bytesをそのままcopyし、source/staging/decompressed/extractedのSHA-256を照合する。

## C1Cへのnotice input契約

正式inputはsigned source内の固定release/notices配下に置く。現在この入力は存在せず、REVIEWED metadataも通知原本も生成していない。docs/third-party-licenses.mdの名前変更/copy、単なるnotice file存在ではgateを通さない。

| ファイル | 必須契約（schema 1） |
| --- | --- |
| manifest.json | status=REVIEWED、scope=DISTRIBUTION、boolean test_only=false、source version、unresolved空array。inventory/review/noticesのSHA-256、Cargo/npm lock hashes、compile toolchain hashを束縛する。 |
| inventory.json | schema/version、target=x86_64-pc-windows-msvc、components。各id/version/group/included（boolean）。rust/frontend/native/toolchain/assetsの全groupが必要。包含/除外のactual evidenceをC1Cで確定する。 |
| review.json | schema/version、status=REVIEWED、boolean test_only=false、reviewer/reviewed_at、unresolved空array、coverage。inventoryの全idへ一意に対応し、included一致、obligations_completed/provenance_completedのboolean trueとsigned evidence pathが必要。 |
| THIRD-PARTY-NOTICES.txt | manifestが束縛する完成原本。TEST_ONLY/SYNTHETIC/PLACEHOLDER/TODO/TBD/UNRESOLVEDを含まない。単なるcomponent一覧では完成としない。 |
| texts/*.txt | reviewのrequired_textsから固定relative pathとSHA-256で参照する必要なLICENSE/NOTICE/copyright原文。原文全文がnotice本文に存在することを確認する。 |

manifestのhash field名はinventory_sha256、review_sha256、notices_sha256、cargo_lock_sha256、npm_lock_sha256、toolchain_sha256。compile toolchain hashはresult.toolchainのrustc/cargo/node/npm/tauri_cli/powershellをこの順で、name=value＋LFとしてUTF-8 BOMなしで連結したSHA-256。rustc arrayの各行もLFで連結する。最終LFを含める。native/host生成物の条件を異なるtoolchainのcompileへ無条件で継承しない。

coverageのincluded recordはselected_license、required_texts（path/sha256）、copyrights、source_provision（NOT_REQUIREDまたはCOMPLETE）を持つ。MPLを選択したrecordではCOMPLETEとhttps source_urlを必須とする。除外recordはexclusion_reasonを必要とする。evidenceはsigned sourceに実在するrelative path、required_textsはrelease/notices/texts配下のtxtだけ。missing/duplicate/不一致、blocker、原文/hash/copyright不足はfailure。

これはC1Cの人による包含・原文・SDK由来・MPL source提供・Unicode・toolchain条件reviewを受け渡す契約であり、文字列検索だけで法的充足やURL到達可能性を証明するものではない。signed source内のreview証拠を必要とする。合成noticeや偽のclearance metadataを正式inputとして使用しない。

## ZIP / manifest / 独立verifier

SHA256SUMS.txtはEXE/README/LICENSE/noticesの4basenameをOrdinal順に記載する。lowercase hex64桁、ASCII space2個、basename、LF、UTF-8 BOMなし、最終LF。manifest自身を対象に含めない。外部<ZIP basename>.sha256も同formatでZIPだけの1行。ZIP名はtrusted source versionからDOL-Progress-Manager_<version>_windows-x64_portable.zipとする。0.4.0を固定値にせず、現在0.3.0を維持する。

writerはWindows標準.NET ZipArchiveで明示5entryをCreateし、CompressionLevel.Optimal（Deflate）、1980-01-01 00:00:00、ExternalAttributes=0、ASCII member名をUTF-8 encoding指定で生成する。PS5.1/.NET FrameworkのASCII名ではflag=0となる。verifierはflag=0またはUTF-8 flagだけを許可し、central/local一致を要求する。fixed timestampが有効なことと、同fixtureの2回生成bytes一致をtestsで確認する。compiler EXEのbit-for-bit再現性を保証するものではない。

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-portable-package.ps1 -ExpectedSourceHead <signed-clean-HEAD> -CompileRunId <compile-run-UUID> -PackageRunId <package-run-UUID>
    if ($LASTEXITCODE -ne 0) { throw 'Independent verification failed' }

public verifierはsource/notice/compile gateを再検査し、owned package runの既存ZIPをread-onlyで読む。generatorを呼ばず、新規owned verification runにだけ展開する。low-level readerもgeneratorとは独立して自身の5member/順序/制約を持ち、ZipArchiveの展開成功に依存しない。

readerはraw ZIP32のcentral/local headers、EOCD、count/name/order、version、flags/method、timestamp、attributes、size/offset、contiguous layoutを検査する。extra/comment、preamble/trailer、ZIP64、encryption、data descriptor、別compression、directory/symlink、重複/大小文字衝突、traversal/absolute/drive/ADS/UNC/backslash等をfixed exact allowlistで拒否する。汎用ZIP互換性を目的としたparserではない。[PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)を根拠に必要なsubsetだけを実装した。

DeflateStreamで全entryを上限付きでdecompressし、sizeと独立CRC32を照合する。.NET FrameworkのZIP readではCRC確認を前提にできないため、自前計算で補う。[Microsoft ZIP integrity説明](https://learn.microsoft.com/en-us/dotnet/standard/io/zip-tar-best-practices)。上限はZIP/展開合計96 MiB、EXE64 MiB、notices16 MiB、README/LICENSE各2 MiB、manifest4 KiB。現在の検証EXEは約13 MiB。上限を超える将来versionは別途reviewが必要。

manifestは独立したstrict parserでencoding/LF/4件/order/grammar/hashを確認し、decompressed bytesからSHA-256を再計算する。source payload、staging5file、decompressed5member、extracted5fileのhashを照合する。PEはAMD64/PE32+/GUIとVERSION resourceのFile/ProductVersionを検査し、source versionに一致させる。これはapplicationを実行しない基本PE gateであり、完全なimport/runtime dependency/Authenticode acceptanceを代替しない。

unsafe entryを含むZIPを展開してから検知する方式にはしない。構造/CRC/manifest/document gateが通ってから、新規verify directoryへ固定path・create-newで展開する。reparse/containmentを再確認し、既存fileを上書きしない。payload全5fileと展開内容、member名、生成log、外部hashを既存privacy scannerで検査し、definite leak/review requiredはfailure。

## Package runとfailure

compile runはread-only input。packageは別の新UUID runを作り、ownershipにsource HEADとcompile run IDを記録する。

```text
tmp/portable-release/<package-UUID>/
  ownership.json
  staging/DOL-Progress-Manager/  # fixed 5 files
  verify/                      # candidate ZIP, external hash, fresh extraction
  logs/                        # fixed sanitized records/member names
  output/                      # all gates passed only
  result.json
```

ZIPをcloseして独立検証した後で外部hashを確定する。source bytes/HEAD/clean stateが不変と確認し、全gate成功後にoutputへ非上書きcopyする。分類はPACKAGE_VERIFIEDで、public_release=NOT_AUTHORIZED。これはpackage integrityの判定であり、一般公開の承認ではない。途中failureはFAILED/nonzeroとし、診断はgate名のみ。preflight失敗ではrun自体を作らない。result/log/exitの成功が揃わないpartial outputを成果物として使用しない。

cleanup/recursive delete、古いrun/installer/ZIPの再利用・削除・上書きは実装しない。retryは新UUID。storage/bootstrap/Recovery/Runtime/import/backupの変更やuser data操作は行わない。

## Synthetic検証

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/portable-package.tests.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-tooling.tests.ps1
    cargo fmt --manifest-path src-tauri/Cargo.toml --check
    npm run typecheck

新testsはignored tmp/phase-23d-c1b-2/tests/<UUID>だけにTEST_ONLY marker、resource-only合成PE、合成README/LICENSE/notices、TEST_ONLY名のZIPを生成する。実EXEや本番データをZIP入力へ使用しない。低レベルhelperへのfixture注入でlogicを検証し、public entryにはtest modeを追加しない。正式notice gateが欠落inputを拒否することもpublic entryで確認する。第三者通知が未解決の現在、正式ZIPは生成しない。

positive/negative testsは5member、決定的order/timestamp、CRC/decompression/hash、外部hash、各missing/extra/duplicate/unsafe member、header/size/flags/attributes/corruption、manifest、PE/version、privacy、stale provenance、notice、output/extraction collision、unreadable/reparseを対象にする。C1B-1の50 testsもregressionとして再実行する。application Rust/TS不変ならB3F full suiteとC1B-1 compileを継承し、新compileやアプリ起動は不要。
