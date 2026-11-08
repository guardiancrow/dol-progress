# Map-C12F-4：Owner承認記録と正式NoticesのREVIEWED確定

## 結論と開始状態

判定は **Map-C12F-4 REVIEWED INPUTS READY** とする。
2026年11月8日のOwner明示承認を新しい証拠として記録し、正式NoticesをREVIEWEDへ移行した。
201通知・6除外、149原文・358参照、通知本文・N201原文・inventoryは承認対象から変更していない。
Microsoft関連の法的残件やバイナリ公開は承認対象に含めていない。

開始時のブランチは`release/v0.4.0-preparation`、HEADは`7207214efcc64ed7db991d3777f0caab547fd1d8`だった。
Map-C12F-3の変更はこのcommitへ保存済みで、index・worktreeはcleanだった。新しいブランチは作成していない。
AGENTS.md、repo-publication-privacyのDモード、microsoft-licensing、Release・Notices正本を適用した。

## 1. Owner承認の記録

新しい`release/notices/v0.4.0-approval.json`に次を記録した。

- 承認者：Owner。確認可能な承認日：2026-11-08。根拠：Map-C12F-4での明示指示とMap-C12F-3の実装・検証報告。
- 承認範囲：v0.4.0への既存依存・通知・coverage継承、候補toolchain、Rust N196–N200の適用更新、N201原文追加と旧証拠保全、CSP関連4件の除外理由、本文・metadata・参照hash・限定検証結果。
- 対象：F-3の保存commitと、その時点の10入力のraw SHA-256。通知本文、新原文、inventory、review、source、manifest、mapping、準備snapshot、refresh、F-3報告書を束縛した。
- 範囲外：Microsoft関連の契約適合判断・既存未解決事項の解消、バイナリ公開、GitHub Release公開。

新承認は日付だけを記録し、不明な承認時刻を作っていない。旧reviewer／reviewed_atを新承認の値へ置き換えていない。
legal_clearanceとpublic_release_approvedはfalseである。

## 2. REVIEWEDへ移行した項目

| 対象 | 移行・追加内容 |
| --- | --- |
| manifest.status | REVIEWED。unresolvedを空配列にし、owner_approvalと更新後のreview／source hashを記録 |
| review.status | REVIEWED。unresolvedを空配列にし、新Owner承認の参照を追加 |
| review.coverage | N196–N201とCSP関連4除外の10件をREVIEWEDへ。新承認証拠のpathを追加。license・required_texts・copyright・included・除外理由は承認対象と同じ |
| review.release_refresh | REVIEWEDへ。旧PREPARED証拠を残し、新承認とREVIEWED証拠のhash参照を追加 |
| source.formal_review_state | REVIEWED。owner_approvalを追加し、新本文の由来を確定 |
| v0.4.0-reviewed.json | F-3のrefreshを基にした現行証拠。final_review=APPROVED／approved=true、承認者・日付・承認証拠、保存commitを記録 |

`v0.4.0-refresh.json`自体はPREPARED時点の証拠として変更していない。そのPENDING_OWNER_REVIEW表示を現行状態と取り違えない。
現在の承認状態は新しいapproval／reviewed証拠と正式metadataで示し、過去のsnapshotを後から承認済みへ書き換えない。

## 3. 由来commitとhash参照

新しい通知本文・N201原文の保存commitは`7207214efcc64ed7db991d3777f0caab547fd1d8`である。
Git objectの実bytesを読み、F-3報告の通知hash・原文hash・inventory・coverage・除外理由・toolchainと照合した。
新本文と原文の変更履歴でもこの保存commitを確認した。

source_updates.content_commitとreviewed.canonical_notice.content_commitをこのSHAにし、content_stateをCOMMITTEDへ変更した。
source_updatesの元のPREPARED証拠参照はprepared_evidenceへ残した。input_checkpointはF-3作業前の基点という意味を維持する。
今回の承認metadataを保存する将来のcommit自身のSHAは、どの内容にも書き込んでいない。

参照関係は次の順で、逆向きの参照を持たない。

```text
現在のmanifest → 現在のreview／source → REVIEWED証拠
                                      ↓
                                 Owner承認証拠
                                      ↓
                        PREPARED snapshot @7207214
```

承認証拠が持つmanifest／review／sourceのhashは、現在のファイルではなく保存commitのPREPARED版に対する値である。
このcommitで修飾した参照を区別することで、承認証拠と現在metadataの間にhash循環を作っていない。

## 4. 過去の証拠の保全

以下のbyteまたはfieldは従来どおりである。

- THIRD-PARTY-NOTICES.txt、既存原文とN201新原文、inventory.json。
- mapping.json、v0.4.0-preparation.json、v0.4.0-refresh.json、F-3報告書。
- 旧reviewer、reviewed_at、approval_basis、toolchain_refresh。
- manifest.source_head=`4396ff971bbb4b543ead88dd51ae7a077d7cb69f`。
- source.source_commit=`9fa2ba9b3e2da5abdcec9de3b27a218a4e228627`。

