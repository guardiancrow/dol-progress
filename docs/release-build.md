# Windows版のビルドと配布検証

本書はWindows 10／11 x64向けの現行ビルド・配布検証手順の正本である。通常開発と、配布候補の正式検証を区別する。利用者の起動・更新・バックアップ手順は[README](../README.md)、第三者コードの条件と通知入力は[第三者ライセンス](third-party-licenses.md)を参照する。

旧非公開方針、PREVIEW、CRT方式の変更、通知組立の経緯は[開発・検証履歴](release-build-history.md)に保存している。過去のPhaseやローカル監査資料を読まなくても、以下の手順を実行できる構成とする。

## 対象環境と準備

64bit WindowsとPowerShell 5.1以降、Git、Node.js／npm、Rustの`x86_64-pc-windows-msvc` toolchain、Microsoft C++ Build Tools／Windows SDKを使用する。arm64、x86、GNU toolchain、32bit processは正式runnerの対象外である。Tauri CLIはlockfileと一致する2.11.xと、`build --no-bundle`対応を確認する。

npmとCargoの依存は事前にlockfileに従って準備する。正式runnerは依存のinstall／updateやnetwork fallbackを行わず、toolchainの版を記録して正式Noticesの承認対象と照合する。依存やtoolchainの更新を、配布手順の一部として自動実行しない。

### Windows CRTと外部Runtime

Windows／MSVCでは動的CRTを使用する。`src-tauri/build.rs`はtarget OS=windows／env=msvcの場合だけ、`tauri_build::build()`より前に`STATIC_VCRUNTIME=false`を設定し、Tauriの静的CRT強制を解除する。追加のRUSTFLAGS、crt-static、NODEFAULTLIB、警告抑制による切替は行わない。

Microsoft Visual C++ Redistributable x64（v14系）は、ビルド時のMSVCツールセットと同じか新しい互換版を外部導入する。画面表示にはMicrosoft Edge WebView2 Runtimeも必要である。両Runtimeを同梱・自動取得・導入しない。VC++ DLL不足はRust entry前に起動失敗する場合があり、アプリ内案内を保証できない。Rust entry後のWebView2 preflightと日本語案内は維持する。

SQLite bundledとWebView2 Loaderの静的リンク、OS提供UCRTへの依存は維持する。SQLiteライブラリの静的リンクと、そのCコードのCRT選択は別である。動的CRTでもstartup等の静的寄与が残るため、DLL importsだけでMicrosoft codeがゼロとは判断しない。WebView2のユーザーデータ領域は同じWindowsユーザー内で共有され、EXE配置だけでは隔離されない。

## 通常開発と正式Releaseの違い

通常開発は署名済みclean HEADを必須にしない。リポジトリのrootで起動する。

```powershell
npm run tauri dev
```

依存をcache済みの環境で、インストーラーを生成しないローカルReleaseビルドは次のとおり。

```powershell
npm run tauri -- build --no-bundle -- --locked --offline
```

この出力は`src-tauri/target/release/dol-progress-manager.exe`であり、正式runnerのrunに代わる配布入力ではない。通常の`cargo build`によるDebug EXEは開発サーバーを要求する場合がある。単体起動用のReleaseはTauri CLIのproduction buildでFrontendを埋め込む。

正式runnerも内部では同じTauri build commandを使い、beforeBuildCommandでtypecheckとVite production buildを行う。`bundle.active=false`を維持してNSIS／MSI／Runtime bootstrapperを生成しない。Windows resourceに必要なicon、copyright、productName、versionは保持する。

## 正式検証の入力とsource guard

配布候補はレビュー済みの署名付きcommitを基点とし、indexとworking treeが完全にcleanな状態から生成する。`ExpectedSourceHead`はその40桁SHAで、実HEAD・Git署名・全入力のhash・versionをrunnerが検査する。

