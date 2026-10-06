# データ保存場所

## 対象範囲

Phase 13B-2は標準保存場所とカスタム保存場所を扱う。Portable mode、実行ファイル隣接の保存、クラウド同期、ネットワーク共有は実装しない。active databaseは常に1つだけであり、Frontendは保存場所を決定しない。

## 保存場所とbootstrap

標準保存場所はTauri AppConfig directory直下の`dol-progress.db`である。Windowsでは通常`%APPDATA%\com.dolprogress.manager\dol-progress.db`となる。AppConfig directoryには`data-root.json`と`data-root.last-good.json`を置く。

primaryとlast-goodの両方が存在しない場合だけ、bootstrap未導入のlegacy Default modeとして扱う。既存DBを移動せず、従来と同じ標準DBを開く。bootstrapがない完全な初回起動だけは標準DBを新規作成してよい。primaryが欠落していてもlast-good fileが存在する場合は、Custom利用履歴のあるinstallationとしてRecovery画面を表示する。

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

起動時は`DataRootResolver`だけがbootstrapを読み、active rootとDB pathを決定する。次に`ActiveDatabase`がpoolを開き、migration、facet backfill、SQLite/application validationを実行する。pending targetが検証を通ったときだけbootstrapをcommittedへ更新する。Custom rootが存在しない、DBがない、検証できない、またはbootstrapが壊れている場合、標準DBへのフォールバックや空DB作成を行わない。

Importer、Progress Link、Backup、Restore、repository commandは`ActiveDatabase`だけを使用する。inactiveな旧DBへpathを渡すAPIは持たない。

## カスタム保存場所

カスタム保存場所はユーザーが選んだdirectoryそのものであり、その直下に`dol-progress.db`を置く。Windows 10/11のローカル固定NTFS、書込み可能な通常directoryだけを正式にサポートする。UNC、ネットワークドライブ、removable drive、FAT/exFAT、filesystem root、Program Files、実行ファイルdirectory、reparse point（symlink/junction）を拒否する。

新しい移行先は空directoryでなければならない。Recoveryで既存rootを再指定する場合だけは、既存`dol-progress.db`がSQLite、`quick_check`、`foreign_key_check`、必須schema、migration状態の検証に合格すれば接続できる。

## 安全な移行

保存場所の切替は`ActiveDatabase`のmaintenance gateを取得して実行する。live DBをOSのfile copyで複製しない。active poolから`VACUUM INTO`で同一directoryのtemporary snapshotを作成し、SQLite/application validation後に最終名へ置換する。source DBとSQLite sidecarは移動・削除しない。

次にbootstrapをcrash-safe writeでpendingへ更新し、旧poolを閉じてrestartを要求する。temporary fileへ全量を書き込み、flushし、再読込とsemantic validationを通してから置換する。Windowsで既存primaryを更新する場合は`ReplaceFileW`を使用し、primaryを先に別名へrenameする欠落windowを作らない。committed時はprimaryの更新後にlast-goodを更新する。

pending bootstrapの書込み前にプロセスが停止すると、移行先には検証済みDBが残る一方、bootstrapは旧rootを指したままである。このDBを起動時に自動採用しない。旧rootを継続して使用し、残った移行先は空directoryではないため新規移行先としても選択できない。別の空directoryを選ぶか、内容を確認したうえで利用者が残存artifactを整理する必要がある。移行成功後に閉じた旧poolは再起動まで再openしないため、待機中のRestoreなどが旧source DBを変更することもない。

CustomからDefaultへ戻す場合、既存Default DBがあれば先に検証し、`dol-progress.before-switch-*.sqlite3`として安全コピーに退避してからsnapshotを配置する。旧Customも削除しない。

## RecoveryとBackup

Recovery画面は設定済みroot、空DBを自動作成していないこと、失敗理由を示す。再試行、検証済み既存rootの再指定、検証済みlast-good Custom rootの再使用、pending transitionのprevious rootへのrollback、終了を提供する。previousへのrollbackはcurrent bootstrapがpendingで、valid previous locatorを持つ場合だけ表示する。Recoveryから古いDefault DBを直接activeにする操作は提供しない。CustomからDefaultへ戻す場合は、通常UIのsnapshotを伴うmigrationを使用する。

BackupとRestoreは現在の`ActiveDatabase.path`だけを対象にする。Custom modeでも標準DBへアクセスしない。backup formatは保存場所を含まず、Phase 10/11/12 backupを現在activeなDBへ復元できる。各snapshot、復元、起動確定で`PRAGMA quick_check = ok`と`PRAGMA foreign_key_check = 0 rows`を確認する。候補DBは既知migrationのversion、description、success、checksumからなるprefixと、対応versionの必須table・columnを満たさなければならない。

切替後のDefault DBとCustom DBはinactive safety copyとして残す。Phase 13B-2はcleanupを自動化しない。
