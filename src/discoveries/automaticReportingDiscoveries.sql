SELECT qd.discovery_id
FROM quest_discoveries qd
JOIN quests q ON q.id = qd.quest_id AND q.is_active = 1
JOIN discoveries d ON d.id = qd.discovery_id
LEFT JOIN discovery_categories c ON c.id = d.category_id
WHERE c.name IS NOT 'レリック'
GROUP BY qd.discovery_id
HAVING COUNT(*) = 1 AND MAX(q.id IN (__SPECIAL_REPORTING_QUESTS__)) = 1
