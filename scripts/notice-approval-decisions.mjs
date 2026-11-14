// Input approval is independent of review of new/changed implementation code.
// No date is inferred when the explicit Owner instruction supplies none.
export const approvedNoticeDecisions = Object.freeze({
  '0.5.0': Object.freeze({
    version: '0.5.0', candidate_commit: '57f0325f1daaa699569c82c221de35ddc2a79605',
    snapshot_path: 'release/notices/v0.5.0/preparation.json',
    snapshot_sha256: '5cafbfda822c9471f9b4061135c90ec93fdf9493f9ae21f11dd3848a834bf794',
    approval_path: 'release/notices/v0.5.0/approval.json',
    approval_sha256: 'c9b29710e420c340f03568857568166973d350a82276656f5fda84fca16356a9',
    approved_by: 'Owner', approved_on: null, approved_date_status: 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION',
    toolchain_sha256: '39bdb50fedc616aec10d26e9c7d5dcf818932912fbc249bc69e0de517a053a49',
  }),
});
// Populate only after a separate, explicit Owner review of exact implementation bytes.
// Keeping decision data separate avoids a verifier/own-hash dependency cycle.
export const approvedVerificationDecisions = Object.freeze({});
