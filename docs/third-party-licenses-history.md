# 第三者ライセンスの開発・検証履歴

本書は過去の開発・検証・ライセンス調査に関する記録です。記載された方針やコマンドには現在適用されないものが含まれます。最新の手順と条件は[現行の正本](third-party-licenses.md)を参照してください。

## 記録の基点と読み方

文書再構成前のcommit `f232b27e2e53995616e9e98127f0855cf2a63413` に保存された原稿を、判断・失敗・留保を省略しない記録として保持する。当時は現行仕様と開発履歴が混在していたため、共通仕様の旧説明も含む。現在有効な仕様は現行文書へ整理し直しており、この記録を仕様の正本とはしない。

以下の「現在」「未完了」「予定」「今回」は原稿作成当時の記述である。PENDING、非公開方針、旧HOLDを現行の状態へ適用しない。コマンドは当時の資料であり、実行する場合は必ず現行手順を確認する。履歴書換えや既存成果物の削除を指示するものではない。

`tmp/` の証拠や実行ログはローカルのignored資料であり、この履歴とともにGit追跡対象へ追加していない。該当するMarkdownリンクは参照先を示す文字列へ変更した。現行手順はそれらの資料がなくても読める構成とする。

---

# Third-party licensesとrelease方針

## 現在の公開計画と確認状況

ソースコードのGitHub Public化とWindows x64 Portable ZIPのGitHub Releases配布を計画する。
現在は公開用文書と関連テストの整備段階であり、実際の公開・配布や法的条件の充足を認定しない。
独自コード・文書・合成テスト・独自アイコンには[MIT License](../LICENSE)を適用し、第三者コード・データ・商標の権利とは区別する。

- rootの[THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)と`release/notices/`は正式レビュー済み。
  201通知・6除外、原文148種類・357参照、REVIEWED metadataと原文hashを維持する。
- WebView2 SDK LICENSE／NOTICE、現行依存・Rust提供元通知等の完了事項を、下記の旧記録を理由に未完了へ戻さない。
- HEAD `482b9ae80f117946f6c36cc093b27f27666d044e` の正式Release／Package／独立Verifierは成功済み。
  runとhashの対応は[Release手順](release-build.md)に記録する。文書変更後の新HEADの検証成功を意味しない。
- ZIPはEXE・README・LICENSE・Notices・SHA256SUMSの固定5ファイルとし、外部.sha256を提供する。
  VC++ Redistributable／WebView2 Runtime／OS DLL本体、取得CSV、個人DB・設定・backupは同梱しない。
- Windows SDKのucrt.lib／ntdll.libの対象指定と、Community／Build Toolsの開発利用資格は既存評価を継承する。
  SDK受領者条件の同程度の保護と合意方式、MSVC startup（msvcrt.lib等）の再配布許諾への対応は未確定。
  SDKの製品全体を配布すると扱わず、Runtime非同梱だけで組込みcodeの条件が消えるとも扱わない。
- SDKの配布者補償・防御等は本人の判断事項であり、利用者向け免責や通知レビューの完了で解消しない。
- Consent v2とREADMEへ追加するSDK条件は草案段階。今回は採用・hash登録・条文挿入を行わず、承認済みv1を維持する。
  次工程では最終本文・改訂日・条件提示と合意の扱いを確定し、既存の再同意・安全保存を使用する。

現在のWindows構成で除外したhost／Unix限定MPL対象について、旧source提供案を理由に新しい公開義務を追加しない。
個別条件を新たなtarget／feature／配布構成へ無条件で一般化しない。正式Noticesの承認metadataや通知由来commitは、
公開文書の修正だけでは更新・再承認しない。技術照合PASSと包括的な法的保証・本人の公開承認を区別する。

ローカルの限定監査・草案はignoredの`tmp/publication-license-closure/`、`tmp/publication-terms-draft/`に保持しており、
cloneの同梱資料ではない。上記はそれらの確認済み範囲と未確定事項の要約である。

## 履歴：Phase Local-1の非公開方針

以下は当時の方針・整備工程の記録。非公開、未レビュー、未登録、HOLD等の状態は当時の対象に限り、
現行の公開計画・Notices・検証状況は冒頭を参照する。過去の原文・監査証拠は改変しない。

