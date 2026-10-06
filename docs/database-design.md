# SQLite データベース設計

## 1. 文書の位置付け

本書は本プロジェクトのSQLiteスキーマに関する唯一の正本である。

機能上の意味は `requirements.md`、GVDB公開ファイルからの取り込み規則は
`data-import.md` を参照する。

実装上のmigrationは、本書の定義と一致させること。

## 2. 設計原則

1. SQLiteを使用する。
2. 外部キー制約を必ず有効化する。
3. GVDBの外部IDとローカル主キーを分離する。
4. マスターデータとユーザーデータを論理的に分離する。
5. ユーザー進捗は「状態変更された対象だけ行を持つ」疎な構造とする。
6. マスターデータから消えたレコードは物理削除せず `is_active = 0` とする。
7. マスター取込処理はユーザーデータへ書き込まない。
8. DBスキーマ変更はmigrationで管理する。
9. アプリ内部の生成日時はUTCのISO 8601文字列で保存する。
10. GVDB由来の日時文字列は、元データの意味を推測して変換せず `source_updated_at`
    として保持する。

SQLite接続時には必ず以下を有効化する。

```sql
PRAGMA foreign_keys = ON;
```

## 3. テーブル一覧

| テーブル | 区分 | 目的 |
|---|---|---|
| `profiles` | ユーザー | キャラクタープロフィール |
| `quests` | マスター | GVDBクエスト／地図系レコード |
| `discoveries` | マスター | 発見物 |
| `discovery_categories` | マスター | 発見物分類 |
| `quest_discoveries` | マスター | クエストと発見物の多対多関連 |
| `quest_dependencies` | マスター | クエスト前提関係 |
| `quest_required_skills` | マスター | クエストごとの必要スキル |
| `quest_offer_cities` | マスター | クエストごとの個別オファー都市 |
| `quest_progress` | ユーザー | プロフィール別クエスト達成 |
| `discovery_progress` | ユーザー | プロフィール別発見・報告・カード状態 |
| `master_import_history` | 管理 | マスターファイル取込履歴 |

## 4. 状態表現の不変条件

### 4.1 クエスト

- `quest_progress` 行なし = 未達成
- `quest_progress` 行あり = 達成済み

未達成行を大量に事前生成しない。

### 4.2 発見物

- `discovery_progress` 行なし = 未発見
- 行ありかつ `reported = 0` = 発見済み・未報告
- 行ありかつ `reported = 1` = 報告済み

ただし、`discovery_categories.name = 'レリック'`の発見物では報告は対象外である。行の存在が発見済みかつ最終状態を表し、`reported`のbool値は進捗の意味を持たない。

### 4.2.1 冒険勲功値

冒険勲功値は永続列や集計テーブルを持たない派生値である。プロフィールごとに、報告済みかつ
報告可能な発見物の`discoveries.experience`を都度合計する。レリックは対象外とし、報告済みの
非アクティブ発見物は過去の獲得値として含める。`experience = NULL`は未知値であり合計へ含めず、
UIでは「冒険勲功値（判明分）」と表示する。爵位thresholdおよび爵位判定は保持・算出しない。

### 4.3 カード

`discovery_progress` 行が存在する発見物について:

- `card_owned = 1` = 所有
- `card_owned = 0` = 非所有

`reported` と `card_owned` は独立した状態であり、単一enumへ統合しない。

ただし、`discovery_categories.name = 'レリック'`の発見物ではカードは対象外である。`card_owned`のbool値は進捗の意味を持たない。新規行は一貫した保存値として`reported = 0`、`card_owned = 0`で作成し、報告・カード変更をdomain commandで拒否する。

## 5. テーブル定義

## 5.1 `profiles`

1行が1キャラクターを表す。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `id` | INTEGER | NO | ローカルPK |
| `name` | TEXT | NO | 表示名／キャラクター名 |
| `memo` | TEXT | YES | 任意メモ |
| `created_at` | TEXT | NO | 作成日時 |
| `updated_at` | TEXT | NO | 更新日時 |

`name` はUNIQUEにしない。将来、同名キャラクターを管理する可能性を妨げないためである。

## 5.2 `discovery_categories`

GVDB発見物の「種別」から生成する。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `id` | INTEGER | NO | ローカルPK |
| `name` | TEXT | NO | 分類名 |
| `sort_order` | INTEGER | NO | UI表示順 |
| `is_active` | INTEGER | NO | 現在のマスターに存在するか |
| `created_at` | TEXT | NO | 作成日時 |
| `updated_at` | TEXT | NO | 更新日時 |