| 入力 | 検証する対応 |
| --- | --- |
| source | HEAD、署名、追跡／入力inventory、開始・終了時のbytesとhash |
| version | package.json、tauri.conf.json、Cargo.toml、Cargo.lock、npm lockのアプリ版。依存の版をアプリ版と取り違えない |
| 正式Notices | 署名対象のmetadata・原文・通知正本、承認状態、coverage、lockとtoolchain。詳細は[正式入力の検証仕様](third-party-licenses.md#正式入力の検証仕様) |
| compile run | ownershipとresult、同じHEAD・version・target・command、clean source、EXEとlogのprivacy、manifest guard、全input hash |
| package run | 同じHEAD・CompileRunId・version、成功result、ZIPと外部hash、stagingと原本 |

不一致、署名検証失敗、staged変更、未知のuntracked source、application／依存／schemaへの許可外変更は停止する。任意のdirty-tree許可、skip、公開entryのtest modeはない。

compile runnerには限定的なツール検証用として、次の6pathだけの未commit変更を記録する既存処理がある。これは正式配布のclean要件の代替ではなく、そのrunはPackage入力として使えない。

- scripts/build-release.ps1
- scripts/check-release-privacy.ps1
- scripts/release-safety.ps1
- scripts/tests/release-tooling.tests.ps1
- docs/release-build.md
- src-tauri/tauri.conf.json

Packageと独立Verifierは`CLEAN_SIGNED_CHECKPOINT`、dirty_paths空、`COMPILE_VALIDATED`／exit 0を要求する。限定compile例外をPackageへ拡張しない。sourceを変更したら旧HEADのrunを使わず、署名済みcleanな新HEADで全工程をやり直す。

### 環境とrunの分離

CARGO_HOMEはprocess値または既定のCargo home、RUSTUP_HOMEはprocess値または`rustup show home`を用いる。存在する正規directoryを要求し、絶対値のslash／dot-segment補正が必要なら停止する。実home・checkout pathを公開log／resultへ出さない。

RUSTFLAGS、CARGO_ENCODED_RUSTFLAGS、CARGO_TARGET_DIR、CARGO_BUILD_TARGET、target linker／runner／rustflags、Cargo profile、compiler／wrapper、TAURI_CONFIG等の外部overrideは拒否する。Cargo homeとcheckout祖先の.cargo/config／config.tomlは内容やcredentialsを探索せず、存在する場合はreviewするまで停止する。

runはignoredの`tmp/portable-release/<新UUID>/`へcreate-newで作り、ownership.jsonを記録する。containmentとancestorのreparseを検査する。compileはrun専用target／temp、Packageは専用staging／verify／logs／outputを使用する。TEMP／TMP等はprocess内で切り替え、finallyで環境とcwdを復元する。

古いtargetやinstallerからEXEを探索せず、compileのrun/target/release内の指定EXEだけを検査する。bundle／data／config生成を検知したら失敗する。targetとoutputのEXE hashを照合し、ownership markerより古いEXEを拒否する。Packageは現在のhost prefixでEXEとcompile logのprivacyを再検査する。

## 正式3工程の実行

以下はリポジトリrootで、レビュー済みcommitにcheckoutしてcleanであることを確認してから実行する手順である。scriptとして呼び、dot-sourceしない。各工程の表示・resultからrun IDを確認し、次へ入力する。Packageはcompileを自動実行しない。

```powershell
$expectedHead = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'HEAD確認失敗' }

& ./scripts/build-release.ps1 -ExpectedSourceHead $expectedHead
if ($LASTEXITCODE -ne 0) { throw 'Compile失敗：resultを確認' }

$compileRunId = Read-Host '成功したCompileRunId'
& ./scripts/build-portable-package.ps1 -ExpectedSourceHead $expectedHead -CompileRunId $compileRunId
if ($LASTEXITCODE -ne 0) { throw 'Package失敗：resultを確認' }

$packageRunId = Read-Host '成功したPackageRunId'
& ./scripts/verify-portable-package.ps1 -ExpectedSourceHead $expectedHead -CompileRunId $compileRunId -PackageRunId $packageRunId
if ($LASTEXITCODE -ne 0) { throw '独立Verifier失敗：resultを確認' }
```

CompileRunId／PackageRunIdは32桁hexのrun識別子で、任意EXE pathや任意OutputPathへ置き換えない。Compile、Package、独立Verifierの3つの成功を確認する。途中のファイルが存在するだけでは成功としない。

compile toolchainはrustc、cargo、node、npm、tauri_cli、powershellの順にname=valueとLFで連結し、UTF-8 BOMなし・最終LF込みでSHA-256を求め、Noticesの承認hashと照合する。rustcの複数行もLFで連結する。異なるtoolchainのrunを無条件に流用しない。

Cargo.tomlは開始時のexact bytesを記録し、CRLF／LF差だけで正規化後に同一の場合に限り元bytesへ戻す。意味の異なる変更は復元せず失敗とする。source変化、child command nonzero、不正PE、privacy失敗、manifest guard不一致も失敗とする。子processの失敗exit codeを維持する。

### 成功記録と失敗時の扱い

compileは`COMPILE_VALIDATED`、Packageは`PACKAGE_VERIFIED`／exit 0を記録する。独立VerifierはPackageIntegrity=PASSと検査件数・ZIP hashを記録する。各runのownership／result／log、HEAD、input hash、EXE hashの対応を確認する。

全guard成功後だけoutputへ非上書きcopyし、コピー後のhashも検査する。preflight失敗ではrunを作らず、途中失敗のresultはFAILED／nonzeroとなる。診断表示はgate名などに限定する。失敗runは診断用に保持し、retryは新UUIDとする。既存run／ZIP／EXE／installerの再利用、削除、上書き、cleanup用の再帰削除は行わない。

公開可否のフィールド`public_release=NOT_AUTHORIZED`は、技術的なPackage成功と公開承認を分けるためのもの。成功だけを理由に法的・公開承認metadataを変更しない。

## Portable ZIPと文書・hashの契約

ZIPは次の5件だけをOrdinal順に格納し、directory entryを作らない。writerは固定mappingを使い、stagingの再帰圧縮を行わない。hidden／extra fileも拒否する。

```text
DOL-Progress-Manager/LICENSE.txt
DOL-Progress-Manager/README.txt
DOL-Progress-Manager/SHA256SUMS.txt
DOL-Progress-Manager/THIRD-PARTY-NOTICES.txt
DOL-Progress-Manager/dol-progress-manager.exe
```

DB／data／config／WAL／SHM／backup／取得CSV、PDB／ILK／log、source／.git／node_modules／target／tmp／tests／scripts、NSIS／MSI／Runtime／bootstrapperを含めない。ユーザーデータや保存場所・Recovery・Runtime動作はPackage工程で操作しない。

README.mdの冒頭と指定11節を全文抽出する。主な機能、起動・Runtime、手動import、保存場所、backup／restore、移動、更新、削除、旧版／Custom移行、謝辞、Licenseを含め、開発・Windows build・仕様書一覧は除外する。必要見出しの一意性、Windows x64、Runtimeの公式URL、安全説明を確認し、不足・未対応Markdown・未解決linkは失敗とする。正確な見出し一覧は`Get-PortableReadmeSections`にある。

README.txtはUTF-8 BOM、CRLF、末尾CRLFで、trusted sourceのApplication versionを先頭へ付ける。HTTPS linkはlabelとURLを保持し、LICENSEはLICENSE.txt、第三者方針はTHIRD-PARTY-NOTICES.txtへ対応付ける。他の補助docs linkは開発資料でZIPにない旨を明記し、安全説明を非同梱docsだけに依存させない。LICENSEと通知は原本bytesを保持し、staging／ZIP展開後のhashを照合する。

SHA256SUMS.txtは自身を除く4basenameをOrdinal順に記載する。形式はlowercase hex64桁、ASCII空白2個、basename、LF、UTF-8 BOMなし、最終LF。ZIP名はsource versionから`DOL-Progress-Manager_<version>_windows-x64_portable.zip`を作り、ZIP外の`<ZIP名>.sha256`には同じ形式でZIPだけの1行を記す。ZIPを閉じて独立検証した後に外部hashを確定する。

独立Verifierは生成側のmember／manifest処理に依存しない読取器で、固定5件、CRC／展開hash、SHA256SUMS、外部hash、PEのAMD64／PE32+／GUIとversion、原本との対応、privacyを検査する。extra／duplicate／unsafe名、header／size／flag／attribute不正、破損、展開・出力衝突、unreadable／reparseは拒否する。

writerは.NET ZipArchiveで5entryを明示作成し、Deflate（CompressionLevel.Optimal）、timestamp=1980-01-01 00:00:00、ExternalAttributes=0、ASCII member名とUTF-8 encoding指定を使用する。許可flagは0またはUTF-8 flagだけで、central／localの一致を要求する。同じfixtureのZIP bytes一致はテストするが、compileしたEXE全体のbit-for-bit再現性を保証しない。

独立読取器はZIP32のcentral／local headerとEOCD、件数・名前・順序、version、method、timestamp、属性、size／offset、連続配置を検査する。extra／comment、preamble／trailer、ZIP64、暗号化、data descriptor、別compression、directory／symlink、重複・大小文字衝突、traversal／absolute／drive／ADS／UNC／backslashを拒否する。汎用ZIP互換性のために許容範囲を広げない。

上限はZIPと展開合計96MiB、EXE 64MiB、Notices 16MiB、README／LICENSE各2MiB、SHA256SUMS 4KiB。DeflateStreamで上限付き展開し、sizeと独自CRC32を確認する。.NETの展開成功だけをCRC確認の代替にしない。manifestのencoding／LF／4件／順序／文法を独立に解析し、source payload、staging、展開bytes、書込み後の5ファイルのSHA-256を照合する。PEのFileVersion／ProductVersionもsource版に一致させるが、実行時依存やAuthenticodeの受入試験を代替しない。

unsafe entryを先に展開してから拒否する方式にはしない。構造・CRC・manifest・文書のgate通過後だけ、新規verify directoryへ固定path・create-newで展開し、containment／reparseを再確認する。payload全5件、展開内容、member名、生成log、外部hashのprivacyも検査する。上限変更や対応ZIP形式の追加は別途reviewが必要である。

## Privacy検査

runnerはpath remapと最終artifact／logの検査を併用する。Rust用にはCargo→/cargo、rustup→/rustup、checkout→/source、developer home→/user、元TEMP／TMP→/temp、run→/build、target→/target、専用temp→/build-tempを設定する。広いprefixから具体的prefixの順で、Windows／forward slash両表現をU+001F区切りのCARGO_ENCODED_RUSTFLAGSへ渡す。

MSVCの`/PDBALTPATH:%_PDB%`でEXE内PDB locatorをbasenameに限定する。PDB自体は配布しない。Rust remapだけでnative／Frontend／resource／生成codeの全pathが消えると仮定しない。

scannerを単独で確認する場合の形式は次のとおり。`Path`と`BuildRoot`は実際の検査対象に置き換える。

```powershell
& ./scripts/check-release-privacy.ps1 -Path <artifact-file> -BuildRoot <owned-run-directory>
if ($LASTEXITCODE -ne 0) { throw 'Privacy検査失敗' }
```

BuildRootは追加prefixで、検査を省略するoptionではない。既定でもCargo／rustup／checkout／profile／TEMP／TMPを検査する。UTF-8／UTF-16LE、非ASCII・unaligned UTF-16LE、大小文字、slash混在、JSON／Unicode separator escape、percent encodingを扱う。

既知prefixの漏えいと、未知のprintable Windows absolute／UNC pathでreviewが必要なものはともに失敗とする。限定的なSystem32／SysWOW64のDLL pathと固定null deviceだけを区別し、任意device／UNCや無制限allowlistへ拡張しない。virtual pathは参考情報で件数を固定せず、単なるdrive-like bytesを自動漏えい扱いにしない。

検出結果はartifact番号・category・encoding・count・pass/failのみとし、実path、substring、raw exceptionを出さない。stdout／stderrは既知prefix、残存absolute path、代表的なsecret assignmentを除去して保存し、raw transcriptは残さない。sanitized logも検査する。scannerは任意secret・全表現・他host由来path・malwareの不存在を保証するものではない。

## 関連テスト

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/portable-package.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-tooling.tests.ps1
npm run typecheck
```

これらのPowerShellテストは専用ignored fixtureにTEST_ONLY marker、resource-only合成PE、文書、合成ZIPを作り、実EXE・実DBを使用しない。unreadableはFileShare.Noneで検証しACLを変更しない。正式entryの拒否も合成入力で確認し、公開entryへtest modeを追加しない。固定構成、CRC／hash、privacy、provenance、Notices、衝突等の正常・異常系を保持する。process限定ExecutionPolicy指定は恒久設定を変更しない。

## 現在の確認結果と公開前の残件

既存の署名済みHEAD `482b9ae80f117946f6c36cc093b27f27666d044e` に対して正式Compile・Package・独立Verifierは成功済みである。これはそのHEADに限る検証結果で、文書変更後のHEADの成功とは扱わない。run識別子とhashを含む記録は[履歴の確認状況](release-build-history.md#現在の公開準備状況)に保持する。NoticesはREVIEWED、201通知・6除外、148原文・357参照のままとする。

SDK受領者条件の同程度の保護と合意方式、MSVC startupの再配布根拠、配布者の補償等の判断は未完了。[Microsoft関連の区分](third-party-licenses.md#microsoft関連の確認範囲と残件)を参照する。SDK草案を承認済みの条文として挿入しない。

承認済みConsentはversion 1であり、本文・hash・安全保存を維持する。v2は最終文面と正式採用日の承認後に扱い、正規化方式を変えなければcanonicalVersion 1、旧記録の自動承認をしない既存再同意を使う。実際のGitHub公開状態と公開先URLも確認する。

### GitHub公開までの概要

最終文面・必要条件の確定とレビュー、署名commit・clean HEAD確定、新HEADでの正式3工程、最終ZIPの手動smokeを順に行う。手動確認はテストユーザー／VMの新規書込み可能配置で、初回同意・通常画面・終了・再起動・同梱文書を確認し、実DB／config／backupを持ち込まない。

その後に最新origin/mainとのfast-forward可否、公開する全履歴・branch・tag、Actions／ログ／成果物、Issues／PR等とGitHub設定を確認する。本人の別途承認後に同期・Public化、検証した最終HEADのsigned annotated tag、Release Draft、正式ZIPと外部hashの添付・確認、Publishを行う。公開・upload・tag操作はビルドrunnerに含まれない。

EXEはAuthenticode未署名であり、Git署名と区別して利用者へ案内する。技術検証、Noticesレビュー、法的条件の充足、公開承認は別の判断である。過去の成功だけで公開可能と断定しない。
