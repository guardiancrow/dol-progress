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
| `discovery_reporting_history` | ユーザー | 初回報告確認と旧勲功値の引継ぎ資格 |
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

上記は保存状態を示す。表示・集計には以下の有効な報告状態を使用する。

ただし、`discovery_categories.name = 'レリック'`の発見物では報告は対象外である。行の存在が発見済みかつ最終状態を表し、`reported`のbool値は進捗の意味を持たない。

特殊クエストでは、保存済みの`reported`と表示・集計用の有効な報告状態を区別する。非レリックのactiveな関連Questが唯一で、その`offer_method`が`追究クエスト`、`レガシー`、`トレジャーハント`に完全一致する場合、発見済みなら有効な報告状態を報告済みとする。それ以外は保存値を使用する。複数関連から登録経路を推定しない。発見物自身が非activeでも同じ判定を適用する。

新規進捗を連動登録するときは、確定したQuestが特殊Questで非レリックの場合に`reported = 1`を保存する。複数関連でQuest未選択の場合は0とする。既存行やマスター変更時のユーザーデータは更新しない。唯一のactive関連Questによる自動報告対象の手動報告変更はRust側で拒否する。カード所有は独立したままとする。

登録経路の永続列・migrationは追加しない。詳細な表示規則・既知の制限は`requirements.md`の「特殊クエストの自動報告」に従う。

### 4.2.1 冒険勲功値

冒険勲功値はプロフィール別に、初回報告確認済み、旧参考値の引継ぎ資格あり、現在発見済みかつ特殊自動報告対象、の発見物IDの和集合から算出する。同じ発見物は一度だけ数え、レリックを除外し、非active発見物も含める。経験値NULLは合計に加えず、不明件数に含める。現在の未報告・報告済み件数は従来の有効報告状態で集計する。
勲功値そのものの永続列・集計テーブルは持たない。UIの見出しは「冒険勲功値」とし、判明している経験値だけを使った参考値であることをカード内で説明する。爵位thresholdおよび爵位判定は保持・算出しない。

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
| `reported` | INTEGER | NO | 現在の0=未報告、1=報告済み |
| `report_hold` | INTEGER | NO | 0=維持意思なし、1=意図的な未報告維持 |
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

新規DBではmigration 001から004を順に適用し、本節と等価なスキーマを作成する。既存DBには
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
    report_hold   INTEGER NOT NULL DEFAULT 0
                  CHECK (report_hold IN (0, 1) AND (report_hold = 0 OR reported = 0)),
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