`name` はUNIQUEとする。

## 5.3 `quests`

GVDB `quests.csv` のマスター。

| 列 | 型 | NULL | 対応元／説明 |
|---|---|---|---|
| `id` | INTEGER | NO | ローカルPK |
| `gvdb_id` | INTEGER | NO | `ID` |
| `title` | TEXT | NO | `クエスト名・地図名` |
| `difficulty` | INTEGER | YES | `難易度` |
| `chrono_quest` | TEXT | YES | `クロノクエスト` |
| `offer_method` | TEXT | YES | `オファー方法` |
| `offer_city` | TEXT | YES | `オファー都市` |
| `required_skills` | TEXT | YES | `必要スキル` |
| `discovery_type_text` | TEXT | YES | `発見物種類` の原文 |
| `reward_items` | TEXT | YES | `入手アイテム` |
| `notes` | TEXT | YES | `備考` |
| `chain_name` | TEXT | YES | `連続クエスト名` |
| `chain_order` | INTEGER | YES | `順序` |
| `source_updated_at` | TEXT | YES | `最終更新日時` 原文 |
| `source_order` | INTEGER | YES | sourceファイルのヘッダーを除く0始まりのレコード順 |
| `is_active` | INTEGER | NO | 現行ファイルに存在するか |
| `raw_row_json` | TEXT | NO | 取り込み元1行の原文マップJSON |
| `created_at` | TEXT | NO | ローカル作成日時 |
| `updated_at` | TEXT | NO | ローカル更新日時 |

`gvdb_id` はUNIQUEとする。

`source_order` は表示用メタデータであり、ID、関連、進捗の同一性には使用しない。既存DBへ
migrationを適用した直後は `NULL` とし、ローカル `id` から推測してbackfillしてはならない。
手動インポート時は、各入力行の物理順で更新する。sourceから消えた非アクティブ行は、最後に
観測した値を保持する。

明示的なユーザーsortがない通常の一覧・検索・カテゴリ絞り込みは、既知の `source_order` を
昇順、`NULL` をその後、最後に `id` 昇順で並べる。画面の明示sortはこの既定順を上書きする。

`発見物` は表示名称であり、名称から発見物IDを推測しない。`前提クエスト`、
`後続クエスト` は `quest_dependencies` へ正規化する。いずれも専用のTEXT列は持たず、
原文は `raw_row_json` に保持する。

### 5.3.1 `quest_required_skills`

`quests.required_skills`をASCII commaで分割した、順序付きの派生マスターデータである。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `quest_id` | INTEGER | NO | `quests.id` |
| `position` | INTEGER | NO | 元フィールド内の0始まりの位置 |
| `skill_name` | TEXT | NO | rank suffixを除いたスキル名 |
| `required_rank` | INTEGER | YES | 正の必要rank |
| `is_language` | INTEGER | NO | 0=通常skill、1=language skill |

複合PKは `(quest_id, position)` とする。`required_rank`に上限は設けない。
`required_rank = NULL`は、`is_language = 1`ではrankを管理しないこと、`is_language = 0`では
sourceにrankが記載されていないことを表す。

### 5.3.2 `quest_offer_cities`

`quests.offer_city`をASCII commaで分割した、順序付きの派生マスターデータである。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `quest_id` | INTEGER | NO | `quests.id` |
| `position` | INTEGER | NO | 元フィールド内の0始まりの位置 |
| `city_name` | TEXT | NO | 個別都市名 |

複合PKは `(quest_id, position)` とする。独立した都市マスターは作成しない。

## 5.4 `discoveries`

GVDB `discovery_items.csv` のマスター。

| 列 | 型 | NULL | 対応元／説明 |
|---|---|---|---|
| `id` | INTEGER | NO | ローカルPK |
| `gvdb_id` | INTEGER | NO | `ID` |
| `category_id` | INTEGER | YES | 発見物分類FK |
| `name` | TEXT | NO | `発見物名` |
| `rank` | INTEGER | YES | `ランク` |
| `description` | TEXT | YES | `説明` |
| `era` | TEXT | YES | `時代` |
| `points` | INTEGER | YES | `ポイント` |
| `difficulty` | INTEGER | YES | `難易度` |
| `experience` | INTEGER | YES | `経験値` |
| `notes` | TEXT | YES | `備考` |
| `source_updated_at` | TEXT | YES | `最終更新日時` 原文 |
| `source_order` | INTEGER | YES | sourceファイルのヘッダーを除く0始まりのレコード順 |
| `is_active` | INTEGER | NO | 現行ファイルに存在するか |
| `raw_row_json` | TEXT | NO | 取り込み元1行の原文マップJSON |
| `created_at` | TEXT | NO | ローカル作成日時 |
| `updated_at` | TEXT | NO | ローカル更新日時 |

