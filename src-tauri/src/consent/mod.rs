//! 同意記録と承認済み本文による初回起動確認。
//!
//! 保存APIの呼出し元が明示同意を確認する。記録の整合性は本人性を証明しない。

pub(crate) mod first_run;
pub mod gate;
#[cfg(feature = "consent-gate-harness")]
pub mod harness;
pub mod native_ui;
mod record;
mod storage;
mod terms;

pub use record::{parse_record, ConsentRecord, RecordIssue, RecordStatus, RECORD_SCHEMA_VERSION};
pub use storage::{
    CommitState, ConsentLease, ConsentStore, SaveStage, StorageError, StorageErrorKind,
};
pub use terms::{CanonicalError, CanonicalTerms, TermsVersion, CANONICAL_VERSION};

#[cfg(test)]
mod tests;
