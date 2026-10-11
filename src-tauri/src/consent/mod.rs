//! 同意記録の独立基盤。通常起動・UI・DBへは接続しない。
//!
//! 保存APIの呼出し元が明示同意を確認する。記録の整合性は本人性を証明しない。

pub mod gate;
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
