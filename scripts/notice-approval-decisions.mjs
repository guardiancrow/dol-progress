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
  '0.6.0': Object.freeze({
    version: '0.6.0', candidate_commit: 'de8e98616dffd216ead37c9b61dfb109cac963ea',
    snapshot_path: 'release/notices/v0.6.0/preparation.json',
    snapshot_sha256: 'a899643cc3f76ac8658731630d99dd3cee8d9402a46b6523a9a75c92b1524465',
    approval_path: 'release/notices/v0.6.0/approval.json',
    approval_sha256: 'a7e751895063df92b2d9703fd4411311766a9fe69a879a43c89e8404d6a672cb',
    approved_by: 'Owner', approved_on: null, approved_date_status: 'NOT_SPECIFIED_IN_OWNER_INSTRUCTION',
    toolchain_sha256: '39bdb50fedc616aec10d26e9c7d5dcf818932912fbc249bc69e0de517a053a49',
    notices_sha256: '016ec4506b976aad2e33d0295983d557773ada3601f9cd1bb696f1cc3bd8b251',
    candidate_tooling_sha256: Object.freeze({
      'scripts/notice-candidates/.gitattributes': '61d6cf26907e4f4a0f4b2e2665f02149e5d82d3382780b12abe68d54289ba8e9',
      'scripts/notice-candidates/v0.6.0.mjs': '6331cdcfdbb758f3298e7b8fd66f81a8a0be634d2b1efed8528ef578667a2e4a',
    }),
    scope: Object.freeze([
      'Fixed v0.6.0 candidate commit and preparation.json',
      'Application version values and exact candidate input bytes',
      'Notices and original texts inherited from v0.5.0',
      '201 included notices, 6 exclusions, 149 original texts and 358 references',
      'Inherited component coverage and exclusion reasons',
      'Both lockfiles unchanged except for the application version',
      'Inherited approved toolchain fingerprint',
      'Transition of the three fixed candidate metadata files from PREPARED to REVIEWED',
    ]),
    excludes: Object.freeze([
      'Approval or registration of new or changed verification implementation',
      'Formal Compile, Package or independent Verifier results',
      'Final EXE or ZIP acceptance',
      'GitHub Release publication',
      'New Microsoft contract determinations',
      'Expansion of existing use or redistribution permissions',
      'Production database or real CSV operations',
      'New migrations',
    ]),
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
