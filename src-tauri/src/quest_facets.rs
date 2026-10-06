use sqlx::{Connection, Row, SqliteConnection, SqlitePool, Transaction};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RequiredSkill {
    pub position: i64,
    pub skill_name: String,
    pub required_rank: Option<i64>,
    pub is_language: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OfferCity {
    pub position: i64,
    pub city_name: String,
}

pub(crate) fn parse_required_skills(value: Option<&str>) -> Vec<RequiredSkill> {
    value
        .unwrap_or_default()
        .split(',')
        .enumerate()
        .filter_map(|(position, token)| {
            let token = token.trim();
            if token.is_empty() {
                return None;
            }
            let (skill_name, suffix_rank) = terminal_positive_rank(token).map_or_else(
                || (token.to_owned(), None),
                |(name, rank)| (name, Some(rank)),
            );
            let is_language = skill_name.ends_with('語');
            Some(RequiredSkill {
                position: position as i64,
                skill_name,
                required_rank: if is_language { None } else { suffix_rank },
                is_language,
            })
        })
        .collect()
}

pub(crate) fn parse_offer_cities(value: Option<&str>) -> Vec<OfferCity> {
    value
        .unwrap_or_default()
        .split(',')
        .enumerate()
        .filter_map(|(position, token)| {
            let city_name = token.trim();
            (!city_name.is_empty()).then(|| OfferCity {
                position: position as i64,
                city_name: city_name.to_owned(),
            })
        })
        .collect()
}

fn terminal_positive_rank(token: &str) -> Option<(String, i64)> {
    let body = token.strip_suffix(')')?;
    let open = body.rfind('(')?;
    let name = body[..open].trim();
    let digits = &body[open + 1..];
    if name.is_empty() || digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let rank = digits.parse::<i64>().ok()?;
    (rank > 0).then(|| (name.to_owned(), rank))
}

pub(crate) async fn replace_for_quest(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    quest_id: i64,
    required_skills: Option<&str>,
    offer_cities: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM quest_required_skills WHERE quest_id = ?")
        .bind(quest_id)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("DELETE FROM quest_offer_cities WHERE quest_id = ?")
        .bind(quest_id)
        .execute(&mut **transaction)
        .await?;

    for skill in parse_required_skills(required_skills) {
        sqlx::query(
            "INSERT INTO quest_required_skills \
             (quest_id, position, skill_name, required_rank, is_language) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(quest_id)
        .bind(skill.position)
        .bind(skill.skill_name)
        .bind(skill.required_rank)
        .bind(i64::from(skill.is_language))
        .execute(&mut **transaction)
        .await?;
    }
    for city in parse_offer_cities(offer_cities) {
        sqlx::query(
            "INSERT INTO quest_offer_cities (quest_id, position, city_name) VALUES (?, ?, ?)",
        )
        .bind(quest_id)
        .bind(city.position)
        .bind(city.city_name)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

pub(crate) async fn backfill_connection(
    connection: &mut SqliteConnection,
) -> Result<bool, sqlx::Error> {
    let needs_backfill: i64 = sqlx::query_scalar(
        r#"SELECT EXISTS(
             SELECT 1 FROM quests q
              WHERE (trim(COALESCE(q.required_skills, '')) <> ''
                     AND NOT EXISTS (SELECT 1 FROM quest_required_skills s WHERE s.quest_id = q.id))
                 OR (trim(COALESCE(q.offer_city, '')) <> ''
                     AND NOT EXISTS (SELECT 1 FROM quest_offer_cities c WHERE c.quest_id = q.id))
           )"#,
    )
    .fetch_one(&mut *connection)
    .await?;
    if needs_backfill == 0 {
        return Ok(false);
    }

    let mut transaction = connection.begin().await?;
    let rows = sqlx::query("SELECT id, required_skills, offer_city FROM quests ORDER BY id")
        .fetch_all(&mut *transaction)
        .await?;
    for row in rows {
        replace_for_quest(
            &mut transaction,
            row.get("id"),
            row.get::<Option<String>, _>("required_skills").as_deref(),
            row.get::<Option<String>, _>("offer_city").as_deref(),
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(true)
}

pub(crate) async fn backfill_pool(pool: &SqlitePool) -> Result<bool, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    backfill_connection(&mut connection)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations::{INITIAL_SCHEMA, QUEST_FACETS_SCHEMA};

    #[test]
    fn normalizes_ranked_language_and_rankless_skills_in_source_order() {
        assert_eq!(
            parse_required_skills(Some(" 探索(7) , 財宝鑑定(9) , ドイツ語 ")),
            vec![
                RequiredSkill {
                    position: 0,
                    skill_name: "探索".into(),
                    required_rank: Some(7),
                    is_language: false
                },
                RequiredSkill {
                    position: 1,
                    skill_name: "財宝鑑定".into(),
                    required_rank: Some(9),
                    is_language: false
                },
                RequiredSkill {
                    position: 2,
                    skill_name: "ドイツ語".into(),
                    required_rank: None,
                    is_language: true
                },
            ]
        );
        for value in [
            "ギリシャ語",
            "ギリシャ語(1)",
            "ギリシャ語(2)",
            "日本語(5)",
            "マラユ・タガログ語(7)",
        ] {
            let skill = &parse_required_skills(Some(value))[0];
            assert!(skill.is_language, "{value}");
            assert_eq!(skill.required_rank, None, "{value}");
        }
        for value in ["サルベージ", "開錠", "視認", "釣り", "天文学"] {
            let skill = &parse_required_skills(Some(value))[0];
            assert!(!skill.is_language, "{value}");
            assert_eq!(skill.required_rank, None, "{value}");
        }
    }

    #[test]
    fn supports_future_ranks_empty_values_and_terminal_suffix_only() {
        assert_eq!(parse_required_skills(None), Vec::new());
        assert_eq!(parse_required_skills(Some(" , ")), Vec::new());
        assert_eq!(
            parse_required_skills(Some("探索(21)"))[0].required_rank,
            Some(21)
        );
        assert_eq!(
            parse_required_skills(Some("探索(100)"))[0].required_rank,
            Some(100)
        );
        assert_eq!(
            parse_required_skills(Some("技能(仮)(7)"))[0].skill_name,
            "技能(仮)"
        );
        assert_eq!(
            parse_required_skills(Some("探索(7)補足"))[0].required_rank,
            None
        );
        assert_eq!(
            parse_required_skills(Some("探索(0)"))[0].required_rank,
            None
        );
    }

    #[test]
    fn parses_offer_cities_with_trim_empty_filtering_and_source_positions() {
        assert_eq!(
            parse_offer_cities(Some(" アテネ,アレクサンドリア, ,イスタンブール,チュニス ")),
            vec![
                OfferCity {
                    position: 0,
                    city_name: "アテネ".into()
                },
                OfferCity {
                    position: 1,
                    city_name: "アレクサンドリア".into()
                },
                OfferCity {
                    position: 3,
                    city_name: "イスタンブール".into()
                },
                OfferCity {
                    position: 4,
                    city_name: "チュニス".into()
                },
            ]
        );
        assert_eq!(
            parse_offer_cities(Some("リスボン"))[0].city_name,
            "リスボン"
        );
        assert!(parse_offer_cities(None).is_empty());
    }

    #[tokio::test]
    async fn backfills_a_phase_10_database_atomically_and_idempotently() {
        let mut database = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(INITIAL_SCHEMA)
            .execute(&mut database)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles (id, name) VALUES (1, 'Profile A')")
            .execute(&mut database)
            .await
            .unwrap();
        sqlx::query("INSERT INTO quests (id, gvdb_id, title, offer_city, required_skills, raw_row_json) VALUES (1, 100, 'テスト依頼A', 'アテネ,チュニス', '探索(2),ギリシャ語(2),サルベージ', '{}')")
            .execute(&mut database).await.unwrap();
        sqlx::query("INSERT INTO discoveries (id, gvdb_id, name, raw_row_json) VALUES (1, 1, '発見物', '{}')")
            .execute(&mut database).await.unwrap();
        sqlx::query(
            "INSERT INTO quest_progress (profile_id, quest_id, memo) VALUES (1, 1, 'quest memo')",
        )
        .execute(&mut database)
        .await
        .unwrap();
        sqlx::query("INSERT INTO discovery_progress (profile_id, discovery_id, reported, card_owned, memo) VALUES (1, 1, 1, 0, 'discovery memo')")
            .execute(&mut database).await.unwrap();
        sqlx::query("INSERT INTO master_import_history (dataset, file_name, file_sha256, row_count) VALUES ('quests', 'quests.csv', 'phase10-hash', 1)")
            .execute(&mut database).await.unwrap();
        sqlx::raw_sql(QUEST_FACETS_SCHEMA)
            .execute(&mut database)
            .await
            .unwrap();

        assert!(backfill_connection(&mut database).await.unwrap());
        assert!(!backfill_connection(&mut database).await.unwrap());
        let skills: Vec<(i64, String, Option<i64>, i64)> = sqlx::query_as(
            "SELECT position, skill_name, required_rank, is_language FROM quest_required_skills ORDER BY position",
        ).fetch_all(&mut database).await.unwrap();
        assert_eq!(
            skills,
            vec![
                (0, "探索".into(), Some(2), 0),
                (1, "ギリシャ語".into(), None, 1),
                (2, "サルベージ".into(), None, 0),
            ]
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM quest_offer_cities")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM master_import_history")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT name FROM profiles WHERE id = 1")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            "Profile A"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT memo FROM quest_progress")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            "quest memo"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT memo FROM discovery_progress")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            "discovery memo"
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("PRAGMA quick_check")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            "ok"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM pragma_foreign_key_check")
                .fetch_one(&mut database)
                .await
                .unwrap(),
            0
        );
    }
}
