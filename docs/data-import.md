# GVDB マスターデータ取り込み仕様

## 1. 文書の目的

本書は、GVDBが公開しているクエスト情報および発見物情報を、
本アプリケーションのSQLiteマスターへ取り込む方法を定義する。

DBスキーマは `database-design.md` を正とする。

## 2. 基本方針

最優先事項は以下である。

1. GVDBへ不要な負荷をかけない。
2. アプリケーション自身はGVDBへ自動アクセスしない。
3. ユーザーが手動で取得したローカルファイルだけを読み込む。
4. GVDBへの書き込み処理を実装しない。
5. 取り込み失敗によって既存DBを半端な状態にしない。
6. マスター更新によってユーザー進捗を失わない。

## 3. ネットワークポリシー

v1のアプリケーションに以下を実装してはならない。

- GVDBからの自動ダウンロード
- 起動時の更新確認
- 定期ポーリング
- バックグラウンド更新
- スクレイピング
- GVDBへのPOST
- GVDBへのPUT
- GVDBへのPATCH
- GVDBへのDELETE

UIには「ファイルから更新」を提供する。

公開ファイルの取得はユーザー自身が必要時に手動で行う。

## 4. 対象データセット

v1では以下の2ファイルを対象とする。

- `quests.csv`
- `discovery_items.csv`

拡張子は `.csv` だが、一般的なカンマ区切りCSVとして処理しない。

## 5. ソースフォーマット

### 5.1 区切り文字

フィールド区切りはTAB (`\t`) とする。

CSVライブラリを使用する場合もdelimiterを明示的にTABへ設定する。

カンマは、一部フィールド内で関連項目の列挙に使用されるため、
ファイル全体のdelimiterとして扱ってはならない。

### 5.2 文字コード

CP932 / Windows-31J互換としてデコードする。

UTF-8であると仮定してはならない。

実装はTypeScriptまたはRustのどちらでもよいが、Windows固有文字を含む
テストfixtureを用意し、正しくデコードできることを確認する。

### 5.3 改行

CRLFおよびLFを許容する。

### 5.4 空欄

任意項目の空欄は `NULL` または空の関連集合として扱う。

表示用TEXT列は、意味のない空文字を極力 `NULL` に正規化する。

`raw_row_json` ではデコード済み原文を保持する。

## 6. `quests.csv`

### 6.1 必須ヘッダー

以下の16列を既知の列として扱う。

```text
ID
クエスト名・地図名
難易度
クロノクエスト
オファー方法
オファー都市
必要スキル
発見物種類
発見物
入手アイテム
備考
最終更新日時
連続クエスト名
順序
前提クエスト
後続クエスト
```

v1ではこれらを期待ヘッダーとする。

将来、GVDB側で未知の列が追加された場合:

- 必須列がすべて存在するなら、未知列の存在だけを理由に失敗させない。
- 未知列も `raw_row_json` には保存する。

必須列が欠落した場合:

- DB更新を開始せずインポートを中止する。
- 欠落列をユーザーへ示す。

### 6.2 フィールドマッピング

| ソース列 | DB |
|---|---|
| `ID` | `quests.gvdb_id` |
| `クエスト名・地図名` | `quests.title` |
| `難易度` | `quests.difficulty` |
| `クロノクエスト` | `quests.chrono_quest` |
| `オファー方法` | `quests.offer_method` |
| `オファー都市` | `quests.offer_city` |
| `必要スキル` | `quests.required_skills` |
| `発見物種類` | `quests.discovery_type_text` |
| `発見物` | 表示名称として正規化モデルで扱い、原文は `quests.raw_row_json` に保持 |
| `入手アイテム` | `quests.reward_items` |
| `備考` | `quests.notes` |
| `最終更新日時` | `quests.source_updated_at` |
| `連続クエスト名` | `quests.chain_name` |
| `順序` | `quests.chain_order` |
| 行全体 | `quests.raw_row_json` |

以下は関連テーブルへ正規化する。

| ソース列 | 反映先 |
|---|---|
| `前提クエスト` | `quest_dependencies` |
| `後続クエスト` | `quest_dependencies` |
| `必要スキル` | `quest_required_skills` |
| `オファー都市` | `quest_offer_cities` |

`発見物` は発見物の表示名称だけを含み、GVDB IDを含まない。ID付き関連項目として
解析せず、名称から `discoveries` を推測してはならない。`quest_discoveries` の構築には
使用しない。

### 6.3 必要スキルとオファー都市の正規化