当面、実行ファイルもソースコードも一般公開しない。GitHubのPrivateリポジトリを
開発とバックアップに使用し、Windows x64の個人用アプリとして通常開発を継続する。
公開用のlicense clearance、ZIP／installer、GitHub Releaseは停止中である。
第三者通知の文書整備については、下記の2026-10-12の節を現在の状態とする。
以下の配布条件・公開履歴・監査工程は旧公開工程の資料として保持し、正式package gateや
未完の公開用reviewをローカル開発の必須条件にしない。原文、証拠、scriptは削除しない。
この切替によって第三者licenseの条件充足や正式clearanceを認定するものではない。

本プロジェクト独自のcode、文書、synthetic tests／fixtures、iconにはrootの
[MIT License](../LICENSE)を適用する。第三者libraryや外部データには、それぞれの
権利とlicenseが適用される。GVDBデータ、ゲーム・製品の名称や商標、ユーザーが取得した
データは、本プロジェクトのMIT Licenseで再licenseしない。

## 依存関係とnotice確認

### 履歴：Release向け通知の整備（2026-10-12、正式レビュー前）

rootの[THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)は、0.3.0のWindows x64
Release向け通知のレビュー候補である。現行lockと通常target経路に対応するRust181件、
メモリ内Frontend buildで実際に残る9package、生成helper3件、SQLite、WebView2 SDK、
Rust runtimeとその独自依存の原文を収録した。201レコード・原文148種類をbyte単位で保持し、同じ本文の参照は
SHA-256で共有する。個別著作権表示とTao keyboard由来のW3C全文・変更説明も保持する。
通常依存は最適化による除去があり得るため、全候補がEXEに残るとは断定しない。

M07／M08は採用SDK1.0.3650.58のLICENSE（1,487 bytes）とNOTICE（3,894 bytes）を
全文収録した。SDK package全体のNOTICEであり、Antlr等すべてのnative Loaderへの
包含を認定しない。Microsoftのsource案内は原文の対象への案内として保持する。

O01の旧版との差分は現行版の原文へ更新した。O02はLocal-3C／3Dの判断を継承し、
cssparser、cssparser-macros、selectors、dtoa-shortはhost処理、option-extはUnix cfgに
限るため、現在のWindows配布物に対するMPL source提供義務を認定しない。
別target／feature／CSPへ変更する場合は再判定する。これらの保守的source候補は
公開済みと扱わず、現構成に新たなsource公開作業を要求しない。
alloc-stdlib0.3.0はpackageが示すcommitのrepository root LICENSEを照合し、
BSD-3-Clauseの著作権・条件・免責全文を収録した。

O06の表示対応には同版Rust1.98.0の提供元`COPYRIGHT-library.html`全文を採用した。
原文HTMLをbyte単位で保持し、テキスト表示も添える。個別表示を推測で省かず、
package全体の通知であると説明する。std独自依存のhashbrown0.17.1／rustc-demangle0.1.27、
backtraceの表示も個別に対応した。installed sourceのcompiler_builtins0.1.160と
LLVM例外付きLICENSEは現存資料で照合し、旧版記録だけを流用していない。
提供元通知にある他target用／build用componentをWindows配布コードと認定しない。
fortanix-sgx-abiのMPL経路はstd manifestのSGX専用targetであり、Windowsに適用しない。
この全文収録で最適化後の各objectの包含範囲まで証明したとは扱わない。
この通知は正式package入力`release/notices/`へ未登録で、REVIEWEDや署名済みreviewを
生成していない。M03、M05-P01／P06／P09、輸出管理、一般公開HOLDは継続する。
既存の原文正本・監査履歴・draft generator・正式gateは変更しない。

予定ZIPにはEXE、LICENSE.txt、README.txt、THIRD-PARTY-NOTICES.txt、SHA256SUMS.txtを
同梱する。利用者がEXEと同じ配布経路で通知を取得できる構成とする。
外部VC++ x64 Runtime／WebView2 Runtime／Windows DLLは同梱しない。
MPL等の対象コードを将来同梱する場合は、同版sourceの実提供と取得案内を別途整える。
独自コードのGitHub公開予定を、第三者sourceの提供完了と扱わない。

以下は過去の監査工程の記録であり、上記の現行通知整備とは区別する。

npm依存関係の解決結果は`package-lock.json`、Rust依存関係は`src-tauri/Cargo.lock`で
固定する。直接依存関係はpackage manifest、実際のversionはlockfile、licenseは
各packageのmetadataとlicense／notice本文を確認する。固定のversion一覧は本書に重複掲載しない。