F-3のcoverageを基準に、10件の状態と承認参照だけを更新した。他recordや承認対象の原文・包含判断を変更していない。
旧PREPARED検査20件は、現在入力をPREPAREDへ偽装せず、実際に保存されたsnapshotを読んで維持した。
全依存や原文のライセンス再調査・再収集は行っていない。

## 5. 最終入力hash

| 対象 | SHA-256 |
| --- | --- |
| N201新原文 | `5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27` |
| THIRD-PARTY-NOTICES.txt | `93bd33f8353c7375cf8d9612e18ccbeb976f37165315d3f485b4050dc8cbb855` |
| inventory.json | `612f8aa6ed4defd41ed0c7a9abc1e841ed945178de55e012e3cf3549b7fa86c8` |
| review.json | `27c3394b78937938a613667e1e0a755eb98fb256df007325116e3d409677c919` |
| source.json | `5b16e8db44c662f3952fda3cfce5e61338d4180a2752581f5c71d19175f11162` |
| manifest.json | `4bbf6cb993cd0515d9b57977248fa0c85f69ef681f239288c4887d53e1461df1` |
| v0.4.0-approval.json | `5b7ad29c58214e8a365bd0141830adfeb927d0a7dcce76f6f0a6ffed0f4ed8d9` |
| v0.4.0-reviewed.json | `876dd0a910b2a958d42e87aeb35275b777b947232f3d0cc7cdf841b58c0c984c` |

採用toolchainはRust/Cargo 1.99.1、Node.js v26.13.0、npm 11.20.0、Tauri CLI 2.11.4、Windows PowerShell 5.1.26100.9711である。
fingerprintは`03bc8eeb02bfd006cf7f72f4bf5f4e4110eac9ccd96ad3f2c0d1e961ac9272da`で不変である。

## 6. 入力検査と正式gateの検証

v0.4.0のRead-PortableNoticesへOwner承認検査を追加した。
承認証拠、REVIEWED証拠、検査moduleをsource入力hashと照合し、検査moduleで承認対象の保存commitと許可した移行だけを確認する。
単なるREVIEWEDの文字列、対象を変更した再hash、架空の保存commit、旧承認日時の変更、公開承認への拡大は受け入れない。
旧v0.3.0の入力契約は継承し、正式source guard・署名・clean・Compile provenance等の条件は変更していない。

| 検証 | 結果 |
| --- | --- |
| node --test scripts/tests/release-input-audit.tests.mjs scripts/tests/reviewed-input-audit.tests.mjs | 45件成功（旧PREPARED 20件＋REVIEWED 25件） |
| powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-inputs.tests.ps1 | 実際のREVIEWED入力で正式Notices読取関数が成功。返却本文hashも一致 |
| portable-package.tests.ps1 | 102件成功。承認証拠なし・hash不正・source未束縛の拒否を追加 |
| third-party-notices.tests.ps1 | 46件成功 |
| notice-source.tests.ps1 | 28件成功 |
| git diff --check | 成功 |

異常系はメモリー上の改変または合成fixtureで実施した。実Noticesの承認状態を偽装して試験していない。
承認証拠と参照hashを再計算しても、承認対象外の差分が通らないことを確認した。
正式Notices読取関数の試験には、現在のtrackedファイルと未commitの新規入力から計算した実hashを渡した。
これは関数単位の入力検証であり、署名済み・clean HEADであることを偽装したものではない。source guardを呼ばずに正式3工程を実行する入口は追加していない。

アプリコード・version・依存・ビルド設定の変更がないため、既存Vitest・型検査・Debug／Releaseビルド結果を継承し、今回は反復していない。
正式Compile・Package・独立Verifierは未実行である。テスト内の合成Package・正式entry拒否試験を正式runの成功として扱わない。

## 7. 残余事項と終了状態

Ownerが今回の記録を確認し、後続の署名付きcommit・clean HEADを確定した後、そのHEADをExpectedSourceHeadとして正式3工程を別フェーズで行う。
最終配布byteのPrivacy R、合成旧DBからmigration 004を含む更新smoke、OSブラウザー起動・スクリーンリーダー・200%拡大等の残余確認を維持する。
Microsoft関連のSDK受領者条件・合意方式、MSVC startupの個別再頒布根拠、配布者の補償等の既存未解決事項と、バイナリ／GitHub Release公開承認は独立して残す。
今回の明示承認を同じ範囲で求め直す必要はない。実質的な差分が生じた場合だけ、その差分を対象に判断する。

Privacy Dは今回変更したNotices metadata、承認証拠、入力検査・テスト、文書に適用した。
秘密情報・Owner固有絶対path・実データ由来の値の追加は検出しなかった。全履歴・全依存・全原文の再監査や、Release R監査を実施したとは扱わない。
実DB・CSV・本番環境、使用許諾・同意本文、DB schema・migration、SSH設定は変更していない。
git add／commit／push、tag、Release操作は行っていない。未stageの変更を保全し、Owner確認待ちで停止する。
