# DOL Progress Manager

『大航海時代 Online』のクエスト・発見物の進捗を、プロフィールごとにPC上で管理するWindows向けデスクトップアプリケーションです。ユーザーが手動取得したGVDBマスターデータを取り込み、進捗はローカルSQLiteへ保存します。取り込み後の通常利用はオフラインで行えます。

本プロジェクトは非公式のfan utilityです。ゲームの開発元・販売元・運営元による公式toolではなく、それらの組織やGVDBとの提携・公認を示すものでもありません。ゲーム名、製品名、商標などの権利は各権利者に帰属します。

## 主な機能

- Profileごとのクエスト・発見物進捗とメモの管理
- Quest一覧の検索、達成状態・前提状態・必要スキル／Rank・オファー方法／都市による絞り込みと並べ替え
- Discovery一覧の検索、分類・発見／報告状態・カード所有状態による絞り込み。報告状態とカード所有状態は独立して管理（レリックは報告・カード対象外）
- Overviewでの進捗集計、Adventure Merit表示、分類からDiscovery一覧への移動
- Master Data画面での手動import、更新結果・警告・取り込み履歴の表示
- Backup / Restore、Default Data RootとCustom Data Rootの切り替え

前提状態の判定は保存済みの直接関係と進捗に基づき、ゲーム内の全受注条件を保証しません。詳細は[機能要件](docs/requirements.md)を参照してください。

## GVDBマスターデータの取得と取り込み

raw CSVはこのrepositoryや配布対象のsourceに同梱しません。[大航海時代データベース（GVDB）](https://gvdb.mydns.jp/db/)から必要なファイルをユーザー自身が手動取得し、Master Data（マスターデータ）画面でローカルファイルを選択・確認してimportします。

クエスト用は`quests.csv`、発見物用は`discovery_items.csv`です。拡張子は`.csv`ですが内容はTAB区切り、文字コードはCP932／Windows-31J互換です。importはheaderと行を検証し、マスター・関連・履歴をtransactionで更新します。ユーザーのプロフィールと進捗は保持します。仕様は[データ取り込み](docs/data-import.md)を参照してください。

アプリはGVDBの自動download、scraping、background更新、GVDBへの書き込みを行いません。telemetry、進捗の外部送信、自動updaterも実装していません。GVDBサイトを開く操作は、固定URLを既定のsystem browserで開きます。開発時のVite serverや依存関係の取得は、通常アプリのオフライン利用とは別です。

## データ保存とBackup / Restore

Default Data RootではTauri AppConfig directoryに`dol-progress.db`を保存します。Windowsでの通常の場所は次のとおりです。

```text
%APPDATA%\com.dolprogress.manager\dol-progress.db
```

Custom Data Rootでは、ユーザーが選んだローカル固定NTFS上のdirectory直下へ保存します。保存場所の移行は検証済みsnapshotを使い、旧DBは安全コピーとして残します。Custom rootの欠落・破損時に空DBへ自動切り替えは行いません。詳細は[データ保存場所](docs/data-root.md)を参照してください。

Master Data画面から、現在activeなDB全体をSQLite snapshotとしてbackupできます。Restoreはファイル選択・検証・明示確認を経て現在DBを置換し、成功後に再起動します。対応するbackupはmigration version 1〜3の正規履歴を持つものです。backupは保存場所の設定を含まず、Default／Customのどちらでも現在activeなDBへ復元します。[バックアップ／リストア仕様](docs/backup-restore.md)に検証・互換性・失敗時の復旧手順を記載しています。

## 必要な環境

利用対象はWindows 10／11です。画面表示にはMicrosoft Edge WebView2 Runtimeが必要です。installerによるRuntime導入や配布形式は、release検証で確認する対象です。

開発にはNode.jsとnpm、RustのMSVC toolchain、Microsoft C++ Build Toolsの「C++によるデスクトップ開発」ワークロード、Windows SDK、WebView2 Runtimeが必要です。[Tauri公式のWindows prerequisites](https://v2.tauri.app/start/prerequisites/)と依存packageの要求を確認してください。

開発確認環境はNode.js 24.19.0、npm 11.17.0、rustc 1.98.0、cargo 1.98.0です。これは動作確認したversionの記録であり、最小対応versionの指定ではありません。

## 開発と検証

cloneしたrepositoryのrootで依存関係をlockfileに従って導入し、開発起動します。Rust側の依存関係はCargoが取得します。

```powershell
npm ci
npm run tauri dev
```

フロントエンドだけの開発serverは`npm run dev`です。TauriのDBやdialog機能の確認にはdesktop起動を使用してください。

```powershell
npm run typecheck
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --check --manifest-path src-tauri/Cargo.toml
```

通常suiteは小さなsynthetic fixtureを使用し、実GVDBファイルやインターネットへのアクセスを必要としません。実データを使う任意のacceptanceは既定でignoredです。raw filesは同梱せず、特定snapshotのID・名称・件数を期待値に保持しません。手動配置と明示実行の条件は[データ取り込み](docs/data-import.md)を参照してください。Cargoの依存関係をcache済みなら、`--offline`を追加して検証できます。

## Windows build

開発起動と別に、Windows desktopのrelease buildを行うcommandは次のとおりです。bundle toolの準備が必要になる場合があります。

```powershell
npm run tauri build
```

installerを生成しないdebug buildの確認には次を使用します。

```powershell
npm run tauri build -- --debug --no-bundle
```

application iconは本プロジェクト用に新規作成したvectorから生成しています。[iconの制作・再生成手順](docs/icon-assets.md)を参照してください。公開commitはGit SSH signing、release tagはsigned annotated tagを使用する方針です。これはWindows Authenticodeとは別で、現時点ではAuthenticode署名を保証しません。releaseとdependency noticeの確認方針は[third-party licenses](docs/third-party-licenses.md)に記載しています。

## 謝辞

[GVDB](https://gvdb.mydns.jp/db/)の運営者、編集者、情報提供者をはじめ、データを収集・整理・更新・公開してくださるコミュニティの皆さまに感謝します。この謝辞は提携・公認を意味しません。raw datasetはrepositoryに含めず、GVDBデータの再配布許諾があると主張するものでもありません。

## License

本プロジェクト用に作成したsource code、documentation、synthetic tests／fixtures、独自iconのSVG sourceと生成assetには[MIT License](LICENSE)を適用します。

第三者libraryと外部依存関係には各licenseが適用されます。GVDBのデータ・名称・service、『大航海時代 Online』、製品名・商標、ユーザーが外部からimportしたデータについて、第三者の権利を本プロジェクトのMIT Licenseで再licenseするものではありません。詳細は[third-party license方針](docs/third-party-licenses.md)を参照してください。

## 仕様書

- [機能要件](docs/requirements.md)
- [SQLite schemaと永続化](docs/database-design.md)
- [GVDBデータ取り込み](docs/data-import.md)
- [Backup / Restore](docs/backup-restore.md)
- [Data Root](docs/data-root.md)
