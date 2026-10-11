//! 隔離統合用gate。通常run、PortablePaths、Tauri、DBを呼ばない。
use super::{
    native_ui::{ConsentDecision, DeclineReason, NativeUiError},
    CanonicalTerms, ConsentLease, ConsentRecord, ConsentStore, RecordStatus, SaveStage,
    StorageError,
};
use std::io;

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PassBasis {
    ExistingRecord,
    SavedAcceptance,
    ConcurrentAcceptance,
}

#[derive(Debug)]
pub enum GateStop {
    Declined(DeclineReason),
    Ui(NativeUiError),
    IdentityMismatch,
    Record(RecordStatus),
    Storage(StorageError),
}

/// 後続の失敗は同意処理の停止と区別する。StartedでもresultがErrの場合がある。
#[derive(Debug)]
pub enum GateOutcome<T, E> {
    Started {
        basis: PassBasis,
        result: Result<T, E>,
    },
    Stopped(GateStop),
}

// 外部から構築できず、leaseを含む一回限りの内部許可。
struct Permit {
    basis: PassBasis,
    lease: ConsentLease,
}
impl Permit {
    fn start<T, E>(self, next: impl FnOnce(&ConsentRecord) -> Result<T, E>) -> GateOutcome<T, E> {
        let result = next(self.lease.record());
        // callbackの成功・失敗までlockを保持。panic時もunwindで解放する。
        drop(self.lease);
        GateOutcome::Started {
            basis: self.basis,
            result,
        }
    }
}

/// UIと後続処理を明示注入するblocking API。実アプリの起動へは未接続。
/// callbackは同期critical sectionであり、非同期処理を開始しただけで戻ってはならない。
pub fn run<T, E>(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
    next: impl FnOnce(&ConsentRecord) -> Result<T, E>,
) -> GateOutcome<T, E> {
    run_with(terms, store, ui, next, |_| Ok(()))
}

fn run_with<T, E>(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
    next: impl FnOnce(&ConsentRecord) -> Result<T, E>,
    before: impl FnMut(SaveStage) -> io::Result<()>,
) -> GateOutcome<T, E> {
    match authorize(terms, store, ui, before) {
        Ok(permit) => permit.start(next),
        Err(stop) => GateOutcome::Stopped(stop),
    }
}

fn authorize(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
    before: impl FnMut(SaveStage) -> io::Result<()>,
) -> Result<Permit, GateStop> {
    let (status, snapshot) = store.snapshot(terms).map_err(GateStop::Storage)?;
    match status {
        RecordStatus::Accepted(_) => {
            let lease = store
                .lock_verified_record(terms)
                .map_err(GateStop::Storage)?;
            return Ok(Permit {
                basis: PassBasis::ExistingRecord,
                lease,
            });
        }
        RecordStatus::Missing | RecordStatus::Outdated { .. } | RecordStatus::HashMismatch => {}
        status => return Err(GateStop::Record(status)),
    }
    match ui(terms).map_err(GateStop::Ui)? {
        ConsentDecision::Declined(reason) => return Err(GateStop::Declined(reason)),
        ConsentDecision::Accepted(identity) if !identity.matches(terms) => {
            return Err(GateStop::IdentityMismatch);
        }
        ConsentDecision::Accepted(_) => {}
    }
    let lease = store
        .save_checked(terms, Some(&snapshot), before)
        .map_err(GateStop::Storage)?;
    let basis = if lease.was_written() {
        PassBasis::SavedAcceptance
    } else {
        PassBasis::ConcurrentAcceptance
    };
    Ok(Permit { basis, lease })
}
