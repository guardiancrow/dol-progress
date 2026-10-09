# DOL Progress Manager

『大航海時代 Online』のクエスト・発見物の進捗を、プロフィールごとにPC上で管理するWindows向けデスクトップアプリケーションです。ユーザーが手動取得したGVDBマスターデータを取り込み、進捗はローカルSQLiteへ保存します。取り込み後の通常利用はオフラインで行えます。

本プロジェクトは当面、実行ファイルもソースコードも一般公開しません。Windows x64での個人利用を前提とし、GitHubのPrivateリポジトリは開発とバックアップのために継続します。インストーラーを使わず、アプリのフォルダーをコピー・移動して利用できます。

本プロジェクトは非公式のfan utilityです。ゲームの開発元・販売元・運営元による公式toolではなく、それらの組織やGVDBとの提携・公認を示すものでもありません。ゲーム名、製品名、商標などの権利は各権利者に帰属します。

## 主な機能

- Profileごとのクエスト・発見物進捗とメモの管理
- Quest一覧の検索、達成状態・前提状態・必要スキル／Rank・オファー方法／都市による絞り込みと並べ替え
- Discovery一覧の検索、分類・発見／報告状態・カード所有状態による絞り込み。報告状態とカード所有状態は独立して管理（レリックは報告・カード対象外）
- クエスト・発見物の名前セルから、GVDBマスターの説明／備考をポップアップで参照（プロフィールごとのメモとは別）
- Overviewでの進捗集計、Adventure Merit表示、分類からDiscovery一覧への移動
- Master Data画面での手動import、更新結果・警告・取り込み履歴の表示
- バックアップ／復元、標準保存場所とカスタム保存場所の切り替え

前提状態の判定は保存済みの直接関係と進捗に基づき、ゲーム内の全受注条件を保証しません。詳細は[機能要件](docs/requirements.md)を参照してください。

## 動作環境と起動方法

利用対象はWindows 10／11 x64です。CRT/VCRuntimeは静的リンクとし、Microsoft Visual C++ Redistributable x64をアプリ独自の追加前提条件として要求しない構成へ戻しています。SQLite bundledとWebView2 Loaderの既存構成を維持し、Microsoft Edge WebView2 Runtimeは引き続きWindows側に必要です。Windows標準のUCRT等のOS提供DLLへの依存は残ります。

1. ローカルビルドした`dol-progress-manager.exe`を、ユーザーが書き込めるアプリ用フォルダーへ置きます。
2. `dol-progress-manager.exe`を起動します。初回起動時に必要なデータ・設定フォルダーが作成されます。
3. 「保存場所」画面で現在のデータベースと設定フォルダーを確認します。

Program Filesや読み取り専用フォルダー等で書き込めない場合は、アプリを終了し、フォルダー全体を書き込み可能な場所へ移動してください。管理者としての実行やACL変更は標準の解決手順にしません。データ保存先をAppDataへ自動で切り替えることもありません。

### WebView2 Runtime

画面表示にはMicrosoft Edge WebView2 Runtimeが必要です。利用できるWebView2 Runtimeを確認できなければ、画面を開く前に日本語の案内を表示して終了します。この場合、データ・設定フォルダーは初期化しません。

[Microsoft公式WebView2ページ](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)からEvergreen Runtimeを導入し、その後にDOL Progress Managerを起動し直してください。アプリはRuntimeを自動でダウンロード・インストール・更新せず、案内時にブラウザーも自動で開きません。アプリを削除するときにRuntimeを削除する必要はありません。

## GVDBマスターデータの取得と取り込み

