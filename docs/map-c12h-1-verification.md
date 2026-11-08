# Map-C12H-1：Portable ZIP日時の互換性修正

2026年11月8日。判定は **Map-C12H-1 ZIP TIMESTAMP FIX LOCAL PASS**。
ZIP生成・独立検証・合成試験・正式手順を修正した。Windows Explorerの表示確認は未実施として分離し、正式3工程と公開操作は実施していない。

## 開始状態と変更範囲

- branch：`release/v0.4.0-preparation`
- HEAD：`8b887c1b17a96c0c047cbc2c16c3ead8423c5935`
- 開始時のindex／worktree：clean
- `git verify-commit`：既存のSSH署名で成功。署名設定は変更していない。

変更ファイルは次の6件である。

| ファイル | 内容 |
| --- | --- |
| `scripts/portable-package-safety.ps1` | 確定SHAのcommitter UNIX秒を取得し、writer用のUTC日時を算出する。1980年固定代入を撤廃 |
| `scripts/build-portable-package.ps1` | Source gateで得たcommitter UNIX秒をwriterと検査へ渡す |
| `scripts/verify-portable-package.ps1` | 独立したC#変換で期待DOS日時を算出し、全local／central headerを照合する |
| `scripts/tests/portable-package.tests.ps1` | 日時・再現性・独立性の試験と、既存fixture／呼出しを更新 |
| `docs/release-build.md` | UTC暦値の規約、制限、旧ZIPの扱い、正式再実行条件を更新 |
| 本書 | ローカル検証結果と残余確認を記録 |

従来の`docs/release-build.md`には1980年固定の契約があり、今回のOwner指示と一致しなくなったため、writer・Verifierと同時に改訂した。過去のMap-C12G／C12Hの記録は当時の証拠として保全した。clipss2のコードを転用した変更ではなく、今回明示された日時方針に従ってDOLの既存処理を修正した。

## 日時の契約と独立検査

署名・clean条件を通過したsource HEADに対し、`git show -s --format=%ct <SHA> --`でcommitter UNIX秒を取得する。author日時や現在時刻は使用しない。writerはUTCの暦値へ変換し、秒を2秒単位へ切り下げた同じ値を全5memberへ設定する。

入力の許容範囲は1980-01-01T00:00:00Z〜2107-12-31T23:59:59Zである。上限の奇数秒は23:59:58となる。範囲外、空文字、不正形式、整数overflowはZIPを作成する前に拒否し、1980年等へ自動補正しない。1980年そのものはDOSの下限として有効だが、現在のsource日時と異なる旧固定値は不適合となる。

独立Verifierも自身のSource gateで確定SHAからUNIX秒を取得する。writerのPowerShell変換結果やPackage metadataを信用せず、C#で別にUTC→DOS date／timeを算出する。localとcentralが互いに一致するだけでは足りず、全5件がその期待値と一致することを要求する。検査は展開前に行う。

標準ZIPはタイムゾーン情報を持たず、ここで格納するのは**source revision由来のUTC暦値**である。ビルド日時やZIP作成日時を表さない。実行PCのタイムゾーンや現在時刻を参照せず、timestamp extra fieldも追加しない。展開先のタイムゾーンをまたぐ厳密な実時刻の再現までは保証しない。

開始HEADを実際に読み取る補助確認では、UNIX秒`1794134299`、UTC`2026-11-08T10:38:19Z`から`2026-11-08T10:38:18+00:00`を得た。これは開始HEADに対する例であり、今後の正式工程にはOwnerが確定する新しい署名付きHEADを使用する。

## ローカル検証

正式手順で使用するWindows PowerShell 5.1で検証した。

| 検証 | 結果 |
| --- | --- |
| `scripts/tests/portable-package.tests.ps1` | 134件成功、失敗0 |
| `scripts/tests/release-tooling.tests.ps1` | 60件成功、失敗0 |
| `scripts/tests/release-inputs.tests.ps1` | REVIEWED入力・原文・承認証拠・hash照合に成功 |
| `npm run typecheck` | 成功 |
| `git diff --check` | 成功 |

