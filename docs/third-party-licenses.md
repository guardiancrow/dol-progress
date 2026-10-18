# 第三者ライセンスと配布条件

本書は、DOL Progress Managerの権利区分、Windows x64配布物の第三者通知、正式Notices入力の検証条件を説明する現行の正本である。ビルド・Package・独立Verifierの実行は[Release手順](release-build.md)を参照する。通知収集、DRAFT組立、CRT方式の変更、過去の監査留保は[ライセンス調査履歴](third-party-licenses-history.md)に保存している。

## MITと第三者の権利の区分

本プロジェクト独自のコード・文書・合成テスト／fixture・独自アイコンのSVGと生成assetには[MIT License](../LICENSE)を適用する。第三者libraryには各ライセンスを適用し、独自MITにより第三者コードの権利を再許諾しない。

『大航海時代 Online』や大航海時代データベースのデータ・名称・商標、利用者が手動取得したデータはMITの対象ではない。非公式のファンツールであり、各運営者・権利者との提携・公認を示さない。実CSVやゲーム由来画像を配布する許諾があるとは主張しない。

## 通知正本とWindows x64配布物

[THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)は現行Windows x64 Release向けの第三者原文・表示の正本である。利用者がEXEと同じ配布経路で取得できるよう、Portable ZIPに同梱する。通知正本を再生成したり、承認済みの原文を要約・省略したりしない。

固定ZIPにはEXE、README.txt、LICENSE.txt、THIRD-PARTY-NOTICES.txt、SHA256SUMS.txtの5ファイルを入れ、ZIP外に.sha256を置く。SQLite bundledとWebView2 LoaderはEXEに組み込む。VC++ Redistributable、WebView2 Runtime、Windows OS DLL本体やinstaller、開発・テストtool本体、DB／config／backup／取得CSVは含めない。Runtimeは外部導入要件であり、アプリが自動取得・導入する構成にはしない。

Noticesは保守的な包含候補と提供元通知も含む。通知に載る全componentが最適化後のEXEへ残ると認定したものではない。WebView2 SDKのpackage全体NOTICEを添付したことだけで、そこに列挙される全componentのnative Loader包含や追加source義務を認定しない。

## 正式レビューの状態

現行v0.3.0の通知対象201件・除外6件、原文148種類・357参照は正式レビュー済みで、manifest／review／sourceの承認状態はREVIEWEDである。依存版はnpm／Cargoのlockfileで固定する。原文、著作権表示、出典、除外根拠、lockとtoolchainを対応付けた既存結果を保持し、文書整理のために再監査・再承認しない。

正式レビューは通知に関する確認範囲の判断であり、全原文の逐語確認、包括的な法的保証、Microsoft契約の受入、一般公開の承認を意味しない。既存HEADの正式Compile・Package・独立Verifierは成功済みだが、新HEADの検証結果へ流用しない。

source.jsonのformal_package_gate=NOT_COMPLETEDなどは登録時のmetadataである。後続Packageの成功はrun/resultで記録し、その表示を更新するためにREVIEWED metadataや通知の由来commit・レビュー基点を改変しない。新しい依存・toolchain・配布構成へ旧レビューを無条件で一般化しない。

## 正式入力の検証仕様

検証の実装は`scripts/portable-package-safety.ps1`の`Assert-PortableNoticeAvailability`／`Read-PortableNotices`等にある。単なる通知ファイルの存在や、文書名の変更では正式gateを通さない。署名済みsourceに含まれる入力と、実際に検証するbytes／hashを照合する。