CREATE TABLE discovery_reporting_history (
    profile_id INTEGER NOT NULL,
    discovery_id INTEGER NOT NULL,
    first_report_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (first_report_status IN ('unknown', 'not_reported', 'confirmed')),
    legacy_merit_credit INTEGER NOT NULL DEFAULT 0 CHECK (legacy_merit_credit IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (profile_id, discovery_id),
    CHECK (legacy_merit_credit = 0 OR first_report_status = 'unknown'),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (discovery_id) REFERENCES discoveries(id) ON UPDATE CASCADE ON DELETE RESTRICT
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

Default modeではactive databaseは`<exe-dir>/data/dol-progress.db`である。Rustの`PortablePaths`が実行ファイルpathから標準data rootとconfig rootを分離して解決する。CWD、旧AppConfig、Frontendをpath決定に使用しない。pathの決定、pool lifecycle、maintenanceの詳細は`data-root.md`を正本とする。

bootstrap locatorが外部Custom rootを指す場合がある。bootstrapはSQLite schemaではなく`<exe-dir>/config`の小さなv1 locatorであり、application tableへ保存場所や履歴を追加しない。Default locatorには絶対pathを保存しない。active pathは`DataRootResolver`だけが決定し、すべてのDB操作は`ActiveDatabase`のpoolを通す。Phase 23D-B1のDB location変更はfilesystem上の変更で、migration 001〜003、checksum、backupのschema互換規則を変更しない。
- ユーザーデータを保持したまま適用できる手順を優先する。
- 破壊的変更が避けられない場合は、先に仕様書へ移行方針を記載する。

## 14. Map-C1：004による互換移行

004は維持列（既定0）と`discovery_reporting_history`を追加する。旧業務列・行・メモ・更新日時は変更しない。履歴のPKは`(profile_id, discovery_id)`で、現在進捗とは独立する。プロフィール削除はCASCADE、発見物マスター削除はRESTRICT。非active化・マスターimportでは変更しない。

`first_report_status`は`unknown`／`not_reported`／`confirmed`。行なしはunknown・資格なしと同義。`legacy_merit_credit`は0/1で、1ならunknownに限定する。004時点の旧算入対象（非レリック、進捗あり、保存reported=1または唯一のactive特殊Questから自動報告）をunknown・資格1で保存する。非active・経験値NULLも含め、実報告履歴を推定しない。抽出SQLは004内に固定する。

現在進捗の取り消し・再発見で確認済み履歴と引継ぎ資格は失われない。明示報告確認時はconfirmed・資格0へ整理する。履歴をunknownへ戻すだけでは資格を解除せず、誤算入の明示訂正で解除する。特殊自動報告による現在の算入資格は別に評価する。将来の経験値・レリック分類変更は再計算へ反映する。

C1はschemaと集計、C2は共通domain commandを実装する。C3で既存一覧へ地図UIを追加し、本番backupコピーの検証はC4で行う。001〜004のschemaとchecksumはC2では変更しない。

## 15. Map-C2：状態更新APIとtransaction

Rustのdiscovery_stateが報告・維持・履歴訂正・現在進捗削除を管理し、progress_linkから同じ新規発見初期化を呼び出す。クエスト一覧と発見物一覧で報告履歴を別更新しない。

- get_discovery_state：profileId・discoveryIdを指定し、読取transactionで確定したsnapshotを返す。
- update_discovery_state：expected（直前のsnapshot）、sourceMapId（任意）、operationを受け取り、更新後のsnapshotを返す。
- remove_discovery_progress：既存UI用の現在進捗削除。履歴は削除しない。
- 既存set_discovery_reported：trueは報告確認、falseは履歴を保持する再発見の互換操作。現在未報告ならfalse再送は維持意思も含めて無変更。

snapshotはプロフィール・発見物ID、現在進捗（報告・維持・カード・メモ・更新日時）、履歴（status・legacy資格・更新日時）、発見物のactive・分類・マスター更新日時、自動報告判定、関連QuestのID・active・オファー方法・更新日時・関連発見物数を含む。null履歴はunknown・資格なしと同義だが、競合比較では実行行の有無も比較する。

| operation.kind | 引数 | 保存規則 |
|---|---|---|
| register | state、selectedQuestId | 現在行なし・activeが条件。未発見への登録は拒否。連動と指定状態を同一transactionで保存 |
| report | なし | reported=1・hold=0を同時更新し、履歴confirmed・legacy=0 |
| rediscover | hold | 現在報告済みが条件。reported=0・指定hold。履歴保持 |
| setHold | value | trueは手動報告可能かつ現在未報告。falseは維持意思だけ解除 |
| correctHistory | status、removeLegacyCredit、currentState | 履歴を明示訂正。currentState指定で既存現在状態も同時訂正。未発見からの新規作成はしない |
| removeCurrent | なし | 現在行だけ削除。既に行がなければ無変更 |

state/currentStateはundiscovered・unreported・reported・reportHold。statusはunknown・not_reported・confirmed。currentState=reportedを同時指定する場合はstatus=confirmedが必要。confirmedの明示確認では現在進捗行がなくても履歴を保存できる。レリックの履歴訂正は対象外。

書き込みはBEGIN IMMEDIATEでwriter lockを取得してから検証する。新APIはsnapshot全体を再読込してexpectedと比較し、不一致またはSQLITE_BUSY/LOCKEDではDiscoveryStateConflictを返す。呼出側は再取得を要求し、古いexpectedの自動再送はしない。sourceMapId指定時は地図分類・active・関連と単一発見物を検証する。新規発見のselectedQuestIdはsourceMapIdと一致させる。

既存のsnapshotを受け取らない互換commandはwriter lock内で実行時の状態を検証し、履歴を失わない規則を適用する。過去の画面読取時点との差を検出する用途には新APIを使う。既存のカード・メモ操作が同時に行われた場合も、新APIのsnapshot比較で検出する。

報告・現在進捗・履歴・正方向連動は一つのtransactionでcommitする。報告履歴書込み失敗、連動先登録失敗、訂正後の整合性違反では全rollbackする。現在状態だけの操作は履歴の更新日時を変えず、既存進捗への新規登録再送は何も上書きしない。

## 16. Map-C3の一覧読取り

discovery_stateの更新APIとschemaを変更せず、TypeScriptのDiscoveryStateReaderでプロフィール単位の一括SELECTを行う。発見物に現在進捗・報告履歴をLEFT JOINし、active・分類・経験値・マスター更新日時・現在報告／維持・進捗更新日時・履歴／legacy資格／更新日時・現行自動報告判定を返す。進捗行なしと履歴unknownを区別し、関連なしや非activeも判定用に保持する。地図ごとの個別queryは実行しない。

操作前の単件snapshotと一覧値を照合し、更新はsnapshot付きAPIへ渡す。一覧再取得はプロフィール世代と読取要求順で古い結果を破棄する。マスター更新で関連数が変わった場合はRustで再検証し、UIは最新マスターと進捗を再取得する。001〜004・checksum・既存の集計SQLは変更しない。

### 16.1 Map-C3R-Iの表示と地図関連判定

report_holdは保存・snapshot照合を継続するが、通常の表示状態や再入手判定には使用しない。既存値は一括更新しない。現在未報告の再選択は無操作とし、維持意思を解除するSetHold(false)へ変換しない。3状態UIは現在進捗の操作だけをC2へ送る。

一覧読取は同じ一括SELECT内で、activeな既存7分類地図との関連有無と、その地図が複数発見物に関連するかを導出する。関連はquest_discoveriesの数値IDで解決し、地図名や書庫の推定では分類しない。対象の複数関連・報告対象外はUIで要確認とする。新規テーブル・列・migrationは追加しない。

勲功値の訂正プレビューはC1と同じ算入条件で、confirmed・legacy資格・現在自動報告の和集合を発見物ごとに一度だけ数える。非activeも含み、レリックは除外する。経験値NULLは未知件数として表示し、訂正後の対象資格との差分を参考値へ反映する。実際の保存はC2の検証・transactionに従う。

Map-C3R-FINALでは通常UIの履歴訂正入口・対象選択画面を撤去した。上記の訂正処理は内部機能として保持し、通常の発見・報告操作から履歴の明示訂正を実行しない。schema・履歴データ・Rust訂正API・勲功値算入条件は変更しない。

### 16.2 地図関連一括読取と更新待ちの防止

地図関連・複数関連の判定は、`discoveryStateSummaries.sql`のmap_relationsで発見物IDごとに先に集計し、発見物一覧へLEFT JOINする。発見物ごとの相関EXISTSでactiveクエスト集合を繰り返し検索しない。通常アプリのbusy timeout、接続数、transaction方式は変更しない。

実装検証は6,784クエスト・4,032発見物の合成DBで行う。Node SQLiteで実際のReader SQL、同梱SQLite/SQLxで同じSQLとファイルDB上の並行更新を検証する。旧相関SQLが保持する読取lockによるwriter失敗と、修正SQLの読取・更新完了を比較する。本番DBは検証に使用しない。

### 16.3 Map-C5の発見物単位操作

発見物一覧の地図状態selectは、同じDiscoveryStateControl/useReportHoldとsnapshot付きAPIを再利用する。sourceMapIdと新規登録のselectedQuestIdはnullとし、対象はプロフィール＋発見物IDである。複数関連地図の一括操作ではなく、他の発見物進捗は変更しない。新規発見時の正方向連動は既存のdiscover_transactionに従う。

一覧表示は既存一括SQLのmapRelatedを使い、操作直前は既存のget_discovery_stateが返すrelatedQuestsのactive/offerMethodも確認する。保存時の関連変更は既存Rust側のsnapshot比較で拒否する。新しい保存値・SQL・migration・履歴計算は追加しない。

### 16.4 履歴引継ぎと通常移行の区別

通常004は旧算入資格をunknown＋legacyで保全し、現在reportedだけから初回履歴を確定しない。
個別に根拠が確定した履歴引継ぎは一般機能・必須migrationではなく、公開版に実DB用の実行入口はない。
[合成検証](map-history-handover.md)では、既存CHECK、業務列・timestamp、勲功値と資格ID集合、期待値検証、transactionとrollbackを確認する。
履歴の通常保存・訂正API、001〜004のbytes・checksumは変更しない。

### Map-C5R-U1：履歴参照と概要内訳

表示専用の初回報告履歴は既存の一括state summaryのfirstReportStatus・historyUpdatedAt・legacyMeritCreditを参照する。historyUpdatedAtがNULLなら履歴行なしとして説明し、unknownと同様に「不明」を表示する。現在進捗行の存在とは独立する。プロフィール切り替え時は取得元プロフィールが一致する結果だけを公開する。

概要の既存発見物集計に、discovery_reporting_historyを(profile_id, discovery_id)主キーでLEFT JOINする。同じ現在未報告対象を3区分へ集約する。履歴行なしはunknownへ分類する。集計呼出しは既存の3 SELECTのまま増やさず、勲功値SQL・migration・履歴更新契約は変更しない。H2修復を未適用のDBも通常どおり扱う。

### Map-C5R-U2：履歴表示の補完範囲

U1の独立履歴取得と概要集計は変更しない。通常発見物の現在有効報告済みは、unknown・履歴未登録の場合に限り一覧表示の補完根拠とする。DBのfirst_report_status・legacy_merit_creditへ書き戻さない。自動報告の導出状態はこの根拠に使用しない。not_reportedと通常の現在報告済みの矛盾は要確認として表示する。現在未報告の内訳は引き続き履歴だけで分類するため、補完対象との重複はない。

### Map-C5R-U3：通常履歴訂正UIと既存API

発見物一覧の初回報告欄から、保持していたcorrectHistory APIへの入口を再提供する。DB schemaと通常進捗更新は変更しない。取得snapshot（profile・discovery・進捗・履歴・マスター）の照合とC2のBEGIN IMMEDIATE transactionをそのまま使用する。checkboxの希望値はフォームの初期選択にだけ使用し、保存結果が確定するまで一覧の値を変えない。

通常の現在報告済みを初回報告前へ訂正する場合、currentState=nullは拒否する既存契約を利用し、UIでも保存前に拒否する。必要ならcurrentState=unreportedまたはundiscoveredと履歴を同時訂正する。途中失敗時には進捗・履歴の双方をrollbackする。confirmed／not_reportedへ明示訂正するとlegacy資格は0になる。unknownへ戻すだけでは旧資格を保持し、旧資格だけの解除には明示指定が必要である。

自動報告の導出は独立履歴を確定する証拠にしない。今回のUIは通常対象だけ編集可能にし、自動対象の既存履歴と特殊例外を変更しない。レリックの履歴訂正拒否、現在進捗削除時の履歴保持、通常報告時のconfirmed記録も従来どおりとする。H1/H2の一度きりの修復を通常アプリで再実行しない。

### Map-C5R-S：履歴操作のUI範囲と保存（旧仕様）

この節はUI-R2B以前の地図限定UIを記録する。現在の対象条件は次節「UI-R2B：通常発見物の履歴操作」に従う。

履歴の保存・集計契約は全発見物について維持する。制限するのは通常UIの入口だけで、mapRelatedかつ非レリック・非自動報告の対象から利用する。historyを開く際には現在のactiveな地図関連をsnapshotで再確認する。sourceMapId=nullの発見物単位更新により、複数の地図が同じ発見物を参照しても履歴を二重管理しない。

確認画面の確定値confirmed／not_reportedを既存correctHistoryへ渡す。初回報告前と現在報告済みの矛盾には、currentState=unreportedまたはundiscoveredを明示指定する。それ以外はcurrentState=nullで現在進捗を保持する。not_reportedへの訂正はlegacy資格も解除する従来規則を使い、影響を確認画面で示す。unknownやlegacyだけの訂正APIを削除・限定しない。

概要の内訳は表示だけ撤去する。既存の一括読取SQL・集計API・算入条件・migration001〜004は変更せず、履歴情報と既存の集計結果を保持する。

### UI-R2B：通常発見物の履歴操作

履歴の保存・集計契約は変更せず、通常一覧の確認・訂正操作を非地図の通常発見物へ広げる。summaryと最新snapshotのactive・分類・自動報告判定を照合し、active・非レリック・非自動報告の場合だけ編集できる。プロフィールと発見物IDも確認する。地図関連の有無が一致しない場合は再取得し、地図行ではactiveな対象地図との関連確認を維持する。非地図行では関連を必須としない。

sourceMapId=nullの既存correctHistoryを使用する。unknown・履歴行なしからは未選択のフォームでconfirmed／not_reportedを明示選択し、現在状態から履歴を書き戻さない。confirmed／not_reportedへの訂正でlegacy資格を解除し、unknownへの戻しだけでは既存legacy資格を保持する内部APIの規則は維持する。通常UIではunknownへの戻しやlegacy資格だけの訂正を新設しない。

現在報告済みとnot_reportedの矛盾拒否、currentStateを伴う同一transactionの訂正、snapshot全体の楽観的競合検出とrollbackを再利用する。履歴だけの訂正では現在進捗・カード・メモ・クエスト達成を保持する。現在進捗削除の履歴保持、特殊自動報告とレリックの既存契約も維持する。Rust API・一括読取SQL・集計SQL・DB schema・migrationは変更しない。既存履歴の自動修復や一括変換は行わない。
