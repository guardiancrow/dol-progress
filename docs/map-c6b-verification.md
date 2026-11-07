# Map-C6B：地図のオファー都市表示の実装・検証

## 開始条件とデータ契約

2026年11月7日、`feature/map-report-hold`の`f8bd60b`から開始した。
Map-C6AのWindows Named Mutexは同commitで保存済みで、開始時の作業ツリーはクリーンだった。

Ownerは、地図のCSVの「オファー都市」が、その地図を取得できる都市の情報として利用できることを確定した。
複数都市は半角カンマ区切りであり、元のCSVの登録内容を正本とする。
陸地再調査報酬を受け取る場所とは区別し、都市値がない場合は備考などから推測して補完しない。
Map-C6の意味未確定・表示見送りという判断は過去の監査記録として保存し、現行契約への案内を追記した。

## 使用した既存のデータ経路

`quests.csv`の「オファー都市」は、`normalizeQuestTable()`が`offerCity`へ取り込み、全列を`rawRowJson`にも保持する。
保存後はRustの`quest_facets::parse_offer_cities()`による半角カンマ分割・trim・空要素除去を経たfacetも存在する。
`QuestRepository.listWithDiscoveries()`が元文字列と都市facetを既にまとめて読み取り、`QuestsPage`が`offerCity`と`offerCities`を行モデルへ渡している。

今回は`QuestTable`で取得済みの行モデルだけを使う。元文字列の`offerCity`を優先し、nullの場合だけ`offerCities`を使う。
空文字・空白・カンマだけの元文字列を、別の値や備考から補完することはない。
表示helperは半角カンマで分割し、trim後の空要素を除き、最初の出現順で重複を除外して「、」で連結する。
元の文字列・配列は変更しない。DB読取り、N+1、再import、保存値や既存filterの変更はない。

## 表示と共通部品

既存の`matchesOfferMethod(..., "group:map")`による7学問分類の判定を再利用する。
地図に都市があれば、既存ポップオーバーの備考より前へ「オファー都市」を追加する。
備考もあれば両方を表示し、備考なしでも都市があれば「i」を表示する。両方が空なら表示しない。

`MasterInfoPopover`には任意の`details`を追加し、地図にだけ項目を渡す。
通常クエストは従来どおり備考だけを表示し、備考がなければ「i」を表示しない。
発見物一覧・関連発見物・関連クエストには都市項目を渡さず、従来の説明・備考を維持する。
新しいdialogや専用画面は追加していない。

都市がある地図の情報ボタンは、内容に応じて「オファー都市を表示」または「オファー都市・備考を表示」と読み上げる。
クリック・Enter・Spaceによる表示、`aria-expanded`／`aria-controls`、Escapeと閉じる操作、元のボタンへのfocus復帰は既存処理を使う。
表示文字列はReactのtextとして描画する。

CSS、列定義、行高、地図状態selectは変更していない。
ポップオーバーは既存の幅・最大高さと`overflow-wrap: anywhere`を使い、長い都市名を折り返す。
備考と都市のために横幅や最大高さを拡大する変更はない。

## 変更ファイル

- `src/components/quests/QuestTable.tsx`：地図だけに都市の追加情報と適切なアクセシブル名を渡す。
- `src/components/MasterInfoPopover.tsx`：任意の追加項目を表示内容・ボタン表示条件に含める。
- `src/quests/mapOfferCities.ts`：地図の判定と都市の表示用整形。
- `src/quests/mapOfferCities.test.ts`：元文字列優先、整形、無変更、既存の地図分類の確認。
- `src/components/quests/QuestOfferCities.test.tsx`：表示条件、他の情報との分離、操作、filterの独立性の確認。
- `docs/data-import.md`：Owner確定の都市の意味と表示規則。
- `docs/requirements.md`：Map-C6Bの表示仕様と既存の都市説明の改訂。
- `docs/map-c6-audit.md`：過去の監査結果と現行契約の区別。
- `docs/map-c6b-verification.md`：本検証記録。

## 自動検証結果

| 検証 | 結果 |
| --- | --- |
| TypeScript全テスト | 36ファイル、419件成功（追加31件）。`npm test -- --reporter=dot` |
| 関連テスト | helper・都市UI・既存MasterInfoPopoverの3ファイル、53件成功 |
| TypeScript型検査・Vite build | `npm run build`成功。`tsc --noEmit`を含む |
| Tauri Debug build | `npm run tauri -- build --debug --no-bundle -- --locked --offline`成功 |
| Rust回帰テスト | 今回は未実行。Rust／DBの差分はなく、Debug buildでコンパイルを確認 |
| Release build | 今回は未実行。Ownerが必要に応じて実施する |

追加テストは単一・複数・欠落・空白・空要素・重複、備考との全有無の組合せを確認した。
都市だけの場合のクリック・Enter・Space、Escape、閉じる、focus復帰も確認した。
非地図クエスト、共有部品を使う発見物、都市filter、地図状態を含む既存の回帰テストも成功している。

## FHDの合成ブラウザープレビュー

headless Edgeの専用profileと合成fixtureを使い、1920×1080で実コンポーネントと既存CSSを描画した。
通常アプリやDBを起動せず、基点commitの旧`QuestTable`と変更後の`QuestTable`へ同じ合成入力を渡して比較した。
全4行の高さと全9列の幅は修正前後で一致した。
ストレス入力の60都市によって既存の都市列が折り返す場合も、その行高は修正前と同じだった。

7都市のポップオーバーは幅480px、長い60都市と備考を併記した場合も幅480pxで、都市段落の横方向のはみ出しはなかった。
長い一覧はポップオーバー内で折り返され、全都市と備考が保持されていることを画面でも確認した。
ブラウザーのキーイベントによるEscapeでの終了と元ボタンへのfocus復帰も成功した。
画像・測定結果はignoredの`tmp/map-c6b/fhd-cities.png`、`fhd-long-cities.png`、`visual-results.json`へ保存した。
使用したのはこの作業専用のブラウザープロセスとprofileだけである。

これは合成ブラウザー表示の確認であり、通常のTauriアプリの実画面・Ownerの実データによる確認とは区別する。
OwnerはFHDの通常アプリで、都市だけの地図、備考との併記、複数都市、Escape／focus復帰、既存filterを最終確認する。
コードと自動検証の未解決事項はない。通常Tauri実画面の確認と必要時のRelease buildはOwner確認事項として残す。

## 保護対象と整合性

Rust全体、Map-C6AのMutex、DB schema／migration、SQL、進捗・初回報告履歴・冒険勲功値・地図取得判定は変更していない。
プロフィール、都市filter、バックアップ・復元、H1/H2の修復処理も変更していない。
本番・試用ポータブル環境、保全コピーB・C・Dと実CSVへアクセスせず、合成データだけを使った。
新規libraryや依存・lockfile・配布形式の変更はなく、ライセンス監査対象の差分はない。
Git add／commit／push、merge／rebaseは行っていない。

文書の都市の意味と今回のOwner指示の不一致は、`data-import.md`と`requirements.md`の契約を明示的に改訂して解消した。
`map-c6-audit.md`の過去の結論は書き換えず、現行契約への案内を追加した。
リポジトリ全体の整合性を網羅的に監査したものではない。
