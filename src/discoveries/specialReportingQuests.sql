SELECT id FROM quests
WHERE offer_method COLLATE BINARY IN ('追究クエスト', 'レガシー', 'トレジャーハント')
