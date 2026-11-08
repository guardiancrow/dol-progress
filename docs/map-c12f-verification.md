# Map-C12F：v0.4.0と正式Release入力の準備

## 開始状態と判定

2026年11月8日、mainの`0221a705beeca9b638e85e5170eb19f5a22ec064`から開始した。
origin/mainも同じSHAで、index・worktreeはcleanだった。同名ブランチがないことを確認し、`release/v0.4.0-preparation`を新規作成した。
AGENTS.md、repo-publication-privacyのDモード、microsoft-licensing、Release・第三者ライセンスの正本を適用した。

判定は **Map-C12F CONDITIONAL — TARGETED DECISION REQUIRED** とする。
アプリ版・runner・候補metadataの整合とローカル検証は完了したが、現行toolchainと通知の適用範囲について限定レビュー・Owner判断が必要である。
正式NoticesはPREPAREDとして保全し、REVIEWEDへの昇格、正式Compile・Package・独立Verifier、バイナリ公開は行っていない。
Microsoftの法的残件は別の配布判断として維持し、本フェーズ全体を止める条件にはしていない。

## バージョンとrunner

次の5ファイルを`0.4.0`へ更新した。package-lock.json内にはtop-levelとroot packageの2か所がある。

- package.json
- package-lock.json
- src-tauri/Cargo.toml
- src-tauri/Cargo.lockのdol-progress-manager record
- src-tauri/tauri.conf.json

開始HEADとの比較で、npm lockは上記2値以外のJSONが同一、Cargo lockはアプリ版以外の内容が改行正規化後に同一であることを確認した。
依存の追加・version更新、npm install、Cargo updateは行っていない。Cargo metadataはlocked／offlineで成功した。

要件書5.13の「現在のアプリバージョンは変更しない」はMap-C12B当時の制約だった。今回の明示指示に従い、表示機能自身は番号を書き換えず、Release準備で正式版を整合させる規定へ明確化した。表示・取得・更新確認の動作は変更していない。

scripts/build-release.ps1にあった固定値は、初期result.versionと「compile phase must remain 0.3.0」の検査である。
初期result.versionをnullにし、5ファイルを照合したpackage.jsonの版だけをresultへ設定する。
Packageで使用していたAssert-PortableVersionsをrelease-safety.ps1へ移し、CompileとPackageから共用する。関数の判定条件は維持した。
CompileでもCargo lockのアプリrecordとnpm lockのtop-level／rootを検査するため、以前の検査より照合対象が増えている。

署名、ExpectedSourceHead、source inventory、clean／既存の限定tooling例外、CLI、target、environment、hash、manifest guard、privacy、Notices、toolchainの既存gateは維持した。
Package／独立Verifierのclean要件や、未承認Noticesの拒否を緩和していない。
合成テストの0.3.0、履歴資料、旧notice-sourceの0.3.0は過去版の検証入力として保持する。Package名等は元からsource versionによる生成で、固定0.3.0への依存はなかった。

## Noticesの継承と候補入力

THIRD-PARTY-NOTICES.txt、release/notices/texts、mapping.json、release/notice-sourceは変更していない。
通知正本のSHA-256は`37e763e27a6fd410324b3617d6e55ba0bb058d0086949dac776dc073c0c282a1`のままである。
201通知・6除外、全207 coverage、148原文・357参照、除外理由、reviewer、reviewed_at、approval_basis、mapping.formal_review、既存toolchain_refreshを保全した。

manifest.source_headの`4396ff971bbb4b543ead88dd51ae7a077d7cb69f`は当時のレビュー基点、source.source_commitの`9fa2ba9b3e2da5abdcec9de3b27a218a4e228627`は通知正本の由来である。
新しいアプリのHEADや最終Compile HEADを表す値として上書きしていない。

manifest／inventory／review／sourceのアプリ版、Cargo／npm lock hash、inventory／review／sourceへの参照hashを更新した。
manifest.status・review.status・source.formal_review_stateはPREPAREDとし、未決事項を列挙した。
新規v0.4.0-preparation.jsonに、旧入力hashと参照checkpoint、過去の承認範囲、候補lock／toolchain、継承候補・未承認事項を記録し、review.release_refreshからhashで参照する。
reviewerとreviewed_atは過去の承認者・日時であり、新構成の承認と解釈しない。

レビュー基点のlockと現在lockを比較した結果、依存package名・versionの追加／削除はなかった。
一方、現在の開発環境とmappingのtoolchainには次の差がある。今回toolchainをインストール・更新したものではない。

| 要素 | mappingの記録 | 今回確認した候補 |
| --- | --- | --- |
| rustc | 1.98.0 | 1.99.1 |
| cargo | 1.98.0 | 1.99.1 |
| Node.js | v24.20.0 | v26.13.0 |
| npm | 11.19.0 | 11.20.0 |
| Tauri CLI | 2.11.4 | 2.11.4（不変） |
| Windows PowerShell | 5.1.26100.9711 | 5.1.26100.9711（既存更新候補と同じ） |

候補fingerprintは正式手順と同じ6要素・順序・LF・UTF-8で計算した。開発用PowerShell 7の版を正式Windows PowerShell入力へ混在させていない。
Rust標準ライブラリ通知N196–N201は1.98.0の証拠のままであり、1.99.1に適合すると認定していない。
既存PowerShell差分の承認待ち記録も、自動的には完了へ変更しない。