`必要スキル`はASCII commaで分割し、trim後の空tokenを除外して元のpositionを保持する。
文字列末尾の `(<positive integer>)` だけをrank suffixとして分離する。suffix除去後の名称が
Unicode文字`語`で終わる場合はlanguage skillとし、suffixの値にかかわらず
`is_language = 1, required_rank = NULL`へ正規化する。このため`ギリシャ語`、`ギリシャ語(1)`、
`ギリシャ語(2)`は同じ意味である。language以外はsuffixをrankとして保存し、suffixがない場合は
`required_rank = NULL`を許容する。rankに最大値は設けない。

`オファー都市`もASCII commaで分割し、trim後の空tokenを除外して元のpositionを保持する。
都市名を過剰に正規化せず、独立した都市マスターは作成しない。

## 7. `discovery_items.csv`

### 7.1 必須ヘッダー

以下の12列を既知の列として扱う。

```text
ID
種別
発見物名
ランク
説明
時代
ポイント
難易度
経験値
備考
最終更新日時
関連クエスト
```

未知列の扱い、必須列欠落時の扱いは `quests.csv` と同じ。

### 7.2 フィールドマッピング

| ソース列 | DB |
|---|---|
| `ID` | `discoveries.gvdb_id` |
| `種別` | `discovery_categories.name` および `discoveries.category_id` |
| `発見物名` | `discoveries.name` |
| `ランク` | `discoveries.rank` |
| `説明` | `discoveries.description` |
| `時代` | `discoveries.era` |
| `ポイント` | `discoveries.points` |
| `難易度` | `discoveries.difficulty` |
| `経験値` | `discoveries.experience` |
| `備考` | `discoveries.notes` |
| `最終更新日時` | `discoveries.source_updated_at` |
| 行全体 | `discoveries.raw_row_json` |

`関連クエスト` は `quest_discoveries` へ正規化する。

## 8. 数値項目の検証

以下は数値として解釈する。

### quests

- `ID`: 必須の正整数
- `難易度`: 空欄または整数
- `順序`: 空欄または整数

### discoveries

- `ID`: 必須の正整数
- `ランク`: 空欄または整数
- `ポイント`: 空欄または整数
- `難易度`: 空欄または整数
- `経験値`: 空欄または整数

必須IDが不正な行はインポート全体を失敗させる。

任意数値欄に不正値が現れた場合も、v1では黙って丸めたり0へ置換したりせず、
検証エラーとして扱う。

## 9. 関連項目の形式

`discovery_items.csv` の `関連クエスト`、および `quests.csv` の
`前提クエスト`・`後続クエスト`は、概念的に次の形式とする。

```text
<ID>:<表示名>,<ID>:<表示名>,...
```

例:

```text
100:テスト依頼A,101:テスト地図B
```

解析ルール:

1. 空欄は関連なし。
2. 項目全体をカンマで分割する。
3. 各項目は最初の `:` でID部と表示名部に分ける。
4. ID部は正整数として検証する。
5. 関連付けの正本は数値IDとする。
6. 表示名は検証・診断ログ用であり、そのIDが指すマスターレコードの名称と比較する。
   関連先検索キーには使用しない。
7. 重複IDは1件へまとめる。
8. 不正なIDは検証エラーとする。

名称だけから関連先を推測してはならない。

## 10. クエストと発見物の関連構築

`quest_discoveries` は `discovery_items.csv` の `関連クエスト`だけを正本として構築する。
各発見物行の `ID`を発見物GVDB ID、`関連クエスト`内のIDをクエストGVDB IDとして
使用する。同じ関係が重複している場合は1行だけ保存する。

`quests.csv` の `発見物`は名称のみであるため、関連構築に使用しない。名称一致で
発見物IDを推測してはならない。

関係解決は以下で行う。

```text
quests.gvdb_id
discoveries.gvdb_id
```

名前一致で解決してはならない。

参照先IDが現在のインポートファイルには存在しないが、既存DBに非アクティブな
マスターとして存在する場合は、その既存レコードへ関連付けてよい。

参照先IDがDBにも存在しない場合:

- 架空のマスター行を作らない。
- 当該関連を保存しない。
- 診断警告として記録する。
- マスター本体の取り込みを失敗させるかどうかは実装時のUX判断とするが、
  少なくともユーザーデータへ影響させない。

推奨v1挙動は「警告して関連のみスキップ」である。

## 11. 前提クエスト関係の構築

`quest_dependencies` は次の双方から得られる関係をunionして構築する。

### 11.1 `前提クエスト`

クエストQの `前提クエスト` にPがある場合:

```text
quest_id = Q
prerequisite_quest_id = P
```

### 11.2 `後続クエスト`

クエストPの `後続クエスト` にQがある場合も:

```text
quest_id = Q
prerequisite_quest_id = P
```

