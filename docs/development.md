# 開発ガイド

## 開発環境

開発にはNode.jsとnpm、RustのMSVCツールチェーンが必要です。Microsoft C++ Build Toolsの「C++によるデスクトップ開発」ワークロード、Windows SDK、WebView2 Runtimeも必要です。[Tauri公式のWindows prerequisites](https://v2.tauri.app/start/prerequisites/)と依存パッケージの要求を確認してください。

開発確認環境はNode.js 24.19.0、npm 11.17.0、rustc 1.98.0、cargo 1.98.0です。これは動作確認したバージョンの記録であり、最小対応バージョンの指定ではありません。

## 依存関係の導入と開発起動

クローンしたリポジトリのルートで依存関係をロックファイルに従って導入し、開発起動します。Rust側の依存関係はCargoが取得します。

```powershell
npm ci
npm run tauri dev
```

フロントエンドだけの開発サーバーは`npm run dev`です。TauriのDBやダイアログ機能の確認にはデスクトップ起動を使用してください。

## 型検査・テスト・ビルドの検証

```powershell
npm run typecheck
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --check --manifest-path src-tauri/Cargo.toml
```

## テストデータと受け入れテスト

通常のテストは小さな人工データを使用し、大航海時代データベースの実ファイルやインターネットへのアクセスを必要としません。実データを使う任意の受け入れテストは、既定では実行されません。元ファイルは同梱せず、特定時点のID・名称・件数を期待値に保持しません。手動配置と明示実行の条件は[データ取り込み](data-import.md)を参照してください。Cargoの依存関係をキャッシュ済みなら、`--offline`を追加して検証できます。

自動報告のリポジトリ統合テストは、Node.jsの`node:sqlite`を使ってメモリー内SQLiteで実行します。このモジュールが利用できない環境では、そのテストをスキップします。Rust側の人工データによるテストは通常どおり実行します。

## Windowsビルド

通常のローカル開発では、次のコマンドでインストーラーを生成しないWindows Releaseビルドを行います。依存関係は事前にキャッシュしておきます。

```powershell
npm run tauri -- build --no-bundle -- --locked --offline
```

インストーラーを生成しないDebugビルドの確認には次を使用します。

```powershell
npm run tauri -- build --debug --no-bundle -- --locked --offline
```

## アイコンと正式Releaseの関連文書

アプリアイコンは本プロジェクト用に新規作成したベクター画像から生成しています。[iconの制作・再生成手順](icon-assets.md)を参照してください。

通常の開発用ビルドと、配布用の正式Release検証は別です。配布候補は署名済みclean HEADから`build-release.ps1`、`build-portable-package.ps1`、`verify-portable-package.ps1`の順で検証し、同じHEADとrunに対応するZIP・外部hashを使用します。これは通常のローカル開発の必須条件ではありません。[正式Release手順と現在の準備状況](release-build.md)、[第三者ライセンス方針](third-party-licenses.md)を参照してください。技術検証の成功だけで法的条件の充足や公開承認を意味するものではありません。
