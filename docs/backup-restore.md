# バックアップ／リストア仕様

## 1. 目的と対象

本書は、DOL Progress ManagerのSQLiteデータベース全体をローカルファイルへ安全に
バックアップし、検証済みファイルから復元する規則を定義する。

対象には以下を含む。

- マスターデータと関連テーブル
- `profiles`
- `quest_progress`
- `discovery_progress`
- `master_import_history`
- migration管理情報を含むその他のDB内容

プロフィール単位のexport、CSV／JSON変換、増分・自動・クラウドバックアップは対象外とする。

## 2. バックアップ

バックアップは実行中DBのOSレベル単純copyではなく、SQLiteの`VACUUM INTO`で整合した
snapshotを作る。ユーザーがsave dialogで選択した保存先と同じディレクトリに一時ファイルを
生成し、次の検証に合格してから保存先へrenameする。

1. SQLite DBとして別connectionでopenできる。
2. `PRAGMA quick_check`が`ok`を返す。
3. `PRAGMA foreign_key_check`が0行を返す。
4. BackupとRestoreは標準/カスタムを問わず、`ActiveDatabase`が保持する現在activeなDBだけを対象にする。inactiveな旧DBを参照または置換しない。
5. 本アプリの必須tableと、対応migration versionで必要なcolumnが存在する。
6. migration履歴がproject-owned migrationの正規prefixである。version、description、success、checksum、順序を確認する。

保存先に既存ファイルがある場合は、既存ファイルを一時退避してから検証済みsnapshotを
renameする。rename失敗時は既存ファイルを元へ戻す。生成または検証に失敗した一時ファイルは
削除し、現在DBには触れない。

推奨拡張子は`.sqlite3`とする。バックアップ操作によって現在DBの内容を変更してはならない。

## 3. 復元前検証と互換性

open dialogで選択したローカルファイル1件を、現在DBとは別connectionで検証する。選択した
だけでは復元しない。選択パスはRust側に一時保持し、Frontendへ渡すtokenと対応付ける。
Frontendから任意パスを復元commandへ渡す方式は採用しない。

以下は復元を拒否する。

- SQLiteとしてopenできない、または破損している。
- `PRAGMA quick_check`が`ok`でない。
- 本アプリの必須table、column、またはmigration管理tableがない。
- migration履歴が空、失敗状態、checksum不一致、順序不正、未知versionである。

backupは独自archiveではなくSQLite DBのsnapshotである。対応versionは別のbackup形式番号ではなく、
`_sqlx_migrations`に記録された最終migration versionを指す。現在はversion 1〜3の正規prefixを許可する。

| version | migration | 必須schemaの追加 |
|---|---|---|
| 1 | `initial_schema` | マスター、進捗、プロフィール、取り込み履歴等の初期table／column |
| 2 | `quest_facets` | 必要スキルと個別オファー都市のfacet table／column |
| 3 | `master_source_order` | `quests.source_order`と`discoveries.source_order` |

各versionで必須table／columnと、version・description・success・checksumが既知migrationの
連続したprefixであることを確認する。外部キー違反も復元を拒否する。version 3のsnapshotでも
source orderのcolumnが欠けていれば互換backupとして扱わない。

version 1／2 backupからの復元後は、再起動時に未適用migrationをversion 3まで適用する。
version 1では保存済みQuest列から必要スキルと個別オファー都市をbackfillしてから通常UIで利用する。
旧backupに元ファイルの行順がなければsource orderはNULLのままで、値を推測して補わない。
migration履歴を復元処理独自に書き換えてはならない。

backupはData Rootのbootstrap設定を含まない。Default／Customのどちらでも現在activeなDBへ復元し、
保存場所を切り替えたり、inactiveな旧DBを置換したりしない。

Portable Defaultは`<exe-dir>/data/dol-progress.db`、Customは選択した外部absolute rootのDBである。
bootstrapは`<exe-dir>/config`に分離するが、backup fileへ追加しない。Custom使用時はinactiveな
Default DBをopen・migrationせず、標準data directoryも起動ごとに作成しない。
旧private版のデータは旧版でbackupし、portable版で明示restoreする手順を後続Phaseで扱う。
public runtimeは旧AppData DB/bootstrapを探索・自動コピーしない。

## 4. 復元手順

復元は現在データが置き換わることと再起動を明示し、ユーザーが確認した場合だけ実行する。

1. Rustの`ActiveDatabase`が通常queryを停止し、SQLx poolをcloseする。
2. 復元対象を再検証する。
3. `VACUUM INTO`で現在DBのpre-restore safety backupを作成・検証する。
4. 復元対象を現在DBと同じディレクトリのstaging fileへcopyし、再検証する。
5. 現在DBをcheckpointし、不要になったSQLite sidecarを除去する。
6. 現在DBをrollback用ファイルへrenameする。
7. staging fileを現在DB名へrenameする。
8. 置換後DBを再検証する。
9. 成功時だけrollback用ファイルとsafety backupを削除する。
10. Tauriの正式なrestart要求を発行する。

置換または置換後検証が失敗した場合はrollback用ファイルを元DB名へ戻す。現在DBが存在しない
異常状態では、検証済みsafety backupからの復旧を試みる。テーブル単位のDELETE／INSERTによる
復元は行わない。

これらは通常の置換・検証失敗に対するrollback手順である。OSのrenameや復旧自体が失敗する場合も
あり、電源断を含むあらゆる障害での完全なatomicityを保証するものではない。復旧に失敗した場合は
残ったsafety backup等を保全して原因を確認する。pre-restore safety backupは成功後に削除する
一時的な保護であり、ユーザーが別途保存したbackupの代わりにはしない。

## 5. エラーとUI

アプリケーションは少なくとも以下を区別する。

- `BackupCancelled`
- `BackupFailed`
- `BackupValidationFailed`
- `RestoreCancelled`
- `InvalidBackup`
- `IncompatibleBackup`
- `RestoreFailed`

dialogのキャンセルはDBを変更しない正常な中止として扱う。通常UIには安全なユーザー向けmessage
だけを表示し、OS path、SQL全文、stack trace等のdeveloper detailを表示しない。

## 6. セキュリティとネットワーク

処理対象はユーザーがdialogで明示選択したローカルファイルに限定する。広範なfilesystem権限を
追加せず、ファイル操作と検証は専用Rust commandで行う。ネットワークアクセス、同期、background
処理は実装しない。