前提列と後続列で同じ関係が得られた場合は重複保存しない。

自己参照は保存しない。

存在しない参照先IDの扱いは、クエスト・発見物関連と同じ方針とする。

## 12. テキスト正規化

表示用TEXT列では、最低限以下の正規化を許可する。

- 前後空白の除去
- `\r\n` / `\r` の改行正規化
- `<br>` / `<br/>` / `<br />` の改行への変換

HTMLとして実行・描画してはならない。

Reactで表示する際、GVDB由来文字列を `dangerouslySetInnerHTML` へ直接渡さない。

`raw_row_json` では、デコード後の元フィールド値を可能な限りそのまま保持する。

## 13. SHA-256

ユーザーが選択したファイルについて、解析前または解析初期にSHA-256を計算する。

`master_import_history` に同じ:

```text
(dataset, file_sha256)
```

が存在する場合、同一ファイルとして扱う。

推奨UI:

```text
このファイルは既にインポート済みです。
```

同一ファイルを強制再取込する機能はv1では不要。

ただし、既存DBへ `source_order` migrationを適用した直後だけは例外とする。当該datasetの
active masterに `source_order IS NULL` が1件でも残る場合、同じSHA-256の手動インポートを
1回だけmetadata completionとして受け付ける。この処理は既存のimport履歴行を追加せず、
完了後は通常どおり同じSHA-256を拒否する。QuestとDiscoveryは別datasetとして判定する。

## 13.1 source表示順

TSVのヘッダーを除く各データレコードへ、解析時点で0始まりの物理順を付与する。正規化、
重複IDの集約、Rust commandへの受け渡しの後もこの値を保持し、UPSERTで
`quests.source_order` または `discoveries.source_order` を更新する。重複IDが完全に同一の
場合は、最初に出現したレコードの順を採用する。

この順序は表示メタデータであり、`gvdb_id`、ローカル `id`、関連、進捗の同一性を置き換えない。
sourceから消えたinactive masterは最後に観測した値を保持する。server側のsort順は取得・
前提としない。

## 14. インポート処理フロー

推奨処理順:

```text
1. ユーザーがローカルファイルを選択
2. dataset種別を決定
3. SHA-256を計算
4. 既取込SHA-256を確認（metadata completion例外を含む）
5. CP932 / Windows-31Jとしてデコード
6. TAB区切りとして解析
7. ヘッダー検証
8. 全行を型検証
9. source表示順を含む正規化済み中間モデルを作成
10. BEGIN TRANSACTION
11. 対象datasetの既存masterを is_active = 0 にする
12. 各master行を gvdb_id とsource表示順でUPSERT
13. 今回存在したmasterを is_active = 1 にする
14. discovery categoryをUPSERT
15. 関連テーブルを再構築
16. master_import_historyへ履歴を追加
17. COMMIT
```

Quest取込時はincoming Questごとに既存の必要スキル・オファー都市facetを削除し、同じ
transaction内で現在sourceの内容へ置換する。sourceから消えたinactive Questの既存facetは保持する。
facet件数は既存`ImportResult.relationCount`へ加算しない。

途中で例外が発生した場合:

```text
ROLLBACK
```

を行う。

DB書き込み開始前に可能な検証を完了しておく。

## 15. UPSERT方針

マスターはローカルPKではなく `gvdb_id` を外部自然キーとして照合する。

概念例:

```sql
INSERT INTO quests (...)
VALUES (...)
ON CONFLICT(gvdb_id) DO UPDATE SET
    title = excluded.title,
    ...,
    is_active = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
```

既存ローカル `id` は維持する。

これにより `quest_progress` 等からのFK参照を安定させる。

同じ `gvdb_id` の既存行は `source_order` も現在のsourceファイルの物理順へ更新するが、
ローカル `id`、関連、ユーザー進捗は維持する。

## 16. 非アクティブ化

新しいファイルに存在しないマスターをDELETEしてはならない。

インポート対象datasetについて、処理開始時に既存行を一旦:

```text
is_active = 0
```

とし、今回読み込まれたIDだけ1へ戻す方式を使用できる。

ただしこの処理は必ず同一transaction内で行う。

### quests import

変更対象:

- `quests.is_active`

`discoveries` を非アクティブ化してはならない。

### discoveries import

変更対象:

- `discoveries.is_active`
- 必要に応じて `discovery_categories.is_active`

`quests` を非アクティブ化してはならない。

## 17. 発見物分類

`discovery_items.csv` の `種別` から `discovery_categories` をUPSERTする。

同名分類は同一カテゴリとする。

今回の発見物データから一度も参照されなかった既存カテゴリは、
`is_active = 0` としてよい。

