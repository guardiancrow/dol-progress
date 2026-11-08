# Map-C12F-3：正式Noticesの更新と限定検証

## 結論と承認境界

判定は **Map-C12F-3 LOCAL PASS / FINAL OWNER REVIEW PENDING** とする。
Ownerが承認したMap-C12F-2の更新方針に沿って、新原文・coverage・metadata・参照hashを整合させ、限定検証は成功した。
manifest.status・review.status・source.formal_review_stateはすべてPREPAREDのままである。
更新した10件のcoverage recordもPREPAREDとし、更新方針の承認を、更新結果の最終承認やREVIEWED昇格へ変換していない。

2026年11月8日、`release/v0.4.0-preparation`の`958722d87fb2405477530efc57553faec8d618c3`から開始した。
Map-C12F-2報告書はこのcommitへ保存済みで、開始時のindex・worktreeはcleanだった。ブランチを変更していない。
AGENTS.md、repo-publication-privacyのDモード、microsoft-licensing、Release・Notices正本を適用した。

今回のOwner承認は、依存・通知・配布構成の継承、候補toolchain採用、Rust原文の継承と追加、CSP関連4件の限定除外継承、更新作業と検証である。
Microsoft関連の既存未解決事項、バイナリ公開、GitHub Release公開、最終REVIEWED昇格は承認範囲外として記録した。

## 更新内容

| 対象 | 更新・保全内容 |
| --- | --- |
| THIRD-PARTY-NOTICES.txt | 独自見出しを0.4.0へ更新。N196–N201の適用表示を整合し、旧provider原文を歴史証拠と明示。新provider原文を全文追加 |
| texts/5647be…txt | インストール済みRust 1.99.1配布物のCOPYRIGHT-library.htmlをraw byteで追加。1,499,465 bytes、Map-C12F-2で固定したSHA-256と一致 |
| inventory.json | N196・N197・N198・N201をRust 1.99.1に対応付け、N200を0.1.28へ。N199のhashbrown 0.17.1、included、他recordは維持 |
| review.coverage | N196–N201へ現行証拠を追加。N201は旧required_textを残して新原文を追加。license／copyright／source_provisionは維持 |
| CSP関連4除外 | included=falseを維持。旧理由をhistorical_exclusion_reasonに保全し、通常target経路なし・host build／proc-macro・非null CSPという現行理由へ更新 |
| v0.4.0-refresh.json | Ownerの更新方針承認、対象報告書とhash、現toolchain、現record対応、原文・除外の証拠、現集計、最終未承認を別々に記録 |
| source.json | 新しい通知hashとsource_updatesを追加。元のsource_commitは保全。新本文が未commitであることをcontent_commit=null、UNCOMMITTED_UPDATEで明示 |
| manifest／review | 更新後のinventory／review／source／通知のhashを整合。未決事項をOwnerによる更新結果の最終確認へ整理。PREPAREDを維持 |
| 入力検査 | 旧coverage完全一致から、承認したrecord・fieldだけの変更を認める検査へ更新。原文・旧本文・他record・hash・由来・未承認状態を厳格に確認 |
| Release／Notices文書 | 過去の承認、方針承認、更新済み候補、最終確認待ちを区別 |

現候補は201通知・6除外・149原文・358参照である。旧148原文のraw byteは変更・削除していない。
旧通知本文についても、承認された見出し・適用版・N201参照表示の変更と新原文追加を逆変換すると、開始commitの通知byteに完全一致することを確認した。
新しい通知本文は5,193,362 bytesで、16MiB上限以内だった。

Map-C12F-2の計画ではmapping.json内への新項目追加も候補だったが、実装ではmapping.jsonを完全に不変とした。
旧toolchain_refresh等が現在もそのhashを参照しているためである。現toolchainとrecordの対応を新しいrefresh.current_record_mappingへ分離し、過去のhash参照を壊さずに現行対応を追跡可能にした。
この配置変更は、旧証拠を保全する承認方針に従う実装上の選択である。

## 履歴と承認の保全

以下は開始commitと同一である。

- mapping.jsonの全文・raw hash、元のrecords／formal_review／toolchain_refresh。
- v0.4.0-preparation.jsonの全文・raw hash。
- reviewの元のreviewer、reviewed_at、approval_basis、toolchain_refresh。
- manifest.source_headとsource.source_commit。
- N196–N201とCSP関連4件以外のcoverage、許可した版更新以外のinventory。

新証拠のapproved_planはOwnerの更新方針承認を記録するもので、final_reviewはPENDING_OWNER_REVIEW／approved=falseである。
旧PowerShell更新候補の記録は当時の記録として残し、今回の候補環境採用を別項目へ記録した。
legal_clearanceとpublic_release_approvedはfalseのままである。

source_updatesのinput_checkpointは作業入力のcommitであり、新本文がそのcommitに存在すると主張していない。
新本文を保存したcommitは、Ownerが後続のcommitを判断した後に必要な範囲で追記する。今回の未commit更新へ架空のcommitを割り当てていない。

