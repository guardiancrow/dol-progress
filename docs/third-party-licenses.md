# Third-party licensesとrelease方針

## 現在の運用方針（Phase Local-1）

当面、実行ファイルもソースコードも一般公開しない。GitHubのPrivateリポジトリを
開発とバックアップに使用し、Windows x64の個人用アプリとして通常開発を継続する。
公開用のlicense clearance、正式通知、ZIP／installer、GitHub Releaseは停止中である。
以下の配布条件・公開履歴・監査工程は旧公開工程の資料として保持し、正式package gateや
未完の公開用reviewをローカル開発の必須条件にしない。原文、証拠、scriptは削除しない。
この切替によって第三者licenseの条件充足や正式clearanceを認定するものではない。

本プロジェクト独自のcode、文書、synthetic tests／fixtures、iconにはrootの
[MIT License](../LICENSE)を適用する。第三者libraryや外部データには、それぞれの
権利とlicenseが適用される。GVDBデータ、ゲーム・製品の名称や商標、ユーザーが取得した
データは、本プロジェクトのMIT Licenseで再licenseしない。

## 依存関係とnotice確認

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

## 未承認通知の組立

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
assemblyの実行方法と入力契約は[release手順](release-build.md#未承認third-party-noticeの組立)を参照。

## 独立した著作権者表示がない原本

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

## 残る配布条件

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
M03全体を許諾VERIFIEDへ変更しない。[Local-4BのM03再評価](../tmp/phase-local-4b/m03-decision.md)に
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

## 停止中のGit署名と公開履歴の旧方針

公開開発commitにはGit SSH signingを使用し、release tagはsigned annotated tagとする。
公開Git履歴は公開対象を整理したsnapshotから、parentなしのsigned root commitで開始する。

Git署名はcommit／tagの検証用であり、Windows executableやinstallerのAuthenticode署名とは
別である。現時点ではAuthenticode署名を保証しない。installerの実行・表示確認と、必要な
dependency noticeの収集はclean-release検証で扱う。