raw CSVはこのrepositoryや配布対象のsourceに同梱しません。[大航海時代データベース（GVDB）](https://gvdb.mydns.jp/db/)から必要なファイルをユーザー自身が手動取得し、Master Data（マスターデータ）画面でローカルファイルを選択・確認してimportします。

クエスト用は`quests.csv`、発見物用は`discovery_items.csv`です。拡張子は`.csv`ですが内容はTAB区切り、文字コードはCP932／Windows-31J互換です。importはheaderと行を検証し、マスター・関連・履歴をtransactionで更新します。ユーザーのプロフィールと進捗は保持します。仕様は[データ取り込み](docs/data-import.md)を参照してください。

アプリはGVDBの自動download、scraping、background更新、GVDBへの書き込みを行いません。telemetry、進捗の外部送信、自動updaterも実装していません。GVDBサイトを開く操作は、固定URLを既定のsystem browserで開きます。開発時のVite serverや依存関係の取得は、通常アプリのオフライン利用とは別です。

## データと設定の保存場所

標準の構成は次のとおりです。`data`と`config`は初回起動時に必要に応じて生成されます。

```text
DOL-Progress\
  dol-progress-manager.exe
  data\
    dol-progress.db
  config\
    data-root.json
    data-root.last-good.json
```

`data`内のデータベースには、プロフィール、クエスト・発見物の進捗、メモ、取り込んだマスターデータ等を保存します。`config`には保存場所を判断する設定と復旧情報を保存します。通常、設定ファイルを手編集する必要はありません。

保存先はEXEの親フォルダーを基準に決まり、カレントディレクトリに依存しません。異なるEXEフォルダーは別々の標準DBを使用します。

「保存場所」画面は「データベース」と「アプリの設定」を別のカードに分け、それぞれデータベースのフォルダーと設定フォルダーを表示します。保存場所の変更はデータベースだけが対象です。設定フォルダーはアプリのフォルダー内にあり、カスタムDBへ移行しても移動しません。カスタム利用時にはデータベースのカードに「カスタム保存先を使用しています」と補足します。

「データとアプリの管理」カードには、データベースのバックアップ、ファイルの移動と編集、アプリ削除の案内をまとめています。Windows側に残るデータの説明は別のカードに表示します。

| 保存方式 | 現在のデータベース | 設定フォルダー |
| --- | --- | --- |
| 標準 | アプリのフォルダー内の`data/dol-progress.db` | アプリのフォルダー内の`config` |
| カスタム | 選択した外部フォルダー直下の`dol-progress.db` | アプリのフォルダー内の`config` |

カスタムへ変更する場合は「データベースの保存場所を変更」からローカル固定NTFS上の外部の空フォルダーを選び、「このフォルダーへデータベースを移行する」を実行します。アプリのフォルダー、その内部、その親フォルダーは選べません。検証済みのデータを移行して再起動し、元のデータベースは安全コピーとして残します。元のコピーと使用中のDBは、その後の更新が同期されません。

設定されたDBが見つからない場合や、カスタム保存場所を確認できない場合は復旧画面を表示します。別の場所に空DBを自動作成しません。保存場所を修正した後は、アプリを一度終了して起動し直してください。詳細は[データ保存場所の仕様](docs/data-root.md)を参照してください。

WebView2のキャッシュやブラウザー用データは、Windows側のユーザーデータ領域（LocalAppData）に残る場合があります。進捗を保存する`data`や保存場所を記録する`config`とは別です。「Windowsに一切何も残さない」構成ではありません。

WebView2 UDFは既存のOption A（`%LOCALAPPDATA%\com.dolprogress.manager`）を維持します。異なるEXEコピーも同じWindowsユーザーではこのUDFを共有するため、複数フォルダーからの同時起動は現時点の保証対象としません。

## バックアップと復元

### 内蔵バックアップ

アプリ実行中は「マスターデータ」画面の「バックアップを作成」を使います。現在使用中のデータベース全体から整合したバックアップを作り、選んだ場所へ保存します。標準・カスタムのどちらでも同じ操作です。設定フォルダー自体は含みません。アプリのフォルダーを削除しても残る別の場所へ保存してください。

復元は「復元するファイルを選択」でバックアップを選び、検証結果を確認して「復元する」を実行します。現在のデータベース全体がバックアップ時点の内容に置き換わり、成功後に再起動します。保存方式は切り替わりません。対応するバックアップはmigration version 1〜3の正規履歴を持つものです。互換性と失敗時の手順は[バックアップ／リストア仕様](docs/backup-restore.md)を参照してください。

### 終了後のフォルダーバックアップ

アプリを完全に終了してから、アプリのフォルダー全体を別の場所へコピーします。標準利用なら、本体・data・configをまとめて保管できます。実行中の`dol-progress.db`だけを手作業でコピーする方法は使わないでください。

カスタム利用では、アプリのフォルダーをコピーするだけでは外部DBを保管できません。内蔵バックアップで現在のDBを別途保存してください。外部フォルダーもまとめて保管する場合は、アプリを完全に終了してからコピーします。

## アプリのフォルダーの移動

アプリを完全に終了してから、フォルダー全体を移動します。標準ではdataとconfigも一緒に移動し、新しいアプリの場所を基準に使用します。EXEだけを移動しないでください。

カスタムではconfigはアプリと一緒に移動しますが、外部DBの絶対パスは変わりません。外部フォルダーは自動で移動しません。移動後も同じ場所へアクセスできることを確認してください。

## 更新

1. 更新前に内蔵バックアップを保存します。
2. DOL Progress Managerを完全に終了し、必要ならフォルダーバックアップも保管します。
3. 新しくローカルビルドしたEXEを用意します。
4. 既存の`data`と`config`を保持したまま、アプリ本体を更新します。**data/configを削除・上書きしないでください。**
5. 再起動し、「保存場所」画面とプロフィール・進捗を確認します。

新しい空のdata/configで既存データを置き換えないことが原則です。

## 削除

アプリ本体を削除する場合は、完全に終了してから`dol-progress-manager.exe`を削除します。アンインストーラーはありません。データベースや設定を残す場合は、「保存場所」画面でそれぞれの場所を確認し、そのファイル・フォルダーを削除しないでください。アプリのフォルダー全体を削除する必要はありません。

標準利用でアプリのフォルダー全体を削除すると、data/configも削除され、進捗データを失います。削除前にバックアップを別の場所へ保存してください。

カスタム利用では外部DBは通常残りますが、アプリのフォルダー内の設定は消えます。再導入時はカスタム保存場所の設定をやり直す必要があります。既存DBが残ることだけに頼らず、削除前に内蔵バックアップも保存してください。WebView2 Runtimeを一緒に削除する必要はありません。

## 旧版からの移行と既存カスタム保存場所

旧開発版等からの通常の移行手順は、内蔵バックアップと明示的な復元です。

1. 旧版で「バックアップを作成」を実行して、別の場所へ保存します。
2. 旧版を完全に終了します。
3. ポータブル版を起動し、「復元するファイルを選択」で保存したバックアップを検証します。
4. 確認後に「復元する」を実行します。再起動後にプロフィール・進捗を確認します。
5. カスタムを使う場合は、「保存場所」画面で外部の空フォルダーへ移行します。

旧AppDataのDBや設定を探索・自動移行する処理はありません。旧版の設定ファイルを手編集・コピーして切り替える手順や、実行中DBの単体コピーは推奨しません。

ポータブル版の既存configを保持してアプリのフォルダーを移動・更新する場合は、外部カスタム保存場所をそのまま使います。旧版と新版を同じDBへ同時に接続しないでください。

すでに復旧画面が表示されている場合は、「保存場所を指定し直す」から既存のカスタムDBがある外部フォルダーを選び、「検証済みの保存場所を使用する」で再指定できます。ローカル固定NTFS等の条件とDBの互換性検証を満たす必要があり、成功後に再起動します。この操作は復旧画面に限ります。通常画面の「データベースの保存場所を変更」は空フォルダーへの移行用で、既存DBに直接切り替える操作ではありません。新規導入時は上記のバックアップ／復元手順を使ってください。

## 開発と検証

開発にはNode.jsとnpm、RustのMSVC toolchain、Microsoft C++ Build Toolsの「C++によるデスクトップ開発」ワークロード、Windows SDK、WebView2 Runtimeが必要です。[Tauri公式のWindows prerequisites](https://v2.tauri.app/start/prerequisites/)と依存packageの要求を確認してください。

開発確認環境はNode.js 24.19.0、npm 11.17.0、rustc 1.98.0、cargo 1.98.0です。これは動作確認したversionの記録であり、最小対応versionの指定ではありません。

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

通常のローカル開発では、次のcommandでインストーラーを生成しないWindows Releaseビルドを行います。依存関係は事前にcacheしておきます。

```powershell
npm run tauri -- build --no-bundle -- --locked --offline
```

インストーラーを生成しないDebugビルドの確認には次を使用します。

```powershell
npm run tauri -- build --debug --no-bundle -- --locked --offline
```

application iconは本プロジェクト用に新規作成したvectorから生成しています。[iconの制作・再生成手順](docs/icon-assets.md)を参照してください。

公開用のlicense clearance、正式通知、ZIP／installer、GitHub Releaseの工程は停止中です。[旧release手順](docs/release-build.md)と[third-party license資料](docs/third-party-licenses.md)、既存script・原文・証拠・監査資料は保持します。署名済みclean HEADを要求する`build-release.ps1`や正式package gateは、通常のローカル開発の必須条件にしません。

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
