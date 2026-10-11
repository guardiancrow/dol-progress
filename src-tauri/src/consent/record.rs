use super::{CanonicalTerms, CANONICAL_VERSION};
use serde::{
    de::{self, MapAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::Value;
use std::{collections::BTreeMap, fmt};

pub const RECORD_SCHEMA_VERSION: u32 = 1;
pub(super) const MAX_RECORD_BYTES: usize = 4096;
const FIELDS: [&str; 5] = [
    "schemaVersion",
    "canonicalVersion",
    "termsVersion",
    "termsSha256",
    "state",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRecord {
    schema_version: u32,
    canonical_version: u32,
    terms_version: u32,
    terms_sha256: String,
    state: String,
}

impl ConsentRecord {
    pub(super) fn accepted(terms: &CanonicalTerms) -> Self {
        Self {
            schema_version: RECORD_SCHEMA_VERSION,
            canonical_version: CANONICAL_VERSION,
            terms_version: terms.version().get(),
            terms_sha256: terms.sha256().into(),
            state: "accepted".into(),
        }
    }

    pub fn terms_version(&self) -> u32 {
        self.terms_version
    }

    pub fn terms_sha256(&self) -> &str {
        &self.terms_sha256
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecordStatus {
    Missing,
    Accepted(ConsentRecord),
    Outdated { recorded_version: u32 },
    HashMismatch,
    InvalidState,
    FutureTerms { recorded_version: u32 },
    UnsupportedSchema { version: u32 },
    UnsupportedCanonical { version: u32 },
    Corrupt(RecordIssue),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecordIssue {
    Empty,
    TooLarge,
    InvalidUtf8,
    MalformedJson,
    MissingField,
    UnknownField,
    InvalidType,
    InvalidVersion,
    InvalidHash,
}

/// 読取り専用の判定。破損・未来版を補正又は保存しない。
pub fn parse_record(bytes: &[u8], current: &CanonicalTerms) -> RecordStatus {
    match parse_inner(bytes, current) {
        Ok(status) => status,
        Err(issue) => RecordStatus::Corrupt(issue),
    }
}

fn parse_inner(bytes: &[u8], current: &CanonicalTerms) -> Result<RecordStatus, RecordIssue> {
    if bytes.is_empty() {
        return Err(RecordIssue::Empty);
    }
    if bytes.len() > MAX_RECORD_BYTES {
        return Err(RecordIssue::TooLarge);
    }
    std::str::from_utf8(bytes).map_err(|_| RecordIssue::InvalidUtf8)?;
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let Envelope(fields) =
        Envelope::deserialize(&mut deserializer).map_err(|_| RecordIssue::MalformedJson)?;
    deserializer.end().map_err(|_| RecordIssue::MalformedJson)?;
    let schema = integer(&fields, "schemaVersion")?;
    if schema != RECORD_SCHEMA_VERSION {
        return Ok(RecordStatus::UnsupportedSchema { version: schema });
    }
    let canonical = integer(&fields, "canonicalVersion")?;
    if canonical != CANONICAL_VERSION {
        return Ok(RecordStatus::UnsupportedCanonical { version: canonical });
    }
    if fields.keys().any(|name| !FIELDS.contains(&name.as_str())) {
        return Err(RecordIssue::UnknownField);
    }
    if FIELDS.iter().any(|name| !fields.contains_key(*name)) {
        return Err(RecordIssue::MissingField);
    }
    let version = integer(&fields, "termsVersion")?;
    if version == 0 {
        return Err(RecordIssue::InvalidVersion);
    }
    let hash = fields["termsSha256"]
        .as_str()
        .ok_or(RecordIssue::InvalidType)?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(RecordIssue::InvalidHash);
    }
    let state = fields["state"].as_str().ok_or(RecordIssue::InvalidType)?;
    if state != "accepted" {
        return Ok(RecordStatus::InvalidState);
    }
    if version > current.version().get() {
        return Ok(RecordStatus::FutureTerms {
            recorded_version: version,
        });
    }
    if version < current.version().get() {
        return Ok(RecordStatus::Outdated {
            recorded_version: version,
        });
    }
    if hash != current.sha256() {
        return Ok(RecordStatus::HashMismatch);
    }
    Ok(RecordStatus::Accepted(ConsentRecord::accepted(current)))
}

fn integer(fields: &BTreeMap<String, Value>, name: &str) -> Result<u32, RecordIssue> {
    let value = fields.get(name).ok_or(RecordIssue::MissingField)?;
    let integer = value.as_u64().ok_or(RecordIssue::InvalidType)?;
    u32::try_from(integer).map_err(|_| RecordIssue::InvalidVersion)
}

// Value単独でparseすると同名keyが上書きされるため、envelope段階で拒否する。
struct Envelope(BTreeMap<String, Value>);

impl<'de> Deserialize<'de> for Envelope {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = Envelope;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("同意記録のJSON object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Envelope, A::Error> {
                let mut fields = BTreeMap::new();
                while let Some(name) = map.next_key::<String>()? {
                    if fields.contains_key(&name) {
                        return Err(de::Error::custom("同意記録のkeyが重複しています"));
                    }
                    fields.insert(name, map.next_value()?);
                }
                Ok(Envelope(fields))
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}
