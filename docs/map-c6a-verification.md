# Map-C6A：Windows多重起動防止の実装・検証

## 開始条件と変更範囲

2026年11月7日、`feature/map-report-hold`の`55e0edb`から開始した。
Map-C6監査は同commitで保存済みで、開始時の作業ツリーはクリーンだった。
今回はWindows標準Mutexによる起動制御だけを追加した。Tauri公式Single Instanceプラグイン、地図取得都市の表示、前面表示・最小化復元は追加していない。

変更ファイルは次の9件である。

- `src-tauri/src/main.rs`：通常起動の前段にguardを追加。
- `src-tauri/src/single_instance.rs`：Mutex生成・判定・handle管理と停止理由。
- `src-tauri/src/single_instance_tests.rs`：単体・実プロセス間試験。
- `src-tauri/Cargo.toml`：既存Windowsバインディングのfeature追加と試験用途コメントの更新。
- `docs/requirements.md`：現行の起動順序と多重起動仕様。
- `docs/data-root.md`：Data Root処理前の排他と保存先が異なる場合の制限。
- `README.md`：利用者向けの多重起動時の案内。
- `docs/map-c6-audit.md`：過去の結論と現行仕様の区別。
- `docs/map-c6a-verification.md`：本検証記録。

## API契約と実装

`main.rs`は`single_instance::run(dol_progress_manager_lib::run)`を最初に呼ぶ。
新しいmoduleが固定名`Local\com.dolprogress.manager.single-instance`のMutexを確保してから、既存の`lib.rs::run()`を呼ぶ。
したがって、Mutexの判定はWebView2 Runtime検出、使用許諾、同意設定lease、Data Root準備、DB初期化・migrationより先に完了する。
`lib.rs`や各起動処理の内部順序・契約は変更していない。

使用するAPIは`CreateMutexW`、`GetLastError`、`SetLastError`と、`OwnedHandle`による`CloseHandle`である。
呼出し前にlast-errorを0へ戻し、API直後に値を退避する。戻り値がNULLなら作成失敗として停止し、有効なhandleと`ERROR_ALREADY_EXISTS`なら重複として停止する。
作成と既存オブジェクトの判定を別々のAPIに分けず、同名を同時に作ろうとした場合もWin32の原子的な作成・openの結果を使う。

`bInitialOwner=FALSE`を渡し、スレッドによるMutex所有権は取得しない。待機・`ReleaseMutex`・abandoned状態の判定も行わない。
オブジェクトが存在する間だけ後続起動を拒否し、先行プロセスはguardでhandleを保持する。
`OwnedHandle`はscope終了・panic unwindでhandleを一度だけ閉じる。`process::exit`や異常終了ではOSがhandleを閉じる。
非継承handleのため、アプリが子プロセスを起動してもその寿命を延長しない。
先行プロセスの終了後、最後のhandleが閉じた時点でオブジェクトが消える。

unsafeは、windows-sysを通すAPI呼出しと、有効な返却handleを`OwnedHandle`へ一度だけ移譲する箇所に限定した。
終端付きUTF-16のnameを呼出し終了まで保持し、NULLの失敗handleは所有型へ変換しない。
重複時のhandleもエラーを返す際に閉じるため、native通知を開いたままでもMutexを保持しない。
独自のextern宣言や手書きFFI、手動の二重closeは追加していない。