`gvdb_id` はUNIQUEとする。

`source_order` の意味と更新規則は `quests.source_order` と同じである。これは分類の
`sort_order` やローカルPKとは独立した、source表示順だけのメタデータである。

`関連クエスト` は `quest_discoveries` へ正規化し、原文は `raw_row_json` に保持する。

## 5.5 `quest_discoveries`

クエスト／地図系レコードと発見物の多対多関係。
`discovery_items.csv` の `関連クエスト`を正本とし、発見物GVDB IDとクエストGVDB IDで
構築する。`quests.csv` の名称のみの `発見物`からは構築しない。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `quest_id` | INTEGER | NO | `quests.id` |
| `discovery_id` | INTEGER | NO | `discoveries.id` |

複合PK:

```text
(quest_id, discovery_id)
```

同じ関連が複数ソース列から得られても1行だけ保持する。

## 5.6 `quest_dependencies`

前提クエスト関係を表す。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `quest_id` | INTEGER | NO | 後続側クエスト |
| `prerequisite_quest_id` | INTEGER | NO | 前提側クエスト |

意味:

```text
quest_id は prerequisite_quest_id を前提とする
```

複合PK:

```text
(quest_id, prerequisite_quest_id)
```

後続クエスト専用テーブルは作らない。逆方向に検索すれば取得できるためである。

自己参照:

```text
quest_id = prerequisite_quest_id
```

は禁止する。

## 5.7 `quest_progress`

プロフィール別クエスト達成情報。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `profile_id` | INTEGER | NO | プロフィールFK |
| `quest_id` | INTEGER | NO | クエストFK |
| `memo` | TEXT | YES | 任意メモ |
| `updated_at` | TEXT | NO | 最終更新日時 |

複合PK:

```text
(profile_id, quest_id)
```

行の存在そのものが「達成済み」を表す。

## 5.8 `discovery_progress`

プロフィール別発見物進捗。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `profile_id` | INTEGER | NO | プロフィールFK |
| `discovery_id` | INTEGER | NO | 発見物FK |
| `reported` | INTEGER | NO | 0=未報告、1=報告済み |
| `card_owned` | INTEGER | NO | 0=非所有、1=所有 |
| `memo` | TEXT | YES | 任意メモ |
| `updated_at` | TEXT | NO | 最終更新日時 |

複合PK:

```text
(profile_id, discovery_id)
```

`reported` と `card_owned` は0/1以外を禁止する。

通常の「発見済みとして登録」操作では `card_owned = 1` を初期値とする。

### 5.8.1 進捗の正方向連動とtransaction

Quest達成時の `quest_progress` INSERTと未発見の関連`discovery_progress` INSERT、および
Discovery発見時の `discovery_progress` INSERTと任意の関連`quest_progress` INSERTは、
application serviceが同一SQLite transactionで実行する。対象は`quest_discoveries`の直接関係かつ
自動追加先の`is_active = 1` masterに限定する。

既存progress行は更新せず、取り消し方向では操作対象自身のprogress行だけをDELETEする。
この連動はevent semanticsであり、trigger、追加status列、schema constraint、既存データの
backfillでは実装しない。

## 5.9 `master_import_history`

インポート済みファイルを識別し、重複処理を避ける。

| 列 | 型 | NULL | 説明 |
|---|---|---|---|
| `id` | INTEGER | NO | PK |
| `dataset` | TEXT | NO | `quests` または `discoveries` |
| `file_name` | TEXT | NO | ユーザーが選択したファイル名 |
| `file_sha256` | TEXT | NO | ファイル全体のSHA-256 |
| `row_count` | INTEGER | YES | 解析したデータ行数 |
| `source_max_updated_at` | TEXT | YES | ソース内の最終更新日時最大値（文字列） |
| `imported_at` | TEXT | NO | ローカル取込日時 |
| `notes` | TEXT | YES | 任意の診断情報等 |

`dataset + file_sha256` をUNIQUEとする。

## 6. 現行DDL