旧除外根拠のCSP nullは現在の非null設定と一致しない。cssparser 0.37.0、cssparser-macros 0.7.1、selectors 0.38.0、dtoa-short 0.3.5に対象を限定した。
現行Cargo treeではdom_query／tauri-utils html-manipulation-2を経由するhost build／proc-macro依存である。
`-e normal,no-proc-macro`でselectors 0.38.0とcssparser 0.37.0に通常target経路がないことも確認した。
これはhost-only除外継承の候補証拠であり、最終EXEの全byte包含や法的なsource義務の充足を証明しない。過去の除外理由は保全し、新しい判断を追記する方針とする。

## 検証結果

| 項目 | 結果 |
| --- | --- |
| 5ファイル・6値のversion一致 | 0.4.0で成功 |
| lock整合 | npmのアプリ版以外のJSON同一、Cargoのアプリ版以外の正規化内容同一、cargo metadata --locked --offline成功 |
| 全Vitest | 43ファイル・585件成功 |
| TypeScript | npm run typecheck成功。両ビルドのbeforeBuildでも成功 |
| Vite production build | 両TauriビルドのbeforeBuildで成功 |
| release-tooling.tests.ps1 | Windows PowerShell 5.1で60件成功 |
| portable-package.tests.ps1 | Windows PowerShell 5.1で99件成功 |
| third-party-notices.tests.ps1 | Windows PowerShell 5.1で46件成功 |
| notice-source.tests.ps1 | Windows PowerShell 5.1で28件成功 |
| release-inputs.tests.ps1 | 候補metadata・全参照hash・原文hash・履歴coverage・由来・version・PREPARED拒否を確認して成功 |
| Tauri Debug | npm run tauri -- build --debug --no-bundle -- --locked --offline成功 |
| Tauri Release | npm run tauri -- build --no-bundle -- --locked --offline成功 |
| EXE version resource | Debug／ReleaseともFileVersion・ProductVersion=0.4.0 |
| git diff --check | 成功 |

共通version guardは0.3.0／0.4.0／合成の将来版を受け入れ、6値のどれか一つだけ0.3.0が残る場合をすべて拒否した。
Cargoの依存versionでアプリ版の不一致を隠せないことも確認した。
Notices／toolchainの正式な拒否条件を維持し、PREPAREDのmanifestまたはreviewが通らないことを合成入力で確認した。

初回PowerShell試験では、旧0.3.0固定の合成fixtureと、実Noticesのtoolchainに依存するfixtureが不一致で失敗した。
前者は現在アプリ版を使う合成fixtureへ変更し、後者は独立した合成toolchain／hashへ分離した。
旧curated notice-sourceの再現試験だけは隔離コピー内のアプリ版を履歴の0.3.0に揃えた。正式入力の承認状態や製品側gateは変更していない。
修正後の上表を最終結果とする。Vitestの既存例外系stderrはあるが失敗はなかった。

正式Compile／Package／独立Verifierの成功runは作成していない。テスト内の合成ZIPやentry拒否試験は正式3工程の実行・成功記録ではない。
今回のEXEはローカルコンパイル検証用で、配布用privacy R監査済み成果物ではない。アプリ実起動・実GitHub疎通・旧DB schema更新smokeは本フェーズでは実施していない。

## 限定判断と正式3工程へ進む条件

1. v0.4.0の入力継承とlock hash差分をOwnerが確認する。過去のレビュー事実は維持する。
2. 現行toolchainを採用する場合は変更した4要素とRust標準ライブラリ通知N196–N201を限定レビューし、必要な原文・inventory・coverageを整合させる。既存PowerShell更新候補を含む承認範囲を明示する。別案は過去の適用範囲に一致する既存toolchainで候補を作り直すことであり、自動のdowngradeは行わない。
3. CSP変更後の4件のhost-only除外継承を確認する。旧理由と新証拠を区別して記録する。
4. 差分承認後に正式Noticesを整合させ、Ownerが署名付きcommitと最終clean HEADを確定する。そのHEADをExpectedSourceHeadにして、新runでCompile → Package →独立Verifierを別フェーズで実行する。

以上はRelease入力・技術検証の条件である。Microsoft関連の受領者条件と合意方式、MSVC startupの個別再頒布根拠、配布者の補償等の既存判断、最終配布物のPrivacy R、隔離smoke、公開承認はバイナリ公開前の独立条件として残す。
次回正式バイナリsmokeでは、公開v0.3.0相当の旧DB schemaからmigration 004を含む更新経路を合成データで検証する。OSブラウザー起動、スクリーンリーダー・200%拡大の残余確認も維持する。

## 安全性と終了状態

今回のコード・設定・テスト・Notices metadata・文書の差分と新規ファイルにDモードを適用した。
秘密情報・Owner固有の絶対path・実データ由来の値の追加を検出しなかった。全Git履歴・全依存・全ライセンス・既存バイナリの再監査は行っていない。
同一個人の開発資格、動的CRT・外部Runtime・SDKに関する既存判断は継承し、Microsoft関連の未解決事項を解決済みへ変更していない。
Rust等のtoolchain差分は上記候補に明記し、全原文の旧承認を新Rustへ自動適用していない。

実DB・CSV・本番環境を操作していない。使用許諾・同意本文、termsVersion、canonicalVersion、migration、起動順序は変更していない。
git add／commit／push、tag、GitHub Release、公開済みassetへの操作は行っていない。
変更を準備ブランチの未stage状態で保全し、Owner確認を待つ。
