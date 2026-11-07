# 初回報告履歴の互換保全と合成検証

## 通常のmigration 004

004は旧勲功値の算入資格をunknown＋legacyで保全し、過去の初回報告をconfirmedと推測しない。
現在のreportedは現在状態であり、一般の旧DBから生涯初回の報告実績を確定する証拠にはしない。
通常の移行・報告操作・履歴訂正は[DB設計](database-design.md)に従う。個別の履歴引継ぎは通常004の必須手順ではない。

## 公開版の合成試験

H1の純粋計画処理は、入力の根拠を合成fixtureで明示した場合の状態分類、資格ID集合と勲功値の保持を検証する。
H2由来の試験処理は、factoryで生成したメモリDBだけを受け付ける。実DBの修復ツールではなく、実DBを開くCLI・path設定・外部接続の入口は持たない。
Owner固有の実行・承認・保全記録は公開版へ含めない。

node --test scripts/map-history-h1.synthetic.mjs scripts/map-history-h2.synthetic.mjs scripts/tests/map-history-memory-support.synthetic.mjsで合成試験を実行する。
SQLite authorizerを必要とするためNode.js 24.10以降を使用し、利用できなければ安全側に失敗する。通常アプリの実行要件を変更するものではない。

## 維持する検証契約

プロフィールと発見物の対応、進捗PK・業務列・timestamp、schema・migration checksum、履歴CHECK、レリック除外を確認する。
confirmedとlegacy=1は併存させず、訂正や再実行で確定履歴を格下げしない。
勲功値の合計だけでなく資格ID集合も比較し、未知の履歴・矛盾・既存進捗の差があれば停止する。
単一transactionで期待値を再確認し、途中およびcommit直前の失敗をrollbackする。新規履歴だけに実際の作成時刻を設定する。

memory supportは接続・statementを公開せず、外部handleを拒否する。SQLite authorizerでATTACH・DETACH・VACUUM INTO・extension等を拒否し、実ファイルへの書込み経路を作らない。
[Node.js SQLite authorizer](https://nodejs.org/api/sqlite.html#databasesetauthorizercallback)を使用する。
合成試験の成功は、個別の実コピー・専用runner・実ファイル保全・commit後の実DB監査・本番適用の承認を意味しない。
