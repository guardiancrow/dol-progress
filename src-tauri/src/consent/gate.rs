//! 隔離統合用gate。通常run、PortablePaths、Tauri、DBを呼ばない。
use super::{
    native_ui::{ConsentDecision, DeclineReason, NativeUiError},
    CanonicalTerms, ConsentLease, ConsentRecord, ConsentStore, RecordStatus, SaveStage,
    StorageError,
};
use std::{
    io,
    path::{Path, PathBuf},
};

#[cfg(test)]
mod tests;

#[cfg(test)]
mod owned_tests;

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
#[must_use = "起動側へ移譲するか、Dropしてleaseを解放する"]
pub(crate) struct OwnedPermit {
    basis: PassBasis,
    consent_root: PathBuf,
    terms: CanonicalTerms,
    lease: ConsentLease,
}
impl OwnedPermit {
    pub(crate) fn consent_root(&self) -> &Path {
        &self.consent_root
    }

    pub(crate) fn terms(&self) -> &CanonicalTerms {
        &self.terms
    }

    /// 検証したroot・条件に限って移譲する。不一致時もselfを消費して解放する。
    pub(crate) fn into_startup(
        self,
        root: &Path,
        terms: &CanonicalTerms,
    ) -> Result<StartupGuard, PermitBindingError> {
        if self.consent_root() != root {
            return Err(PermitBindingError::RootMismatch);
        }
        if self.terms() != terms {
            return Err(PermitBindingError::TermsMismatch);
        }
        Ok(StartupGuard { permit: self })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PermitBindingError {
    RootMismatch,
    TermsMismatch,
}

/// setup相当の完了まで所有する。実Tauriへは未接続。
#[must_use = "setup完了時にfinishするか、エラー時にDropする"]
pub(crate) struct StartupGuard {
    permit: OwnedPermit,
}
impl StartupGuard {
    pub(crate) fn basis(&self) -> PassBasis {
        self.permit.basis
    }

    pub(crate) fn record(&self) -> &ConsentRecord {
        self.permit.lease.record()
    }

    /// handleのRAII解放だけを行う。保存・durability確認のAPIではない。
    pub(crate) fn finish(self) {
        drop(self);
    }
}

/// 検証・保存・排他再検証の共通経路。正式本文の承認や本番接続を意味しない。
pub(crate) fn authorize_for_startup(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
) -> Result<OwnedPermit, GateStop> {
    authorize(terms, store, ui, |_| Ok(()))
}

fn start<T, E>(
    permit: OwnedPermit,
    terms: &CanonicalTerms,
    store: &ConsentStore,
    next: impl FnOnce(&ConsentRecord) -> Result<T, E>,
) -> GateOutcome<T, E> {
    let guard = match permit.into_startup(store.portable_root(), terms) {
        Ok(guard) => guard,
        // 共通authorizeが同じstore・termsから構築するため、通常は到達しない。
        Err(_) => return GateOutcome::Stopped(GateStop::IdentityMismatch),
    };
    let basis = guard.basis();
    let result = next(guard.record());
    // callbackの成功・失敗まで保持。panic時もunwindで解放する。
    guard.finish();
    GateOutcome::Started { basis, result }
}

/// UIと後続処理を明示注入するblocking API。実アプリの起動へは未接続。
/// callbackは同期critical sectionであり、非同期処理を開始しただけで戻ってはならない。
pub fn run<T, E>(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
    next: impl FnOnce(&ConsentRecord) -> Result<T, E>,
) -> GateOutcome<T, E> {
    match authorize_for_startup(terms, store, ui) {
        Ok(permit) => start(permit, terms, store, next),
        Err(stop) => GateOutcome::Stopped(stop),
    }
}

#[cfg(test)]
fn run_with<T, E>(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
    next: impl FnOnce(&ConsentRecord) -> Result<T, E>,
    before: impl FnMut(SaveStage) -> io::Result<()>,
) -> GateOutcome<T, E> {
    match authorize(terms, store, ui, before) {
        Ok(permit) => start(permit, terms, store, next),
        Err(stop) => GateOutcome::Stopped(stop),
    }
}

fn authorize(
    terms: &CanonicalTerms,
    store: &ConsentStore,
    ui: impl FnOnce(&CanonicalTerms) -> Result<ConsentDecision, NativeUiError>,
    before: impl FnMut(SaveStage) -> io::Result<()>,
) -> Result<OwnedPermit, GateStop> {
    let (status, snapshot) = store.snapshot(terms).map_err(GateStop::Storage)?;
    match status {
        RecordStatus::Accepted(_) => {
            let lease = store
                .lock_verified_record(terms)
                .map_err(GateStop::Storage)?;
            return Ok(OwnedPermit {
                basis: PassBasis::ExistingRecord,
                consent_root: store.portable_root().to_owned(),
                terms: terms.clone(),
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
    Ok(OwnedPermit {
        basis,
        consent_root: store.portable_root().to_owned(),
        terms: terms.clone(),
        lease,
    })
}