直接依存関係の監査は行っているが、配布binaryに含まれる推移的依存関係のnotice監査は
未完了である。プロジェクトのMIT採用によって、依存関係のApache-2.0、BSD-3-Clause、
MIT等のlicense／notice条件がなくなるわけではない。

Phase 23D-C1CではWindows x64の包含候補と原文を監査し、207通知候補・148種類の原文を
未承認draftへ組み立てる工程を追加した。原文の存在、実際の包含、必要表示、source提供、
契約上の判断は別々に確認する。現時点で全依存関係のlicense条件を満たしたとは断定しない。
raw GVDB datasetはsource snapshotに同梱しない。

## 履歴：未承認通知の組立

`scripts/build-third-party-notices.ps1`は入力manifestでinventoryのhashとcomponentごとの
version・宣言式・選択案・COPYRIGHT/NOTICE・source状態・未解決項目を固定する。
原文をSHA-256とbytesで検証し、component IDと本文hashのordinal順で組み立てる。
同じ原文はhashで共有するが、component/version/原本由来と個別表示は維持する。
ORの選択案、AND/WITH、legacy式の保留も入力contractと照合し、条件を自動で短縮しない。

出力はGit ignoredな`tmp/`の新規directoryに限定し、上書きしない。通知の冒頭は
`DRAFT — NOT FOR DISTRIBUTION`と`LICENSE CLEARANCE INCOMPLETE`、状態はDRAFTである。
原文欠落・hash不一致・対応不一致では失敗し、正式通知を作成するoptionはない。
通知はUTF-8 BOMなし・LFで出力し、raw原本のhashは改行正規化前のbytesで確認する。
本文、必要表示、provenanceの条件をそれぞれ保持し、16MiB上限を変更しない。