契約の参照元：[CreateMutexW](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createmutexw)、[GetLastError](https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror)、[CloseHandle](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-closehandle)、[セッションの名前空間](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces)、[OwnedHandle](https://doc.rust-lang.org/std/os/windows/io/struct.OwnedHandle.html)。

## 後続起動と排他範囲

重複時は既存のnative error表示で「アプリケーションは既に起動しています。」と通知し、exit code 1で終了する。
作成失敗時もnative表示で停止理由とWindowsエラーコードを示し、exit code 1で終了する。
新しいWebView・通常ウィンドウは作らず、先行画面への操作やデータ・設定変更は行わない。

Debug／Release、CWD、配置ディレクトリ、Data Rootによる名前の分岐はない。
同一セッション・同一identifierの新方式のEXEは、Data Rootが異なっていても同時に起動できない。
現在のnameと`tauri.conf.json`のidentifierの対応はテストで検査する。

Mutex未実装の旧版、異なるidentifier、別Windowsセッションや外部DB操作には適用されない。
旧版との混在、別セッションから同じData Rootを開く操作や、すべてのDB競合・破損を防げるとは扱わない。
他プロセスによる固定名の先取り、アクセス権の制限、同名の別種kernel objectでも起動できなくなる可能性がある。
この場合も排他確認を迂回して続行しない。Mutexの保持をData Rootの排他やWindowsユーザー認証の代用にはしない。

## 依存とライセンス

既存の`windows-sys 0.59`へ`Win32_Security`と`Win32_System_Threading`のfeatureを追加した。
前者は`CreateMutexW`の引数型に、後者はMutex APIに必要である。Threadingは既にdev-dependencyでは指定されていたが、通常build用にも明示する必要がある。
新しいcrateは追加せず、Cargo.lock、Tauri本体、npm package／lockfileは変更していない。
追加のnetwork取得は必要なかった。正式なWindows対応の範囲を広げる依存再構成も行っていない。

既存のwindows-sys／windows-targetsの版とライセンス・通知を維持する。新しい第三者libraryやライセンス本文、RuntimeやDLLの同梱は追加していない。
使用APIはOSのKernel32.dllへの呼出しであり、Microsoft由来の別の静的コードやSDK libraryを新規に同梱していない。
MSVC／SDK／CRTの既存の使用資格・リンク・再頒布条件と未解決事項は維持する。
通知正本と承認metadataは変更せず、今回のbuildを正式配布・公開の承認とは扱わない。

## 自動検証

通常アプリの固定Mutex名を試験で取得すると既存アプリの起動へ影響するため、テストはすべて専用の一意名を使う。
子プロセスは`tmp/map-c6a/process-tests`内のmarker付きfixtureのみを認め、既存Data Rootやconfigを解決しない。
起動continuationの代わりにRuntime・同意・Data Root・DB初期化・migrationの到達markerを生成し、抑止した子では一つも作られないことを確認する。
これは実Win32 APIを使うプロセス間試験であり、アプリの通常起動やGUIの試験とは区別する。

| 対象 | 結果 |
| --- | --- |
| 新規・既存Mutex、drop後の再起動 | 成功 |
| 8子プロセスのほぼ同時起動 | 先行1、抑止7 |
| 先行プロセスの正常終了後の再起動 | 成功 |
| 所有する専用test childを強制終了した後の再起動 | 成功 |
| 別種kernel objectと同名のMutexを作る失敗 | continuationを呼ばず停止 |
| panic unwindでのhandle解放 | 成功 |
| handleリーク | 専用子で生成・重複・解放を2,000回繰り返し、handle数78→78（テストは許容差2以内を要求） |
| test EXEを別ポータブル配置へcopyし別CWDで起動 | 後続を抑止、continuation未到達 |
| Debug／ReleaseのMutex名 | 共通定数とidentifierの対応を検査。実アプリ間の組合せ試験は未実施 |

| 回帰確認 | 結果 |
| --- | --- |
| Rust全テスト | 259件＋追加11件の計270件成功、6件ignore、doc-test成功。`cargo test --manifest-path src-tauri/Cargo.toml --locked --offline -- --test-threads=1` |
| TypeScript全テスト | 34ファイル、388件成功。`npm test -- --reporter=dot` |
| Rust整形検査 | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`成功 |
| TypeScript型検査・Vite build | `npm run build`成功（`tsc --noEmit`を含む） |
| Tauri Debug build | `npm run tauri -- build --debug --no-bundle -- --locked --offline`成功 |
| Tauri Release build | `npm run tauri -- build --no-bundle -- --locked --offline`成功 |

## Ownerによる通常アプリの確認

通常アプリEXEのGUI試験は未実施である。本番・試用プロセスへ干渉する可能性があるため、この作業から固定名を取得する通常EXEを起動していない。
Ownerは旧版を含むアプリを終了した後、既存環境と重ならない専用配置・合成Data Rootで次を確認する。

1. 初回の使用許諾、同意後の通常起動、終了、再起動が従来どおり動く。
2. 起動中に同じEXE・別CWD・別配置・Debug／Releaseを起動し、後続のnative通知だけが表示される。
3. 後続のdata/config、DB／migration履歴が変わらず、先行画面の進捗・設定・表示も変わらない。
4. 専用Custom Data RootとRecoveryの試験でも、最初の起動だけが既存処理へ進む。

本番・試用環境、保全コピーB・C・Dにはアクセスしていない。強制終了したのはテストが生成して所有する専用子だけである。
schema、migration 001〜004、進捗、初回報告履歴、冒険勲功値、地図取得判定、バックアップ・復元のコードを変更していない。
Git add／commit／push、merge／rebaseは行っていない。

## 文書との整合性

Map-C6監査の「未実装」は過去の結論として保存し、先頭から本書と現行要件へ案内した。
`requirements.md`のRuntime前検査と`data-root.md`の起動説明には、その前段に今回のMutex判定を追加した。
Map-C6で指摘した`consent/gate.rs`の`StartupGuard`の「通常runへの接続は未有効化」という旧コメントは残っているが、通常起動が既存guardを使う事実に基づいて検証する。今回は同意処理を変更していない。
リポジトリ全体の文書・コード整合性を網羅的に監査したものではない。
