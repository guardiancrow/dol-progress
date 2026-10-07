# データ保存場所

## 対象範囲

Phase 23D-B1はportableの標準保存場所、外部Custom root、bootstrap、filesystem startup failureを扱う。active databaseは常に1つだけであり、Frontendは保存場所を決定しない。Phase 23D-B2ではこれらの処理の前にWindowsのWebView2 Runtime preflightを追加する。release packaging、version変更は後続Phaseとする。クラウド同期・ネットワーク共有の正式サポートを追加しない。

## 保存場所とbootstrap

標準保存場所は`<exe-dir>\data\dol-progress.db`である。bootstrapの正本は`<exe-dir>\config\data-root.json`と`data-root.last-good.json`であり、DB rootとconfig rootを兼用しない。`PortablePaths`が`std::env::current_exe()`のparentから一度解決し、CWD、argv[0]、shortcutのStart Inに依存しない。PathBuf/OsStrを使用し、Unicodeと空白を保持する。

primaryとlast-goodの両方がなく標準DBもない場合だけ、clean first launchとして標準data/configを必要時に作成し、create_newで新規DB fileを確保する。DB初期化・migration・検証成功後に、両bootstrapへcommitted Default locatorを保存する。Defaultは`mode=default, dataRoot=null`とし、現在の絶対EXE pathは保存しない。

両bootstrapがなくても既存portable標準DBがあれば、SQLite/application/schema/migration prefixを検証してからopenし、必要な既存migrationと最終検証の成功後にDefault markerを保存する。不正DBをoverwrite・truncate・新規DBで置換しない。markerがある標準DBの欠落、またはprimary欠落かつlast-good artifactが存在する場合はRecoveryとし、空DBやdata directoryを自動で再作成しない。不読・不正なlast-goodもfirst launch扱いにはしない。

旧AppData DB/bootstrapの探索、auto-import、auto-copy、fallbackは行わない。公開前のprivate利用者は旧版backupから新版へ明示restoreする方針とし、具体的な利用者手順は後続Phaseで整備する。

```json
{
  "version": 1,
  "mode": "custom",
  "dataRoot": "D:\\data\\dol-progress",
  "state": "committed"
}
```

`state`は`pending`または`committed`である。pendingには進行中transitionのrollback sourceだけを`previous`として保存する。last-goodは最後に正常にcommittedされたlocatorであり、pendingのpreviousとは別の情報である。primaryが不正、未対応、または欠落してlast-goodが読める場合は、通常画面を開始せずRecovery画面を表示する。

## 起動とactive DB

WindowsではPortablePaths解決・filesystem preflightより先に`tauri::webview_version()`を検査する。
Runtime利用不能・検出失敗ではnative導入案内を表示して終了し、data/config作成・probe、bootstrap読込、
DB初期化、Tauri Builder/WebView生成へ進まない。検出規則と案内は`requirements.md`の3.3を正とする。

Tauri Builder.run前にconfig directoryの準備・検査を行い、`DataRootResolver`だけがbootstrapを解釈してStartupPlanを作る。Defaultが選ばれた場合だけ必要なdata directoryを準備・検査する。Customや設定異常からinactive Defaultへ切り替えない。PortablePathsと解決済みplanをsetupへ渡し、bootstrapを再解釈する別resolverを作らない。

setupでは既存DBをmigration前に検証し、`ActiveDatabase`がpoolを開く。新規DBも既存DBもforeign keysを有効にし、migration、facet backfill、SQLite/application validationを実行する。pending targetが検証を通ったときだけcommittedへ更新する。Custom rootが存在しない、DBがない、検証できない、またはbootstrapが壊れている場合、Recoveryを表示し、標準DBへのfallbackや空DB作成を行わない。

configと使用中Default dataの書込み検査は、create_newの一意probe -> small write -> flush -> sync_all -> close -> 同directoryの非上書きrename -> deleteとする。失敗時は自分が作ったfileだけをcleanupし、主操作とcleanupの失敗を区別する。既存ancestorとtargetのreparseを検査する。directory名のfile衝突や書込み不能はWebView生成前にnative日本語errorで説明して終了し、書込み可能な場所へのfolder全体の移動を案内する。UAC、ACL変更、AppData fallbackは行わない。probe後に発生したDB新規確保・Default DB書込み検査・bootstrap確定のfilesystem失敗もnative errorで終了する。

WebView2 UDFはアプリのDB/configとは別であり、Tauriの通常の`%LOCALAPPDATA%\com.dolprogress.manager`を維持する。環境/policyによるWebView2 overrideはこの保存場所仕様の管理外である。「AppDataを一切使わない完全portable」とはしない。