Phase 23D-C1C-C1で[未承認原文の正本候補](../release/notice-source/README.md)を用意した。
752 inventory、207通知候補、148原文と6公開source証拠、出典・収録根拠・original/curated hashを
version管理対象にする。原文の全文・文字コード・改行は維持し、Gitの原本txt変換も禁止する。
これらだけを入力にした隔離実行で旧draftの通知本文と同じbytesを再現できる。
生成scriptは個人cache/絶対path/network/旧ignored evidenceを探索しない。
Microsoft製品契約・旧Unicode data等の35参照資料は本文を取り込まず、URL/hash・保留理由を残す。
収録原文の許諾・表示保持の確認と、アプリ配布の正式clearanceは別である。
正式な人手reviewやsource提供は未完で、今回の候補は未stage・未commitに留める。
assemblyの実行方法と入力契約は[release手順](release-build-history.md#未承認third-party-noticeの組立)を参照。

## 独立した著作権者表示がない原本

以下の調査経緯は当時の記録であり、現行の正式reviewは完了済み。schemaの条件は既存gateで維持する。

owner行の未検出は、必須表示の欠落を意味しない。原文にある著作者を推測して補わず、
原文・source header・NOTICEを対応付ける。既存30件の限定調査では、実表示が別の場所に
ある4件と、調べた原本に独立owner行がない26件を区別した。必要表示全体のreviewは未完である。

formal schema1の`review.coverage[].copyrights`は明示配列を要求する。非空なら従来どおり
通知本文とのliteral一致が必要である。空の場合に限り、
`copyright_review.state=NO_SEPARATE_NOTICE_IN_REVIEWED_SOURCES`、具体的なreason、非空の
`source_evidence`を要求する。証拠は`release/notices/evidence/*.txt`の署名対象fileとし、
componentのreview evidenceへ含め、記録hash・署名対象hash・実bytesを一致させる。
証拠にはcomponent/version、調べた原本・file範囲とhash、独立表示がない根拠を残す。
この例外は原文やNOTICEの省略を認めず、実reviewerと条件履行・provenanceの完了を要求する
親gateも維持する。raw文書から表示の法的要否を自動判定するものではない。

## 履歴：Local-3からLocal-4時点の配布条件

当時の未完事項を記録する。現在残るSDK受領者条件・MSVC startupの対応と本人判断は冒頭に区分した。
後に完了した通知や除外対象のsource提供を、この節だけを理由に現行の残件へ戻さない。

MPLの対応sourceはアプリZIPとは別のversion対応補助archiveを匿名HTTPSで提供する方針だが、
公開先・実URL・維持責任が未確定である。検証済source候補を公開済み、提供完了と扱わない。
旧Unicode10 data条件の資料は履歴として保持し、Local-3A／3Bで除去確認した旧UNIC経路を
現行の残件へ戻さない。現行Unicode関連条件、Microsoftの実static objectに対応する契約と
再配布条件、host生成物・Rust個別条件・Loader SDK NOTICE・最終frontend/helperの包含scope、
実reviewは残る。
Microsoft製品のinstallやsystem DLL importを再配布資格・static寄与の不存在の証明にしない。

Phase Local-1では静的CRTへ戻したが、Local-4Aの独立ビルドを経てLocal-4BではWindows/MSVC
向けの動的CRT方式を正式なローカル開発構成として採用する。`build.rs`のtarget条件付き
`STATIC_VCRUNTIME=false`でTauriの静的CRT強制を解除する。VC++ Redistributable x64（v14系）と
WebView2 Runtimeは外部要件で、Runtime DLL／installerは同梱・自動導入しない。
SQLite bundledとWebView2 Loader static library、OS提供UCRT依存は維持する。

Local-3B〜3DのM03は、静的版で特定したlibcmt.lib／libvcruntime.lib由来objectの
再頒布許諾との対応を対象としていた。現行の動的版ではその強制選択方式がなくなるため、
「Tauriがこの二つを強制して静的CRT本体を組み込む構成」を前提とした論点は非適用となる。
ただしDLL importsとhelper解除だけで、最終EXE内のMSVC由来static codeがすべてなくなったとは
認定しない。Local-4Bの一致するEXE/PDBでは旧二libraryのDBI module記録がなく、
msvcrt.lib／vcruntime.libが記録される。msvcrt.lib由来のstartup等にはcode寄与も残る。
残存寄与の全範囲と権利対応は未確認として残し、
M03全体を許諾VERIFIEDへ変更しない。Local-4BのM03再評価（ローカルignored資料、GitHubには同梱しない：`tmp/phase-local-4b/m03-decision.md`）に
対象EXE・技術根拠・状態と限界を記録する。旧Local-3B〜3Dの判断・証拠は履歴として保持する。

M02／M04／O02の既存評価は再開しない。M05の配布条件、M07／M08のLoader表示・scope、
O01の通知版対応等の公開関連事項も解決済みにしない。CRTの切替は残るUnicode関連条件、
包含時のMPL source実提供、本人reviewを解決せず、第三者license全体のclearanceを意味しない。

Microsoft関連では、Visual Studio Community/Build Toolsの利用条件、MSVC/Windows SDK由来codeの
再配布条件、WebView2 SDK固有LICENSE/NOTICEを分ける。現端末のBuild Tools 2022、別端末の
Community 2022とMicrosoft account sign-in、同一個人開発者というuser contextは原文正本の
provenanceへ記録した。別端末の利用やsign-inだけでcode/SDKの再配布を承認しない。
Tao keyboard sourceにあるW3C全文と通知も正本に残し、最終配布scope/表示は実reviewへ残す。

正式入力`release/notices/manifest.json`、`inventory.json`、`review.json`、
`THIRD-PARTY-NOTICES.txt`、`texts/*.txt`には、実review、署名対象証拠、全coverageとhash、
必要表示、MPLの実source提供が必要である。未承認draftや未解決metadataは正式packageが
引き続き拒否する。今回の組立成功はlicense clearance・一般公開の許可ではない。

## 履歴：Git署名と公開履歴の旧方針

以下のparentなしsnapshotから履歴を開始する案は旧方針として保持する。現在は既存Git履歴の公開を検討し、
最新origin/mainとのfast-forward可否と公開対象履歴を確認する。履歴の書換えは行わない。
署名付きcommit・signed annotated tagの方針は維持し、EXEのAuthenticode署名とは区別する。

公開開発commitにはGit SSH signingを使用し、release tagはsigned annotated tagとする。
公開Git履歴は公開対象を整理したsnapshotから、parentなしのsigned root commitで開始する。

Git署名はcommit／tagの検証用であり、Windows executableやinstallerのAuthenticode署名とは
別である。現時点ではAuthenticode署名を保証しない。installerの実行・表示確認と、必要な
dependency noticeの収集はclean-release検証で扱う。