Portable試験では次を確認した。

- 合成の2024-01-02T03:04:05Zが03:04:04へ切り下がり、全5件のlocal／centralのDOS dateとtimeが独立計算した定数に一致する。
- 直前の偶数秒と奇数秒でZIP bytesが一致する。同じ入力の再生成でも全ZIP hashが一致する。
- UTC、+09:00、-08:00で表した同じ元時刻から同じUNIX秒・ZIPを得る。stagingの更新日時を変更してもZIPは変わらない。OSのタイムゾーン変更試験は行っていない。
- 日時だけを変えたZIPを独立に展開・CRC検査し、全payloadとSHA256SUMSのhash不変を確認する。header日時以外のbyteも完全一致する。
- 範囲の上下限を受け入れ、範囲外・overflow・不正形式をwriter／独立Verifierの両方が拒否する。
- 各memberのcentralのみ／localのみの不一致、不正DOS日付、sourceと異なる整合済み日時を拒否する。
- writer側の日時変換を故意に1980年固定へ置き換える合成試験でも、独立Verifierが拒否する。
- 固定5件・順序・Deflate・CRC・hash・manifest・PE・上限・危険構造・Privacy・衝突・reparse・Notices／source／toolchain等の既存拒否試験も成功する。

試験PCは`Tokyo Standard Time`（UTC+09:00）である。.NET標準ZIP readerは全5件を2024-01-02 03:04:04として読み取り、合成ZIPの新規フォルダーへの.NET展開後も、ファイルシステムの更新日時が同じ暦値となることを確認した。payload hashも一致した。これはWindows Explorerの表示・展開の実測とは区別する。

Windows標準の圧縮フォルダー表示と「すべて展開」で、更新日時が空欄・1899年等にならないことは**Owner手動確認事項**として残す。既存Runtimeの導入済み環境で確認でき、新規ユーザー・Sandbox・VM・Runtime導入は必要としない。

アプリコード・依存・バージョンには変更がないため、全Vitestと製品のTauriビルドは反復していない。正式Compile／Package／独立Verifierも実施していない。上記はTEST_ONLYの合成ZIP・resource-only PEに対する試験で、配布候補の生成・認定ではない。

## 保全と次工程

Map-C12Gのrun、旧ZIP、外部SHA-256、EXE、Map-C12H報告書は保全した。旧ZIPのSHA-256は`4bd05bbd2eb4a32739c9f0d6bc06b7956455e9d8f6a96130313da6af2c572fef`、旧EXEは`0a73c9749135dbec8b13eb5748a8f5c51ab6e712fc0ed56a5b6bd00957c4dbad`のままである。旧ZIPは公開候補として使用しない。

正式Noticesは201通知・6除外、149原文・358参照、REVIEWEDの承認証拠を維持した。通知正本hashは`93bd33f8353c7375cf8d9612e18ccbeb976f37165315d3f485b4050dc8cbb855`で不変である。toolchainの採用条件、アプリ、DB／migration、Consent、使用許諾・依存・版番号は変更していない。

Owner確認後に署名付きcommitとclean HEADを確定し、新HEADから正式Compile → Package → 独立Verifierを新runで実行する必要がある。旧run・ZIP hash・PackageIntegrity PASSを新ZIPへ流用しない。新しい実byteのPrivacy Rと必要な最終smokeも、その成果物へ結び付ける。

今回のコード・テスト・文書の変更範囲にPrivacy Dを適用し、秘密情報・Owner固有path・実データの追加を検出しなかった。全Git履歴や無関係なignored領域は探索していない。依存・リンク方式・配布構成・第三者原文への変更はなく、ライセンスの再評価トリガーはない。Microsoft関連の既存未解決事項と`public_release=NOT_AUTHORIZED`を維持する。

git add／commit／push、tag、正式3工程、GitHub Release操作は行っていない。HEADを変更せず、変更は未stageのままOwner確認待ちで停止する。