## 対象hash

| 対象 | SHA-256 |
| --- | --- |
| 新provider原文 | `5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27` |
| THIRD-PARTY-NOTICES.txt | `93bd33f8353c7375cf8d9612e18ccbeb976f37165315d3f485b4050dc8cbb855` |
| inventory.json | `612f8aa6ed4defd41ed0c7a9abc1e841ed945178de55e012e3cf3549b7fa86c8` |
| review.json | `b8e5e24985672f6b95d3661a6b33a573cd7d57e8d492c508e5f1c26cc86a502e` |
| source.json | `591027966a26fe39d74198487e34333592462122d6ae6ee39ca96f218878fe92` |
| v0.4.0-refresh.json | `1eaa2b0ceb3815600e230711e88639def70c8ef767f0b1dde3b090f5cd5b6dc3` |
| manifest.json | `0dfa763dfe6742b7be414a00fb14bee3b77fecad86d9084f9d2b67029db6e8b3` |

候補toolchain fingerprintは承認された`03bc8eeb02bfd006cf7f72f4bf5f4e4110eac9ccd96ad3f2c0d1e961ac9272da`のままである。
Cargo／npm lock hashはMap-C12Fから不変である。

## 限定検証

| コマンド・確認 | 結果 |
| --- | --- |
| node --test scripts/tests/release-input-audit.tests.mjs | 20件成功 |
| powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-inputs.tests.ps1 | 現候補の整合成功。実PREPARED入力に対する正式gateの拒否も確認 |
| powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/portable-package.tests.ps1 | 99件成功。合成PE／ZIPと正式entryの拒否試験 |
| powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/third-party-notices.tests.ps1 | 46件成功。既存合成fixtureの原文・出典・条件・不正入力試験 |
| 原文・coverage・metadata | 全149原文のraw hashと全文収録、207 record、201通知・6除外、358参照を確認 |
| 履歴・変更範囲 | 旧通知byte、旧承認情報、他record、元の原文・mapping・準備snapshotの保全を確認 |
| git diff --check | 成功 |

新しい読取検査はPREPARED候補の内容を確認するもので、正式runnerを成功させる入口ではない。
実候補の承認状態を変更したり、REVIEWEDに偽装したコピーを正式工程へ渡したりしていない。
異常系ではメモリー上の入力だけを改変し、再hashしても未承認record変更、古いCSP理由、原文省略、旧承認日時変更、toolchain変更、架空のcommit、早すぎるREVIEWEDや公開承認を拒否した。
例外表示はgate名に限定し、原文全文やOwner環境pathを失敗出力へ転載しない。

原文を追加したので、Map-C12Fの148原文・357参照を現期待値にそのまま使わず、今回の承認された差分だけを検証する形へ変更した。
第三者通知組立テストの207候補／148原文は独立した既存合成fixtureの値であり、現候補の149原文とは別である。
正式gate・Package・独立Verifierの実装は変更せず、署名・clean・toolchain・hash等の条件を維持した。

アプリコード、依存、起動、DB、version、ビルド設定を変更していないため、Map-C12Fの全Vitest・型検査・Vite・Tauri Debug／Release成功を継承した。今回は再実行していない。
正式Compile／Package／独立Verifier、アプリ実起動、実GitHub疎通、旧DB更新smoke、Privacy Rは未実施である。合成Package試験の成功を正式工程の成功とは扱わない。

## Ownerの最終確認と次工程

Ownerは本書の新原文・適用版・除外理由・coverage・metadata・hash・検証結果を確認し、REVIEWEDへの昇格を別途判断する。
昇格時には新しい承認者・日時・範囲・対象hashを記録し、旧承認記録を上書きしない。
候補専用入力検査のPREPARED要求も、実際の昇格を承認する次工程で新しい承認証跡に対応させる。検査だけを先に緩めない。

署名付きclean HEADを確定した後、そのHEADから正式Compile → Package →独立Verifierを別工程で実施する。
最終成果物のPrivacy R、公開v0.3.0相当の合成旧DBからmigration 004を含む更新smoke、残余UI確認を引き続き行う。
Microsoft関連の受領者条件・合意方式、MSVC startupの個別再頒布根拠、配布者の補償等の既存未解決判断と、最終バイナリ公開承認は独立して残す。

## データ・公開安全性と終了状態

今回の差分、新原文、証拠JSON、読取検査・テスト、文書へPrivacy Dを適用した。
秘密情報・Owner固有絶対path・実データ由来の値の追加は検出しなかった。原文内の第三者著作者表示・正当なメール・出典は保持した。
全履歴・全依存・全ライセンスの再監査や、配布byteのR監査を実施したとは扱わない。

実DB・CSV・本番環境、使用許諾・同意本文、termsVersion／canonicalVersion、migration、SSH設定は変更していない。
git add／commit／push、正式Compile／Package、tag、Release、公開済みassetへの操作は行っていない。
変更は準備ブランチの未stage状態で保全し、Ownerの最終確認を待つ。