`sort_order` はインポートで既存ユーザー設定を無条件に壊さない。

初出カテゴリに対してのみ、既存最大値の後ろへ追加する実装を推奨する。

## 18. 関連テーブル再構築

`quest_discoveries` と `quest_dependencies` は派生マスターデータなので、
トランザクション内で再構築してよい。

ただし、questとdiscoveryを別々のタイミングで取り込めることを考慮する。

`quest_discoveries` は `discoveries.raw_row_json` の `関連クエスト`から再計算する。
`quest_dependencies` は `quests.raw_row_json` の `前提クエスト`・`後続クエスト`から
再計算する。どちらかのdataset取込後でも、現在DBにあるマスター原文を使って
解決可能な全関連を再計算する。

`quest_required_skills`と`quest_offer_cities`はQuestごとの派生データであり、incoming Questだけを
置換する。既存DBへ新migrationを適用した際は、保存済み`quests.required_skills`と
`quests.offer_city`からImporterと同じ規則でatomicかつidempotentにbackfillする。
backfillはImport履歴を追加せず、同一SHA-256のDuplicateImport判定を緩和しない。

これにより:

- questsを先に取り込んだ
- discoveriesを後から取り込んだ

という順序でも、両dataset取込後の関係を同一にできる。discoveriesを先に取り込み、
関連先questがまだ存在しない場合は、架空questを作らず警告して関連をスキップする。
その後questsを取り込んだ際に、既存の `discoveries.raw_row_json` から再構築する。

## 19. ユーザーデータ保護

インポート処理が変更してよいテーブル:

```text
quests
discoveries
discovery_categories
quest_discoveries
quest_dependencies
quest_required_skills
quest_offer_cities
master_import_history
```

インポート処理が変更してはならないテーブル:

```text
profiles
quest_progress
discovery_progress
```

この制約はテストで検証する。

## 20. インポート履歴

成功したインポートだけを `master_import_history` へ記録する。

記録項目:

- dataset
- file_name
- SHA-256
- row_count
- source_max_updated_at
- imported_at
- 必要に応じたnotes

失敗したインポートはtransactionがrollbackされるため、成功履歴として残さない。

診断情報が必要な場合は、アプリログ等へ出力する。

## 21. エラーと警告

### エラーとしてインポートを中止する例

- ファイルをCP932互換として解釈できない
- TAB区切りとして必要ヘッダーを取得できない
- 必須ヘッダー欠落
- `ID` が空欄
- `ID` が整数でない
- 同一ファイル内で同じ主IDが矛盾する内容で重複
- 任意数値列に明らかな不正値
- DB transaction失敗

### 警告として継続可能な例

- 関連先IDが現在のDBに存在しない
- `ID:名称` の名称が参照先マスター名と異なる
- 未知の追加列が存在する
- HTML風表現など、表示時に正規化した文字列が存在する

警告はユーザーが確認可能な形で件数と概要を示すのが望ましい。

## 22. テストfixture

自動テストは小さな人工fixtureを使用する。

テストリポジトリへGVDBの全公開データをコピーしない。

fixtureでは少なくとも以下を再現する。

- CP932日本語
- TAB区切り
- 空欄
- 複数関連
- 一方向だけに記載された関連
- 重複関連
- `<br>` を含むテキスト
- 不正ID
- 不正数値
- 非アクティブ化対象
- 既存ユーザー進捗が存在する状態

テストはネットワークアクセスなしで完結させる。

通常の`npm test`と`cargo test`は実GVDBファイルを必要としない。実ファイルを使う任意の
`local_gvdb_acceptance_satisfies_import_contract`は既定でignoredとし、
`local-data/gvdb/quests.csv`と`local-data/gvdb/discovery_items.csv`を手動配置した場合だけ
明示実行する。ファイルがない場合は、必要な配置先を示して失敗する。

この任意テストはin-memory DBで取り込み結果とsource order、外部キー、関連の重複制約、
言語スキルのRank、SQLite整合性を検証する。特定snapshotのID・名称・総件数を期待値として
保持せず、実データのsnapshot regressionは公開テストに含めない。任意の既存DBを指定して
実行する機能は提供しない。

## 23. リポジトリへのデータ配置

公開マスターの実ファイルをソースリポジトリへ恒久的に同梱することはv1の前提としない。

開発時にローカルへ置く場合は、Git管理外の場所を使用する。

`.gitignore` に専用のローカルデータディレクトリを追加してもよい。

ユーザーがインポートした元ファイルをアプリが永続コピーする必要もない。
DBへ取り込み後はSQLiteマスターだけで通常利用できる。
