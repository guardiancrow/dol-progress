# Map-C9R2：公開版ソースの回帰検証

2026年11月7日のMap-C9R2検証結果を、公開用の要約として整理した。
非公開の保全情報・個別移行記録・内部監査台帳は掲載しない。
本書は機能検証の記録であり、バイナリ配布や本番DB移行の承認ではない。

## 機能とデータの契約

現在の報告状態と初回報告履歴を分離し、再発見後も過去の報告履歴を保持する。
地図の再入手抑止は現在の有効未報告状態から判定し、初回履歴や勲功値資格から推定しない。
分類別の現在未報告と3区分の和を確認し、港・集落／伝承の表示例外、気象・現象、レリック、分類NULLの既存契約を保持する。

migration 001〜004のbytesとchecksum、勲功値条件、プロフィール分離、transaction・rollback、Data Root、backup・Recovery、使用許諾、Windows Mutex、都市popoverの一般機能を維持した。
個別の実データ修復処理は公開版に含めず、[履歴の合成検証](map-history-handover.md)を残す。

## 合成試験の安全性

memory supportは内部factoryの`:memory:`接続だけを受け付け、外部handleを拒否する。
SQLite authorizerでATTACH・VACUUM INTO等を拒否し、実ファイルDBへの更新入口を設けない。
この合成試験はNode.js 24.10以降を必要とする。未対応環境では制限を外して継続しない。

## R2での実行結果

| 検証 | 結果 |
| --- | --- |
| TypeScript全テスト | 37ファイル・472件成功 |
| 型検査・Vite build | 成功 |
| Rust全テスト | 259＋11件成功、4件ignore、doc-test成功 |
| Rust整形 | 成功 |
| 履歴の公開版合成試験・memory境界 | 27件成功 |
| migration 004互換・backup／復元 | 合成DBで成功 |
| Tauri Debug／Release回帰build | 成功。EXEは起動・公開していない |

合成試験の初回はauthorizerがmigration 004の読取り専用quick_checkも拒否し、8件失敗した。
必要なquick_checkだけを許可し、外部DBへの制限を維持して27件成功を確認した。
通常GUI・FHD再描画・実DB移行はこの回帰検証に含めていない。

新しい公開コミットと独立環境の検証結果は、本書の過去の結果とは分けて確認する。
通常Release buildの成功は正式Compile／Package／Verifierの合格を意味しない。
[既存ライセンス条件と未解決事項](third-party-licenses.md)を保持し、バイナリ公開は別途判断する。
