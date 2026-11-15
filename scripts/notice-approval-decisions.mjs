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
// Separate explicit Owner code approval; neither input approval nor metadata can populate this.
// Keeping decision data separate avoids a verifier/own-hash dependency cycle.
export const approvedVerificationDecisions = Object.freeze({
  '0.5.0': Object.freeze({
    version: '0.5.0', candidate_commit: '57f0325f1daaa699569c82c221de35ddc2a79605',
    snapshot_sha256: '5cafbfda822c9471f9b4061135c90ec93fdf9493f9ae21f11dd3848a834bf794',
    reviewed_commit: 'a92a6bdc60a011d153b9b042a973895762905f8b', reviewed_pr: 12,
    implementation_snapshot_path: 'release/notices/v0.5.0/verification-preparation.json',
    implementation_snapshot_sha256: '023112f1a0bd52ace3192cc2f43a13a95270765404cf0bfaf08c6a03fd0acedc',
    approved_by: 'Owner', approved_on: null, approved_date_status: 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION',
    reviewed_tooling_sha256: Object.freeze({
      'scripts/.gitattributes': '6e89107caa4b44da313672eda1129cd0633ff68ec5440e775a125cb6c39a0822',
      'scripts/build-portable-package.ps1': 'e90e6a543edee87a7e5cc1ee053ea69060a84819cc3635ae0abd0a22fda578d7',
      'scripts/notice-approval-binding.mjs': '4f77bef2ce542dbcf71f5ca496e7ffc2351aafab17ee67c4151564856545813f',
      'scripts/notice-input-promotion.mjs': '650f01c3623f3a356264a6cbb96af0d108d026a05ca1b3d5a7f851edd7ec0744',
      'scripts/portable-package-safety.ps1': '0753ebfa79762ffc3c3c7d0ef72f354960ec7cef324c10e639e52b178e08c6ac',
      'scripts/release-candidate-audit.mjs': '452a6532c54471f410bc8726ac3cff44062dd40763c56b16e99a7eeb2234be73',
      'scripts/release-input-audit.mjs': 'cb7c7fb10b88a6d5a4fa4cceaed6eeac01a308131effafcd78e3f88f3d077140',
      'scripts/verify-portable-package.ps1': 'c59312fe220eb814605576f15fd3c0b2bcd59a42f92be8fb4718a21994af252f',
    }),
    public_release_approved: false,
  }),
});
