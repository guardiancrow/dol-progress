# Third-party licensesとrelease方針

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

現在の実データ入力は監査用ignored bundleにあるため、clean cloneには含まれない。
合成testsはcloneだけで再現できるが、207候補の実通知には対応するbundleが必要である。
将来の正本は`release/notice-source/`等に、assembly manifest、inventory、hashを名前にした
原文、実表示のsource証拠、scope/review資料をversion管理する設計とする。この正本は
今回作成していない。個人のcacheや絶対pathを生成scriptから探索せず、取得時のURL・版・
revision・raw hashと、再配布できる原文の対応をreviewしてから正本化する。
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
旧Unicode10 data条件、Microsoftの実static objectに対応する契約と配布資格、host生成物・
Rust個別条件・Loader SDK NOTICE・最終frontend/helperの包含scope、実reviewは残る。
Microsoft製品のinstallやsystem DLL importを再配布資格・static寄与の不存在の証明にしない。

正式入力`release/notices/manifest.json`、`inventory.json`、`review.json`、
`THIRD-PARTY-NOTICES.txt`、`texts/*.txt`には、実review、署名対象証拠、全coverageとhash、
必要表示、MPLの実source提供が必要である。未承認draftや未解決metadataは正式packageが
引き続き拒否する。今回の組立成功はlicense clearance・一般公開の許可ではない。

## Git署名と公開履歴

公開開発commitにはGit SSH signingを使用し、release tagはsigned annotated tagとする。
公開Git履歴は公開対象を整理したsnapshotから、parentなしのsigned root commitで開始する。

Git署名はcommit／tagの検証用であり、Windows executableやinstallerのAuthenticode署名とは
別である。現時点ではAuthenticode署名を保証しない。installerの実行・表示確認と、必要な
dependency noticeの収集はclean-release検証で扱う。
