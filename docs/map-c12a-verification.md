# Map-C12A：発見物一覧の絞り込み改善と検証

## 開始条件と既存仕様

2026年11月8日、`feature/map-c12a-discovery-filters`の`6cd755d`から開始した。作業ツリーはクリーンで、登録済みworktreeは一つだった。
SSH署名が有効である設定と、HEADのSSH署名・署名者の照合成功を確認した。署名設定は変更していない。

`AGENTS.md`、要件書、Map-C7/C8の検証記録と、一覧・集計・履歴・地図判定の実装を確認した。
今回の要求と既存仕様の矛盾は確認範囲では見つからなかった。Map-C7/C8の履歴区分を一覧でも使用し、概要の集計処理は変更していない。

## 実装と保存データの境界

「未報告の内訳」を状態filterの直後へ追加した。初回未報告は`not_reported`、再報告待ちは`confirmed`、履歴未確定は`unknown`または履歴行なしとする。
現在未報告だけを対象に、分類未設定と非地図発見物を含める。レリック、未発見、有効報告済みの自動報告は含めない。
`unknown`の旧算入資格と、現在報告の表示補完は内訳の推定に使用しない。

履歴は既存の一括取得を使用する。取得状態をプロフィール・取得世代に対応させ、読込中と失敗を履歴行なしから区別した。
内訳選択中の未取得・再取得・失敗時は、結果件数とページ数を表示しない。
初回取得失敗後に既存の再読み込みボタンが無効のままになる経路も修正した。取得成功後は最新履歴で再計算する。
保存操作、状態遷移、履歴訂正の内容とtransactionは変更していない。

「地図・要確認」をfilterと名称付近で「地図・判定保留」へ改称した。
名称付近へのhoverとキーボードfocusで、その行に該当する複数関連・報告対象外の理由を表示する。
両条件に該当すれば両理由を示す。初回報告履歴の不明とは独立した判定であることもfilterの説明に明記した。
`mapDiscoveryStatus`の条件と`discoveryStateSummaries.sql`は維持した。

## 変更ファイル

- `src/discoveries/unreportedBreakdown.ts`：現在未報告と保存履歴による読み取り専用の区分判定。
- `src/discoveries/types.ts`：内訳判定に使う履歴の取得完了状態。
- `src/discoveries/useReportHold.tsx`：一括取得の状態管理と失敗時の再読み込み。
- `src/pages/DiscoveriesPage.tsx`：取得状態を行モデルと一覧へ接続。
- `src/components/discoveries/DiscoveryTable.tsx`：内訳filter、取得待ち・失敗表示、地図の理由表示。
- `src/discoveries/mapReacquisition.ts`：地図表示名と行ごとの保留理由。
- `src/App.css`：保留理由のhover／focus表示。
- `src/DiscoveriesPage.test.tsx`：一括取得の待機・失敗・再取得とプロフィール切替。
- `src/discoveries/mapReacquisitionUi.test.tsx`：区分、既存filterとのAND、ソート・件数・ページング、地図の理由。
- `src/discoveries/mapDiscoveryStateUi.test.tsx`：内訳を追加したfilter配置の期待値。
- `src/repositories/progressStatsBreakdown.integration.test.ts`：実際の一覧・集計SQLと合成SQLiteを用いた一致・不変性の確認。
- `docs/requirements.md`：Map-C12Aの契約と地図の表示名。
- 本書：検証と作業範囲の記録。

## 自動検証

| 検証 | 結果 |
| --- | --- |
| 関連Vitest | 3ファイル・92件成功 |
| 全Vitest | 37ファイル・480件成功。今回8件追加 |
| TypeScript型検査 | `npm run typecheck`成功。TauriのbeforeBuildでも再実行して成功 |
| Vite production build | TauriのbeforeBuildで`npm run build`成功 |
| Tauri Debug build | `npm run tauri -- build --debug --no-bundle -- --locked --offline`成功 |
| 差分の空白検査 | `git diff --check`成功 |

全Vitestの初回実行では、既存のfilter配置テストが追加項目を期待しておらず1件失敗した。
今回の配置に期待値を更新し、全件を再実行して成功した。
既存の例外系テスト等ではstderrへエラーを出力するが、最終実行でテスト失敗はなかった。

合成データで、3区分、非地図、分類NULL、履歴行なし、unknown＋旧算入資格、レリック・自動報告例外を確認した。
状態・分類・カード・地図・検索とのAND、filter解除、ソート、50／100件のページングと0件表示も確認した。
プロフィールを切り替えた後の遅延応答を無視し、初回取得・更新後の再取得の待機と失敗を確定結果として表示しないことを確認した。
初回取得失敗と、取得済み履歴の再取得失敗の双方で、再読み込み後の最新履歴が反映された。

合成SQLiteでは、既存migration 001〜004を適用したメモリーDBを使った。
一覧の3区分件数と既存概要SQLの総数・内訳を3プロフィールで比較し、勲功値の期待値を維持した。
読取り前後のプロフィール、発見物進捗、クエスト進捗、独立履歴の保存値が一致した。
複数関連と報告対象外について、既存SQLの結果から地図の判定保留と理由が得られることも確認した。

Rustコードと本番SQLは変更しておらず、Rust全テストは今回再実行していない。
実アプリの表示・操作はOwner確認待ちとし、実DB・CSV、本番・試用環境は操作していない。

## 差分の公開安全性と未実施の操作

`repo-publication-privacy`のD（通常開発）を適用した。対象は今回変更したソース・テスト・文書と新規ファイルである。
差分の目視確認と追加行の秘密情報・絶対pathパターン検査で、公開を妨げる混入は検出しなかった。テスト入力・期待値は合成値である。
判定はこの差分範囲でPASSとし、全履歴や成果物の公開監査を実施したとは扱わない。
依存・lockfile・ライセンス・出所・リンク方式・配布形式の変更はなく、ライセンスの再評価対象差分はない。

DB schema・migration、概要SQL・勲功値、進捗更新・履歴訂正APIは変更していない。
git add／commit／push、Release操作は実施していない。Ownerによる実アプリ確認を待つ。