新規DBではmigration 001から003を順に適用し、本節と等価なスキーマを作成する。既存DBには
既適用migrationを編集せず、追加migrationで列を加える。

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    memo        TEXT,
    created_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE discovery_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
                CHECK (is_active IN (0, 1)),
    created_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE quests (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    gvdb_id              INTEGER NOT NULL UNIQUE,
    title                TEXT NOT NULL,
    difficulty           INTEGER,
    chrono_quest         TEXT,
    offer_method         TEXT,
    offer_city           TEXT,
    required_skills      TEXT,
    discovery_type_text  TEXT,
    reward_items         TEXT,
    notes                TEXT,
    chain_name           TEXT,
    chain_order          INTEGER,
    source_updated_at    TEXT,
    source_order         INTEGER,
    is_active            INTEGER NOT NULL DEFAULT 1
                         CHECK (is_active IN (0, 1)),
    raw_row_json         TEXT NOT NULL,
    created_at           TEXT NOT NULL
                         DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at           TEXT NOT NULL
                         DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE discoveries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    gvdb_id            INTEGER NOT NULL UNIQUE,
    category_id        INTEGER,
    name               TEXT NOT NULL,
    rank               INTEGER,
    description        TEXT,
    era                TEXT,
    points             INTEGER,
    difficulty         INTEGER,
    experience         INTEGER,
    notes              TEXT,
    source_updated_at  TEXT,
    source_order       INTEGER,
    is_active          INTEGER NOT NULL DEFAULT 1
                       CHECK (is_active IN (0, 1)),
    raw_row_json       TEXT NOT NULL,
    created_at         TEXT NOT NULL
                       DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at         TEXT NOT NULL
                       DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (category_id)
        REFERENCES discovery_categories(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE quest_discoveries (
    quest_id      INTEGER NOT NULL,
    discovery_id  INTEGER NOT NULL,
    PRIMARY KEY (quest_id, discovery_id),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (discovery_id)
        REFERENCES discoveries(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE quest_dependencies (
    quest_id               INTEGER NOT NULL,
    prerequisite_quest_id  INTEGER NOT NULL,
    PRIMARY KEY (quest_id, prerequisite_quest_id),
    CHECK (quest_id <> prerequisite_quest_id),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (prerequisite_quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE quest_progress (
    profile_id  INTEGER NOT NULL,
    quest_id    INTEGER NOT NULL,
    memo        TEXT,
    updated_at  TEXT NOT NULL
                DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, quest_id),
    FOREIGN KEY (profile_id)
        REFERENCES profiles(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE discovery_progress (
    profile_id    INTEGER NOT NULL,
    discovery_id  INTEGER NOT NULL,
    reported      INTEGER NOT NULL DEFAULT 0
                  CHECK (reported IN (0, 1)),
    card_owned    INTEGER NOT NULL DEFAULT 1
                  CHECK (card_owned IN (0, 1)),
    memo          TEXT,
    updated_at    TEXT NOT NULL
                  DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, discovery_id),
    FOREIGN KEY (profile_id)
        REFERENCES profiles(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (discovery_id)
        REFERENCES discoveries(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE master_import_history (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset                TEXT NOT NULL
                           CHECK (dataset IN ('quests', 'discoveries')),
    file_name              TEXT NOT NULL,
    file_sha256            TEXT NOT NULL,
    row_count              INTEGER,
    source_max_updated_at  TEXT,
    imported_at            TEXT NOT NULL
                           DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    notes                  TEXT,
    UNIQUE (dataset, file_sha256)
);
```

### 6.1 Phase 11 Quest facet DDL

`002_quest_facets` migrationは既存テーブルを変更せず、次を追加する。

```sql
CREATE TABLE quest_required_skills (
    quest_id       INTEGER NOT NULL,
    position       INTEGER NOT NULL,
    skill_name     TEXT NOT NULL,
    required_rank  INTEGER,
    is_language    INTEGER NOT NULL DEFAULT 0
                   CHECK (is_language IN (0, 1)),
    PRIMARY KEY (quest_id, position),
    CHECK (skill_name <> ''),
    CHECK (required_rank IS NULL OR required_rank > 0),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE TABLE quest_offer_cities (
    quest_id   INTEGER NOT NULL,
    position   INTEGER NOT NULL,
    city_name  TEXT NOT NULL,
    PRIMARY KEY (quest_id, position),
    CHECK (city_name <> ''),
    FOREIGN KEY (quest_id)
        REFERENCES quests(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);
```

## 7. インデックス

PKおよびUNIQUE制約で自動生成されるもの以外に、v1では以下を作成する。

```sql
CREATE INDEX idx_quests_title
    ON quests(title);

CREATE INDEX idx_quests_offer_method
    ON quests(offer_method);

CREATE INDEX idx_quests_offer_city
    ON quests(offer_city);

CREATE INDEX idx_quests_active
    ON quests(is_active);

CREATE INDEX idx_discoveries_name
    ON discoveries(name);

CREATE INDEX idx_discoveries_category
    ON discoveries(category_id);

CREATE INDEX idx_discoveries_active
    ON discoveries(is_active);

CREATE INDEX idx_quest_discoveries_discovery
    ON quest_discoveries(discovery_id);

CREATE INDEX idx_quest_dependencies_prerequisite
    ON quest_dependencies(prerequisite_quest_id);

CREATE INDEX idx_discovery_progress_profile_reported
    ON discovery_progress(profile_id, reported);

CREATE INDEX idx_discovery_progress_profile_card_owned
    ON discovery_progress(profile_id, card_owned);
```

FTS5はv1では作成しない。

Phase 11 migrationでは次のindexも追加する。

```sql
CREATE INDEX idx_quest_required_skills_skill_name ON quest_required_skills(skill_name);
CREATE INDEX idx_quest_required_skills_quest ON quest_required_skills(quest_id);
CREATE INDEX idx_quest_offer_cities_city_name ON quest_offer_cities(city_name);
CREATE INDEX idx_quest_offer_cities_quest ON quest_offer_cities(quest_id);
```

## 8. 削除ポリシー

## 8.1 プロフィール

ユーザーがプロフィールを明示的に削除した場合:

- `profiles` を削除してよい。
- そのプロフィールの `quest_progress` はCASCADE削除する。
- そのプロフィールの `discovery_progress` はCASCADE削除する。

## 8.2 マスター

通常のマスターインポートで以下を物理削除してはならない。

- `quests`
- `discoveries`
- `discovery_categories`

新しいソースファイルに存在しない場合は `is_active = 0` とする。

理由は、既存ユーザー進捗の参照先を保持するためである。

## 8.3 関連テーブル

`quest_discoveries`、`quest_dependencies`、`quest_required_skills`、`quest_offer_cities`は
マスターから再構築可能な派生データである。

マスター取込トランザクション内で安全に再構築してよい。

## 9. マスター更新時に変更可能なテーブル

マスター取込処理が変更してよいテーブル:

- `quests`
- `discoveries`
- `discovery_categories`
- `quest_discoveries`
- `quest_dependencies`
- `quest_required_skills`
- `quest_offer_cities`
- `master_import_history`

マスター取込処理が変更してはならないテーブル:

- `profiles`
- `quest_progress`
- `discovery_progress`

## 10. `updated_at` の扱い

SQLiteのDEFAULTはINSERT時だけ適用される。

UPDATE時にはRepositoryまたはImport処理が明示的に以下相当の値を設定する。

```sql
strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
```

v1では自動更新トリガーを作成しない。

## 11. `raw_row_json`

`raw_row_json` は通常検索のための列ではない。

目的:

- 元ファイルの1行を後から確認できるようにする。
- 将来、未採用列を正式なDB列へ昇格する際の移行材料とする。
- インポート不具合調査を容易にする。

保存内容は、ヘッダー名をキー、デコード済み・未正規化のフィールド値を値とするJSONとする。

例:

```json
{
  "ID": "1234",
  "クエスト名・地図名": "例",
  "難易度": "5",
  "備考": "..."
}
```

表示用列で `<br>` 等を正規化しても、`raw_row_json` では原文を保持する。

## 12. migration方針

初期スキーマは `001_initial` 相当のmigrationで作成する。

以後:

- 過去migrationを書き換えない。
- 列追加・制約変更は新しいmigrationで行う。

## 13. 接続とactive database

active database pathとSQLx poolはRustの`ActiveDatabase`が一元管理する。各RepositoryはTypeScriptの`DatabaseClient` adapterを通じてRust commandへqueryを渡す。Importer、Progress Link、Backup、Restore、migration、facet backfillも同じactive databaseを使用する。

Default modeではactive databaseはTauri AppConfig directory直下の`dol-progress.db`である。pathの決定、pool lifecycle、maintenanceの詳細は`data-root.md`を正本とする。

Phase 13B-2ではbootstrap locatorがCustom rootを指す場合がある。bootstrapはSQLite schemaではなくAppConfigの小さなlocatorであり、application tableへ保存場所や履歴を追加しない。active pathは`DataRootResolver`だけが決定し、すべてのDB操作は`ActiveDatabase`のpoolを通す。
- ユーザーデータを保持したまま適用できる手順を優先する。
- 破壊的変更が避けられない場合は、先に仕様書へ移行方針を記載する。
