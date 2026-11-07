# Map-C6：多重起動防止と地図取得都市の監査結果

本書はMap-C6時点の監査とOwner判断の記録である。後続Map-C6Aでは公式プラグインを使わず、
Windows標準Mutexによる多重起動防止を実装した。現行仕様は[機能要件3.4](requirements.md#34-windowsの多重起動防止)、
結果は[Map-C6A検証記録](map-c6a-verification.md)を参照する。以下の「未実装」はMap-C6時点を表す。

後続Map-C6BではOwnerが地図のオファー都市の意味を確定し、既存データを「オファー都市」として
情報ポップオーバーへ表示する方針へ改訂した。都市に関する以下の未確定・表示見送りもMap-C6時点の記録であり、
現行契約は[取込仕様6.4](data-import.md#64-地図の取得都市との区別)と[機能要件](requirements.md#map-c6b地図の情報ポップオーバーへのオファー都市表示)を参照する。

## 結果とOwner判断

2026年11月7日の作業開始時は`feature/map-report-hold`、HEADは`9f2378d`、作業ツリーはクリーンだった。
Map-C5R-Sの地図への操作対象限定（`c969ef4`）と「地図の初回報告」への名称変更（`9f2378d`）はコミット済みだった。

| 対象 | 状態 | 理由 |
| --- | --- | --- |
| 多重起動防止 | 監査のみ・未実装 | 候補プラグインに必要な依存更新について、Ownerが「依存更新は採用せず、今回は監査結果を残す」を選択した |
| 地図取得都市の追加表示 | 監査のみ・未実装 | CSVに専用列がなく、全対象の書庫取得都市を正確に識別する根拠が不足している |
| 多重起動の実動作 | 未検証 | 通常アプリのEXEは起動していない。ビルド成功は多重起動防止の証明ではない |

依存解決を試行した`Cargo.toml`と`Cargo.lock`は開始時の内容へ戻した。アプリのソース、依存、migration、UI、SQLは変更していない。
最終変更は本書と`data-import.md`だけである。Git add／commit／push、merge／rebaseは行っていない。

## 現行の起動・終了処理

起動は`src-tauri/src/main.rs`から`lib.rs::run()`へ進み、次の順序で処理する。

1. WebView2 Runtimeを検出する。利用できなければ日本語のnative errorで停止する。
2. `PortablePaths::current()`でEXEの親から標準data/configの位置を求める。CWDは使わない。
3. 使用許諾の確認・保存を行い、起動中の同意設定leaseを取得する。辞退時は通常起動へ進まない。
4. `data_root::prepare_startup()`がconfigの準備・書込みprobe・bootstrap読取り・Data Rootの解決を行う。必要に応じて標準dataの準備も行う。
5. Tauri BuilderへstateとDialogプラグインを登録する。Single Instanceプラグインは存在しない。
6. Tauriが設定からmainウィンドウを生成した後、アプリのsetupで`data_root::initialize()`を実行する。ActiveDatabaseのpool、既存migration、DB検証、Normal／Recoveryの状態登録を行う。
7. 同意設定leaseを解放し、通常のevent loopへ進む。通常終了はTauriの終了処理に従う。

Data Rootのfilesystem errorは既存のnative errorで停止し、DB側の回復可能な問題はRecoveryとして表示する。
同意設定のleaseは起動処理の区間だけを保護するものであり、アプリ稼働中の多重起動防止ではない。

`ActiveDatabase`のpoolとmaintenance用のRustロックはプロセス内の共有を制御する。
SQLiteの書込みロックやimportのtransaction／rollbackはDB操作を保護するが、別プロセスの画面からの意図しない更新や、復元・保存場所移行との競合全体を防ぐものではない。
多重起動防止を追加しても、旧版や外部ツールによるDB操作まで安全になるとは扱わない。

## 公式Single Instanceプラグインの調査

[公式ガイド](https://tauri.app/plugin/single-instance/)は、アプリ側のプラグインのうち最初に登録するよう求めている。
ただし、Builderへ登録するだけでは、その前に呼んでいる`prepare_startup()`を保護できない。
導入する場合は、Single Instanceの初期化後へData Root準備を移し、DB初期化・migrationや設定準備が2回目に実行されない順序にする必要がある。
使用許諾の確認をWebView生成前に行う既存契約も、起動順序を変更する際の確認対象になる。

取得したcrateの固定ソースを比較した。2.4.0のcommitは`05045f9a7218fa023bf7260e497c1548682e5c96`、2.5.5は`128190689dbe59b59d344e01bf07b00862aa3791`である。

| 候補 | 互換性と調査結果 |
| --- | --- |
| 2.4.0 | Tauri依存は`2.10`、Rust最低版は1.77.2。既存Tauri 2.11.5と版の条件は適合するが、同時起動時の問題があるため採用していない |
| 2.5.1 | Tauri依存は`2.12`。既存Tauriの更新が必要で、下記の競合も残るため採用していない |
| 2.5.5 | Tauri依存は`2.12`、Rust最低版は1.90。調査環境のRust 1.99.1は満たす。Windowsの同時起動対策があるが、必要な依存更新をOwnerが採用しなかった |

2.4.0と2.5.1のWindows実装は、既存mutexを見つけても通知先の隠しウィンドウがまだ存在しない場合、そのままsetupを成功として返す。
そのため、極めて短い間隔の起動で2番目が継続する可能性をソース上で確認した。GUIで再現した結果ではない。
2.5.5は通知先の生成を最大約1秒待ち、見つからなくても2番目を終了する。通知には10秒のtimeoutがある。
固定ソース：[2.4.0 Windows実装](https://github.com/tauri-apps/plugins-workspace/blob/05045f9a7218fa023bf7260e497c1548682e5c96/plugins/single-instance/src/platform_impl/windows.rs)、[2.5.5 Windows実装](https://github.com/tauri-apps/plugins-workspace/blob/128190689dbe59b59d344e01bf07b00862aa3791/plugins/single-instance/src/platform_impl/windows.rs)。

2.5.5の依存解決では、追加・更新64件が提示された。Tauri 2.11.5→2.12.5、tauri-build 2.6.3→2.7.4、runtime、Wry、WebView2 wrapper等の更新と、Linux用zbus等の追加を含む。
無関係な一括update commandは実行していないが、結果が広範囲だったためOwnerへ確認した。
新規crateと互換性調査用のcrateはネットワークから取得した。開始時のcacheだけで新規依存を解決することはできなかった。
npm依存・lockfileは変更していない。試行後のTauri CLI検査では、Tauri 2.12.5と既存`@tauri-apps/api` 2.11.1の版不一致も検出したため、再開する場合はRust側だけの更新では足りない。

候補のcallbackは既存mainウィンドウが存在するときだけ、表示・最小化解除・focusを試みる構成が必要になる。
argvやCWDを使って保存場所を切り替えたり、既存画面のデータ・状態を更新したりしない。ウィンドウ未生成時に`expect`でpanicさせない。
これは未実装の設計条件であり、現在のアプリに前面表示・復元機能が追加されたわけではない。独自OSロックも追加していない。

## アプリ識別子と適用範囲

Debug、Release、ポータブル版は現在すべて`com.dolprogress.manager`を使用し、版やEXEの配置による識別子overrideはない。
2.5.5を標準feature構成で導入した場合のWindows実装は、このidentifierからmutex名を作り、EXEパス・CWD・Data Rootを判定に使わない。
`semver`と`deep-link`は任意featureであり、今回有効化していない。

| 組合せ | 現在の状態 | 2.5.5を導入した場合の静的な見通し |
| --- | --- | --- |
| 同一EXEの連続起動 | 稼働中全体の排他なし | 同じWindowsセッションの同一identifierなら2番目を抑止 |
| 別CWDから同一EXEを起動 | 稼働中全体の排他なし。DB位置はEXE基準 | CWDに関係なく抑止 |
| 同じEXEを別ディレクトリへcopy | 各Default DBは別だが同時起動防止なし | 配置に関係なく抑止 |
| DebugとRelease | identifierは同一、多重起動防止なし | 同一identifierのため同時起動を抑止 |
| 別ポータブル環境・異なるData Root | 同時起動防止なし。WebView2 UDF共有の既存制約もある | Data Rootが異なっていても抑止。Data Rootごとの並列起動は提供しない |
| プラグイン未導入の旧版 | 検出用mutexを持たない | 旧版の既存プロセスは検出できない。旧版からの追加起動も防げない |

異なるidentifier、別Windowsセッション、権限差などへ防止・focusの保証を拡張しない。
正常終了後の再起動、連打、focus、最小化復元は、採用後に隔離環境で実動作確認する必要がある。

## CSVと取得都市の根拠

Owner指定フォルダーの`quests.csv`と`discovery_items.csv`だけを読み取った。CSVの更新・再importは行っていない。
両方ともCP932互換でデコードし、TAB区切りと全行の列数を確認した。クエストは6,784行、16列、発見物は12列で、既知ヘッダーと一致した。未知列はなかった。

| ファイル | 監査したbytesのSHA-256 |
| --- | --- |
| quests.csv | `e94bc814fdc496ad997617fcc41ca3f352d7afd4ca4f559b838ddd8a5a0e70e5` |
| discovery_items.csv | `2dfcecffae1346d93624d9b7b96d6f24b8a886d7b3da5595f5e8c2e909260f2a` |

クエスト側の列は`data-import.md`の6.1と同じ16列で、都市名を持つ専用列は`オファー都市`だけだった。
`オファー方法`が既存の7学問分類に該当する地図は1,117件、そのうち都市値ありは1,104件、なしは13件だった。
複数都市の区切りは半角カンマである。CSV全体の列区切りであるTABとは区別する。

`備考`には書庫取得の裏付けになる記述が一部存在するが、他の前提地図の書庫都市や、発見場所の都市も含まれている。
都市値のない行にもクエスト報酬・宝箱などの説明があり、すべてを書庫地図として分類できない。
同じ地図を陸地再調査の報酬でも入手できるという記述もある。書庫の都市と再調査の取得場所は別の意味を持つ。
これらはCSV中の記述の確認であり、ゲーム内の取得条件の全件検証ではない。

したがって、地図の`オファー都市`を一律に「取得できる都市」へ読み替えたり、備考から都市名だけを抽出したりする表示は追加しない。
再開には、各地図の書庫由来の区分と都市の対応を確認できる情報源が必要になる。
もし将来の専用列が`raw_row_json`に保存されていれば既存読取経路を使えるが、今回のCSVにはその列がない。
schema変更や大量再取込が必要と判断したわけではなく、まず意味の確定が不足している。

## 既存の情報表示とデータ経路

「i」は`src/components/MasterInfoPopover.tsx`の`MasterInfoButton`で、クエスト・地図は`src/components/quests/QuestTable.tsx`から利用する。
クエスト・地図では現在、題名と備考をdialog形式のpopoverへ表示する。備考がなければボタンを表示しない。
同じ部品は発見物の説明・備考にも使われている。Escapeで閉じて元のボタンへfocusを戻す既存動作がある。

取込時は`normalizeQuestTable()`がオファー都市を`offerCity`へ、元の全列を`rawRowJson`へ保存する。
Rustの`quest_facets::parse_offer_cities()`は半角カンマで分割し、trim・空token除去・元position保持を行う。
`QuestRepository.listWithDiscoveries()`は`offerCity`・`rawRowJson`を取得し、都市テーブルもまとめて取得する。
`QuestsPage`の行モデルには`offerCity`と`offerCities`が既に渡っている。都市名の読取不足やN+1が障害ではなく、取得都市という意味を保証できないことが障害である。

今回はpopover、行高、寸法、キーボード操作、アクセシビリティ、filter、地図対象判定を変更していない。
都市表示の単一・複数・欠落・重複・異常区切り・非地図・既存情報との共存の追加テストは、根拠未確定のため実施対象にしていない。
地図状態・報告履歴・冒険勲功値のSQL、プロフィール分離、migration 001〜004、バックアップ・復元、H1/H2スクリプトも変更していない。

## 検証記録

以下は依存を開始時へ戻した既存構成の回帰確認であり、新機能の動作試験ではない。

| 検証 | 結果 |
| --- | --- |
| TypeScript全テスト | 34ファイル、388件成功 |
| TypeScript型検査 | `npm run build`内の`tsc --noEmit`成功 |
| Vite production build | 成功 |
| Rust全テスト | 逐次再実行で259件成功、6件ignore、失敗0。main／doc-testも成功 |
| Rust整形検査 | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`成功 |
| Tauri Debug build | `npm run tauri -- build --debug --no-bundle -- --locked --offline`成功 |
| Tauri Release build | `npm run tauri -- build --no-bundle -- --locked --offline`成功 |
| 多重起動・focus・最小化復元・終了後再起動 | 未検証。アプリEXEを起動していない |

Rustの最初の全テスト実行では258件成功、1件失敗、6件ignoreだった。
`consent::tests::filesystem::concurrent_readers_observe_complete_records_during_replacement`で、既存の10秒期限に達した。
同テストの単独再実行は成功した。その後、`cargo test --manifest-path src-tauri/Cargo.toml --locked --offline -- --test-threads=1`で全体も成功した。
原因は確定しておらず、並列負荷が原因と断定しない。テストや実装の変更は行っていない。
ignore対象には明示実行専用のC4実データ監査とNative UIのdesktop試験が含まれ、今回は有効にしていない。

テストは合成DBまたは既存の隔離fixtureを使い、本番・試用ポータブル環境と指定の3保全DBディレクトリへアクセスしていない。
既存のアプリプロセスを終了していない。実CSVやDB、ユーザー進捗をGit管理対象へ追加していない。

## ライセンスと再開時の確認事項

調査したSingle Instanceプラグインは`Apache-2.0 OR MIT`で、MITを選ぶ場合はcrate同梱の著作権表示とMIT全文の保持が必要になる。
今回は依存を採用していないため、通知正本・正式レビューmetadataは変更していない。
再開時は採用版と必要な依存更新の範囲を確定し、対応する通知差分を準備する。旧lockfileに対する正式レビューを新しい依存へ流用しない。
Microsoftの使用資格・リンク方式・配布構成に最終的な変更トリガーはない。既存の確認済み条件と未解決事項を維持し、再監査・公開承認はしていない。

Ownerの次の判断対象は、Tauriとnpm側を含む必要な依存更新を別作業として認めるか、および地図ごとの取得都市を確定できる情報源を用意できるかである。
導入を再開する場合は、稼働中の旧版を手動で終了した上で、明示した隔離Data Rootで同一EXE・別CWD・別配置・Debug／Release・別ポータブル環境の組合せを試験する。
2回目がDB初期化・migration・バックアップへ到達しないこと、先行画面の状態を変えないこと、連打時とmain未生成時の挙動も確認する。

関連する既存記述の不整合として、`src-tauri/src/consent/gate.rs`の`StartupGuard`には「通常runへの接続は未有効化」という旧コメントが残るが、`lib.rs`は`first_run::authorize()`を通じて同じguardを利用している。
公開APIの`gate::run()`自体は通常起動から呼ばれていないため、そのAPIの「未接続」コメントとは区別する。
本監査は実際の起動コードに基づいて記述し、今回の範囲外のコメント修正は行っていない。リポジトリ全体の整合性を網羅的に監査したものではない。
