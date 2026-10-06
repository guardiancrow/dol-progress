pub(crate) const RELIC_CATEGORY_NAME: &str = "レリック";

pub(crate) fn can_report(category_name: Option<&str>) -> bool {
    category_name != Some(RELIC_CATEGORY_NAME)
}

pub(crate) fn has_card(category_name: Option<&str>) -> bool {
    category_name != Some(RELIC_CATEGORY_NAME)
}

#[cfg(test)]
mod tests {
    use super::{can_report, has_card, RELIC_CATEGORY_NAME};

    #[test]
    fn relic_is_the_only_category_without_report_or_card_capabilities() {
        assert!(!can_report(Some(RELIC_CATEGORY_NAME)));
        assert!(!has_card(Some(RELIC_CATEGORY_NAME)));
        assert!(can_report(Some("伝承")));
        assert!(has_card(Some("伝承")));
        assert!(can_report(None));
        assert!(has_card(None));
    }
}