Importer、Progress Link、Backup、Restore、repository commandは`ActiveDatabase`だけを使用する。inactiveな旧DBへpathを渡すAPIは持たない。

## カスタム保存場所

カスタム保存場所はユーザーが選んだ外部absolute directoryそのものであり、その直下に`dol-progress.db`を置く。relative pathは保存しない。Windows 10/11のローカル固定NTFS、書込み可能な通常directoryだけを正式にサポートする。UNC、ネットワークドライブ、removable drive、FAT/exFAT、filesystem root、Program Files、reparse point（symlink/junction）を拒否する。

canonicalize後のcase-insensitiveかつpath separator境界を持つcontainment検査で、実行ファイルrootと同一、子孫、祖先のCustom rootを拒否する。`<exe-dir>`、`data`、`config`、`<exe-dir>/custom`を含む。portable DefaultをCustom locatorとして登録しない。既存rootの再指定、last-good再利用、pending previous Customにも同じ規則を適用する。

新しい移行先は空directoryでなければならない。Recoveryで既存rootを再指定する場合だけは、既存`dol-progress.db`がSQLite、`quick_check`、`foreign_key_check`、必須schema、migration状態の検証に合格すれば接続できる。

## 安全な移行

保存場所の切替は`ActiveDatabase`のmaintenance gateを取得して実行する。live DBをOSのfile copyで複製しない。active poolから`VACUUM INTO`で同一directoryのtemporary snapshotを作成し、SQLite/application validation後に最終名へ置換する。source DBとSQLite sidecarは移動・削除しない。

次にbootstrapをcrash-safe writeでpendingへ更新し、旧poolを閉じてrestartを要求する。temporary fileへ全量を書き込み、flushし、再読込とsemantic validationを通してから置換する。Windowsで既存primaryを更新する場合は`ReplaceFileW`を使用し、primaryを先に別名へrenameする欠落windowを作らない。committed時はprimaryの更新後にlast-goodを更新する。

pending bootstrapの書込み前にプロセスが停止すると、移行先には検証済みDBが残る一方、bootstrapは旧rootを指したままである。このDBを起動時に自動採用しない。旧rootを継続して使用し、残った移行先は空directoryではないため新規移行先としても選択できない。別の空directoryを選ぶか、内容を確認したうえで利用者が残存artifactを整理する必要がある。移行成功後に閉じた旧poolは再起動まで再openしないため、待機中のRestoreなどが旧source DBを変更することもない。

CustomからDefaultへ戻す先は現在の`<exe-dir>/data`であり、操作時だけ必要なdirectory準備・書込み検査を行う。既存Default DBがあれば先に検証し、`dol-progress.before-switch-*.sqlite3`として安全コピーに退避してからsnapshotを配置する。旧Customも削除しない。Custom起動ではinactive Defaultをopen・migration・overwriteせず、data directoryも不要に作成しない。

primaryとlast-goodは2file一括atomic transactionではない。primary失敗ではlast-goodを変更しない。primary成功後last-goodに失敗した場合は新primaryと旧last-goodを保全し、起動中の確定失敗はnative errorで終了する。Recovery情報は実際に残ったprimaryから生成し、committedになったprimaryにpending previousの操作を表示しない。valid primaryでの次回起動は従来どおり可能である。

## RecoveryとBackup

Recovery画面は設定済みroot、空DBを自動作成していないこと、失敗理由を示す。再試行、検証済み既存rootの再指定、検証済みlast-good Custom rootの再使用、pending transitionのprevious rootへのrollback、終了を提供する。previousへのrollbackはcurrent bootstrapがpendingで、valid previous locatorを持つ場合だけ表示する。Recoveryから古いDefault DBを直接activeにする操作は提供しない。CustomからDefaultへ戻す場合は、通常UIのsnapshotを伴うmigrationを使用する。

BackupとRestoreは現在の`ActiveDatabase.path`だけを対象にする。Custom modeでも標準DBへアクセスしない。backup formatは保存場所を含まず、Phase 10/11/12 backupを現在activeなDBへ復元できる。各snapshot、復元、起動確定で`PRAGMA quick_check = ok`と`PRAGMA foreign_key_check = 0 rows`を確認する。候補DBは既知migrationのversion、description、success、checksumからなるprefixと、対応versionの必須table・columnを満たさなければならない。

切替後のDefault DBとCustom DBはinactive safety copyとして残し、cleanupを自動化しない。アプリ終了後のfolder移動では、Defaultとconfigは新EXE directoryに追従する。absolute Custom（last-good/previousを含む）は元の外部pathを指し続ける。missing CustomをDefaultに自動切替しない。