| 入力 | 必須の状態・対応 |
| --- | --- |
| release/notices/manifest.json | schema 1、REVIEWED、scope=DISTRIBUTION、boolean test_only=false、アプリversion、unresolved空配列。inventory／review／source／通知・Cargo／npm lock・compile toolchainのSHA-256 |
| inventory.json | schema 1、version、target=x86_64-pc-windows-msvc。一意のcomponent ID、version、boolean included、rust／frontend／native／toolchain／assets各group |
| review.json | schema 1、REVIEWED、version、boolean test_only=false、reviewer／reviewed_at、unresolved空配列。全componentへ一意に対応するcoverage、included一致、obligations_completedとprovenance_completed=true、非空の署名対象evidence |
| source.json | schema 1、purpose=PACKAGE_NOTICE_SOURCE、canonical_file=THIRD-PARTY-NOTICES.txt、version／target、40桁source_commit、formal_review_state=REVIEWED。通知正本とCargo／npm lockのhash |
| mapping.json | component／原文／出典、除外根拠、toolchain等を記録する署名対象のreview evidence |
| rootのTHIRD-PARTY-NOTICES.txt | manifestとsource.jsonが束縛する唯一の通知正本。空本文、DRAFT — NOT FOR DISTRIBUTION、LICENSE CLEARANCE INCOMPLETE、TEST_ONLY／SYNTHETIC／PLACEHOLDER／TODO／TBD／UNRESOLVEDのmarkerは拒否 |
| texts/*.txt／evidence/*.txt | reviewが参照する原文・評価証拠。署名対象であること、固定相対path、記録hashと実bytesの一致 |

metadataと通知の読取上限は16MiB。manifestのhash fieldはinventory_sha256、review_sha256、source_sha256、notices_sha256、cargo_lock_sha256、npm_lock_sha256、toolchain_sha256である。Cargo／npm lockは現在のsource入力hashと一致させる。compile toolchain hashの生成順と照合は[Release手順](release-build.md#正式3工程の実行)を参照する。

coverageのincluded recordにはselected_license、required_texts、copyrights、source_provisionが必要である。required_textsは`release/notices/texts/`配下の固定txt pathとSHA-256で指定し、原本のhashと通知本文への全文収録を照合する。原本hashはraw bytesに対して計算し、収録テキスト比較の改行正規化と混同しない。Git属性による原文／JSONの改行変換防止も維持する。

source_provisionはNOT_REQUIREDまたはCOMPLETE。MPLを選択したrecordはCOMPLETEとHTTPS source_urlを要求する。除外recordにはexclusion_reasonを持たせる。署名対象外のevidence、欠落／重複ID、version／hash／included不一致、原文・著作権・条件履行・出典の不足、未解決の入力は拒否する。

これは人の包含・原文・source提供等の判断を検証へ受け渡す契約である。hashや文字列照合だけで、すべての法的充足や外部URLの到達可能性を証明しない。合成fixture、未承認DRAFT、偽のclearance metadataを正式配布入力へ使わない。

### toolchainの限定更新

toolchainの版だけを更新する場合は、既存の6要素とfingerprint仕様で旧承認・現在値を比較し、変わった要素だけをレビュー対象とする。mapping.jsonのtoolchainとmanifestのtoolchain_sha256を更新候補へ揃え、review.jsonから差分証拠のhashを参照してmanifestのreview_sha256を再計算する。schema、coverage、通知原文、元のreviewer／reviewed_atとapproval_basis／formal_reviewは当時の記録として保持する。

追加するtoolchain_refreshは本人レビュー前のPREPARED記録であり、新しい正式承認を表さない。本人が差分をレビュー・承認し、署名付きcommitでclean HEADを確定した後、そのHEADから正式3工程を新runで行う。元のCompile結果を変更後のHEADへ流用せず、既存の厳密なhash・署名・clean・privacy条件を維持する。

### 独立した著作権者表示がない原本

`review.coverage[].copyrights`は明示配列とし、非空なら各表示が通知本文に存在することを検証する。空配列を許すのは、`copyright_review.state=NO_SEPARATE_NOTICE_IN_REVIEWED_SOURCES`、具体的なreason、非空のsource_evidenceがある場合だけである。著作者を推測で作らない。

source_evidenceは`release/notices/evidence/`または`release/notices/texts/`配下の固定txt path、SHA-256で示し、そのrecordのevidenceにも含める。重複pathを拒否し、署名対象hash、記録hash、実bytesが一致し、本文が空でないことを確認する。全recordの実レビュー、obligations／provenanceの完了要件は、この例外でも省略しない。原文やNOTICE自体の省略を認める仕組みではない。

## Microsoft関連の確認範囲と残件

| 区分 | 確認済みの範囲 | 未解決事項・判断主体 |
| --- | --- | --- |
| Community／Build Tools | 同一個人の自作アプリ開発という既存申告に基づく利用資格の評価 | 利用主体・開発形態の変更へ一般化しない。開発利用資格だけで再配布条件を免除しない |
| Windows SDK | ucrt.lib／ntdll.libは既存入力帰属と公式REDISTの対象指定を対応付け済み | SDK §2(a)(ii)の受領者保護と合意の方法・時点は未確定。製品全体の条件をアプリ利用者へ一括適用しない |
| MSVC startup | 動的CRTでもmsvcrt.lib／vcruntime.lib等のstartup・補助入力が残るという既存技術評価 | その個別の再配布許諾への対応は未特定。配布禁止とも充足済みとも推測せず、SDK草案とは独立して扱う |
| WebView2 SDK | 現行SDKのLICENSE／NOTICE全文とwrapper等の必要表示は正式Noticesに収録済み | package全体のNOTICEとLoader内の個別code包含を区別する。完了済み通知を旧留保だけで未完了へ戻さない |
| 外部Runtime・OS DLL | 本体・installerを同梱しない | 非同梱という理由だけでEXE内の組込みcodeの条件が消えるとは扱わない |
| 配布者の補償・防御等 | SDK契約の配布者義務と、利用者の条件を区別 | 受入可否と負担の不確実性は配布者本人が判断。MIT免責・通知同梱・Microsoftの責任上限で解消するとは記載しない |

SDK対象コードに限定した9段落をREADMEとConsent v2へ同一文面で実装している。文面の採用は契約適合性の認定ではない。同程度の保護、SDK製品向け条件の限定・省略、起動しない再配布者を含む合意成立、責任制限の効力は最終確認が必要である。MSVC startupの個別再配布根拠も未解決のままとする。特定のIssues投稿をMicrosoftの要求として追加しない。

Consent v2の制定日・正式採用日はユーザーの確定した2026年10月18日とし、本文末尾に記載する。termsVersion 2／canonicalVersion 1と既存方式によるhash・再同意を使い、改訂日の別行は追加しない。旧v1本文・制定日・version・hashは固定fixtureで保全し、旧記録をv2へ自動承認しない。配布者の補償・防御等は本人判断が未完了であり、本文採用によって受諾済みと記録しない。利用者への根拠のない補償転嫁も行わない。

## その他の現行判断と配布手順

現在のWindows構成でhost処理／Unix限定として除外したMPL対象を、旧source提供案だけを理由に配布対象へ戻さない。旧Unicode経路の除去も、現在残る他のライセンス条件の免除を意味しない。target／feature／CSP／依存／配布構成を変える場合は、影響する対象に限って再評価する。

最終文面・必要条件の確定後、[正式3工程](release-build.md#正式3工程の実行)で署名済みclean source、Notices、compile provenance、ZIP、privacyを検証する。利用者へは[READMEのLicense説明](../README.md#license)とZIP内通知を提供する。sourceのGitHub公開だけで、第三者source提供義務やバイナリ配布条件が自動的に充足されるとは扱わない。

既存の確認済み事項と現在の残件は上記のとおりであり、履歴の未登録・未レビュー・HOLDを現状へ戻さない。詳細な過去の留保・方針変更は[履歴](third-party-licenses-history.md)を参照する。現行手順はignoredのローカル監査資料の閲覧を前提としない。
