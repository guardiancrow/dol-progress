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

配布形式を実証するPhase 23C-3で、実際に同梱されるフロントエンド・Rust libraryと
配布tool由来の内容を確認し、必要なlicense本文、著作権表示、NOTICE等を収集する。
releaseにはその確認結果に対応したnoticeを含める。現時点で全依存関係のlicense条件を
完全に満たしたとは断定しない。raw GVDB datasetはsource snapshotに同梱しない。

## Git署名と公開履歴

公開開発commitにはGit SSH signingを使用し、release tagはsigned annotated tagとする。
公開Git履歴は公開対象を整理したsnapshotから、parentなしのsigned root commitで開始する。

Git署名はcommit／tagの検証用であり、Windows executableやinstallerのAuthenticode署名とは
別である。現時点ではAuthenticode署名を保証しない。installerの実行・表示確認と、必要な
dependency noticeの収集はclean-release検証で扱う。
