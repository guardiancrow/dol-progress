# Map-C12C-B：GitHub Releases手動更新確認の実装・検証

## 開始条件と結論

2026年11月8日、`feature/map-c12a-discovery-filters`の`f5724cef7fe2574e5be7bdb0dedc2c3d7cef8ac4`から開始した。
Map-C12C-Aの設計報告書は上記HEADへコミット済みで、開始時のindex・worktreeはcleanだった。新しいブランチは作成していない。
正本の設計、AGENTS.md、repo-publication-privacyを確認し、通常開発モードDを適用した。

判定は **Map-C12C-B LOCAL PASS** とする。標準fetchで実装し、隔離環境のDebug／ReleaseでOwnerの明示操作による実GitHub疎通を確認した。
開発時CSPとHMRも実測して確認した。HTTP／Opener／Updaterプラグインは追加していない。

## 実装範囲

Map-C12BのgetVersion()取得はそのまま使用し、フッターのバージョンをアプリケーション情報のボタンに変更した。
保存先文言とversionの常時表示を維持し、パネルを開くだけでは通信しない。
「更新を確認」のevent handlerだけが固定GitHub APIを取得する。結果・待機期限はメモリーに保持し、DBや設定へ保存しない。

取得先は`https://api.github.com/repos/guardiancrow/dol-progress/releases/latest`だけである。
GET、credentials omit、redirect error、referrerPolicy no-referrer、cache no-storeを指定し、body・認証header・個人／進捗データを付加しない。
10秒の全体timeout、展開後body 1MiB、assets 256件を上限とする。
Content-Lengthだけを信用せずstreamのbyte数を積算し、上限超過・取消し時はreaderを中断する。
403／429の有効な待機headerを反映し、通常は60秒間隔とする。自動再試行・常駐timerは追加していない。

Release形状・公開日時・draft／prerelease・tag・assetを検証し、通常の3整数をBigIntで比較する。
prerelease、metadata、不正形式をstableへ補完しない。比較するのはLatest指定版一つであり、全Releaseの最大SemVerとは表示しない。
新版かつ正式命名のWindows x64 ZIPと外部SHA-256が一意に存在し、uploaded・有効sizeの場合だけフッターへ「更新あり」を表示する。
配布物の掲載確認と、その内容・hashの安全性検証は区別して説明する。

未確認、確認中、新版あり、同じ版、現在版が新しい、配布物未確認、比較不能、通信失敗を区別する。
同期in-flight guard、AbortController、世代管理を使い、連打と破棄後の古い応答を排除する。
パネルは非モーダルで、Escape、閉じる、外側操作、フォーカス復帰、aria-live、幅に応じた配置へ対応する。
通信失敗を最新版として表示せず、通常画面をブロックしない。

ブラウザー起動は既存Windows処理を再利用した引数なし`open_releases_page` commandとする。
固定の`https://github.com/guardiancrow/dol-progress/releases`だけを開き、APIのhtml_urlやasset URLを渡さない。
Release本文・画像・Markdownを描画しない。IP等の通常の通信メタデータがGitHubへ伝わり得ることを画面とREADMEで説明する。

## 仕様・現行構成との相違と対応

設計時に確認した要件書5.13の「GitHubへの通信・更新確認は行わない」を、利用者による手動確認だけの限定例外へ改訂した。
8.1にも同じ例外を明記した。自動通信・ダウンロード・インストール、GVDB自動取得・書込み、進捗データ送信は禁止のままとする。
起動・Runtime preflight・同意処理・Data Root解決・DB初期化の順序は変更していない。

開発時の実測では、現在のWindowsデスクトップ構成でVite配信画面にdevCspだけではCSPが適用されなかった。
ローカルのTauri 2.11.5実装も確認し、Vite側のContent-Security-Policy headerに同じdevCspを設定した。
Tauri設定だけで開発時の制限が有効だとする設計上の想定を、この実測に基づいて補った。設定の一致はVitestでも確認する。

また、既存Vite watcherが作業用tmp内の隔離WebView一時ファイルを監視し、ロックされたfileへのwatchでEBUSYとなって停止した。
tmpだけを監視対象から除外し、ソースのHMR監視は維持した。これら以外の仕様とコードの不整合を網羅的に監査したものではない。

## 自動検証結果

| 項目 | 結果 |
| --- | --- |
| 全Vitest | 43ファイル・585件成功（今回96件追加） |
| TypeScript | npm run typecheck成功。最終Debug／ReleaseのbeforeBuildでも成功 |
| Vite production build | npm run build成功（Tauri beforeBuildで実行） |
| Tauri Debug | npm run tauri -- build --debug --no-bundle -- --locked --offline成功 |
| Tauri Release | npm run tauri -- build --no-bundle -- --locked --offline成功 |
| Rust変更部分 | cargo test --locked --offline external_links -- --nocapture：1件成功 |
| Rust整形 | cargo fmt -- --check成功 |
| 空白検査 | git diff --check成功 |

数値比較、巨大整数、無効tag・suffix、draft／prerelease、公開日時不正、assets欠落・重複・別版・別architecture・state・sizeを合成データで検証した。
transportでは固定URLと全request option、HTTP 403／404／429／500・未知status、retry header、DNS／TLS／CORS相当のreject、redirect・最終URL不一致を確認した。
ヘッダー前とbody停滞のtimeout、1MiBちょうどの許容・超過、偽Content-Length、不正UTF-8・JSON・shape、stream cancelも確認した。

UI・hookでは起動／StrictMode／パネル表示時の通信0回、連打、60秒とserver待機期限、古いresolve／reject、破棄時abort、パネル開閉中の処理維持を確認した。
各結果の区別、新版以外の通知抑止、オフライン相当の失敗時の操作継続、HTML非解釈、悪意ある受信URLの不使用、引数なし固定commandを検証した。
キーボード開閉、フォーカス復帰、外側へ移動した際の非拘束、非モーダル属性、aria-liveもDOMで確認した。
既存全テストも成功し、進捗・集計・履歴の変更は加えていない。例外系テスト等のstderr出力はあるが、最終実行でテスト失敗はない。

Rust全テストの再実行はしていない。変更した外部リンク部分を対象にし、OSブラウザーは単体テストから実起動しない。

## 隔離環境での実機検証

ビルドしたEXEを毎回新規のtmp配下へコピーし、既存DB・config・CSVはコピーせず、新規の空DBだけを起動処理で作成した。
同意完了状態は隔離専用の合成record fixtureで用意した。これは既存recordによる起動経路の試験であり、Ownerの契約判断・実ユーザーの同意証跡として扱わない。
WebView2のユーザーデータ領域もprocess環境変数で専用の新規領域へ分離した。製品の保存先・起動コードは変更していない。
正常起動後の診断はlocalhostだけのDevTools接続を使用し、製品に診断用ネットワーク設定を組み込んでいない。

| 実機項目 | Debug（組込みfrontend） | Release（組込みfrontend） | 開発時（Vite） |
| --- | --- | --- | --- |
| version | v0.3.0 | v0.3.0 | v0.3.0 |
| 通常起動・IPC | プロフィール初期表示成功 | プロフィール初期表示成功 | 初期表示・data_root_status成功、隔離rootを確認 |
| 起動／パネル表示時のGitHub通信 | 0件 | 0件 | 0件 |
| 実GitHubの手動GET | Owner操作で1件、HTTP 200 | Owner操作で1件、HTTP 200 | 実GitHub通信は行っていない |
| 実応答の比較 | Latest指定通常版と同じ版 | Latest指定通常版と同じ版 | 合成テストで結果判定を検証 |
| CSP許可外host・path | connect-srcで2件拒否 | connect-srcで2件拒否 | header補完後、connect-srcで2件拒否 |
| HMR | 対象外 | 対象外 | WebSocket handshake 101とCSS HMR更新を確認 |

DebugではOwnerから、1回目が「GitHubのLatest指定通常版と同じ版です」、2回目が待機案内だったとの回答を得た。
観測した固定APIへのresourceは1件だけで、2回目の操作では増えていない。
ReleaseでもOwnerが同じ版との結果を確認した。HTTP 200と表示が一致し、通信失敗や未確認を同じ版へ読み替えたものではない。

CSPは設定文字列だけでなく、実際に配信されたpolicyとsecuritypolicyviolation eventを確認した。
別hostのexample.invalidと、同じapi.github.com内の許可外pathを拒否した。
診断時は万一CSPを通過しても外部送信しないよう対象テストURLをDevToolsで遮断する保険を置いたが、補完後はCSP違反で拒否され、遮断側への到達は0件だった。
この試験から、全Web APIやnavigationを含む完全な外向き通信禁止まで保証するものではない。

productionのconnect-srcはself・Tauri IPC・固定GitHub APIのみとし、HMRのWebSocketは含めていない。
開発時は同じ制約にlocalhost／127.0.0.1の1420番WebSocketだけを追加した。
TAURI_DEV_HOSTによる別host・1421番HMR等の開発overrideは検証対象外で、現行policyでは包括許可しない。必要になれば具体的な接続先だけを別途確認する。

Release版のパネルはviewport 600×600、800×600、1920×1080で上下左右が画面内に収まり、versionを保持することを実測した。
専用スクリーンリーダーの実際の読み上げ、OS／ブラウザーの200%拡大操作は今回未実施であり、ARIAのDOM試験と幅変更試験を代用の実測結果として記載しない。

実GitHubが返した版は現在版と同じだったため、実サーバー上の新版あり・配布物不足・各HTTPエラーを発生させる試験は行っていない。
これらは合成Responseで確認した。DNS／TLS障害もモックであり、OSの信頼ストアやネットワーク設定を変更した障害注入は行っていない。
配布ZIPやhash本文は実機試験でもダウンロードしていない。既定ブラウザーでのOS起動はOwnerの追加操作に委ね、commandと固定URLは自動テストで確認した。

実機疎通後、Retry-AfterのHTTP-date対応と境界試験、version buttonのアクセシブルな説明への現在版表示を追加した。最終ソースで全VitestとDebug／Releaseビルドを再実行した。
これらの局所変更後の実GitHub再送は行わず、既存の200応答・CSP・UIに関する実測と、最終ソースの合成試験・ビルドを区別する。

## 変更ファイル

- `src/components/layout/AppShell.tsx`、`AppVersionInfo.tsx`：既存versionを再利用する情報表示と操作。
- `src/App.css`：フッター用buttonと非モーダル表示の配置。
- `src/updates/version.ts`：通常版の解析・整数比較。
- `src/updates/checkRelease.ts`：固定GET、timeout・stream上限、外部入力・Release・asset検証。
- `src/updates/useUpdateCheck.ts`：明示開始、連打・待機期限・世代・破棄の制御。
- `src/updates/openReleasesPage.ts`：固定の引数なしIPC。
- `src-tauri/src/external_links.rs`、`src-tauri/src/lib.rs`：固定Releases commandと登録。
- `src-tauri/tauri.conf.json`、`vite.config.ts`：production／devのCSPとtmp監視除外。
- `src/components/layout/AppVersionInfo.test.tsx`、`src/updates/checkRelease.test.ts`、`useUpdateCheck.test.tsx`、`openReleasesPage.test.ts`、`securityConfiguration.test.ts`、`testFixtures.ts`：合成試験とfixture。
- `docs/requirements.md`、`README.md`、本書：限定的な手動通信の仕様・利用者説明・検証結果。

変更は20ファイルである。capability、依存・lockfile、バージョン、schema・migration、データ保存先・同意・preflight・進捗処理は変更していない。
隔離起動・DevTools診断用の一時scriptと合成生成物はignoredのtmp内に保持し、公開ソース差分に含めない。

## Privacy・ライセンスと終了状態

Dモードの対象は今回の新規・変更ソース、合成テスト、文書である。追加行と新規ファイルを目視し、秘密情報・絶対pathの限定パターン検査でも混入を検出しなかった。
Owner専用path、実DB・CSV、個人・進捗データ由来の期待値、認証情報を追加していない。判定はこの差分範囲でPASSとする。
全Git履歴・ビルド成果物の公開監査を実施したとは扱わず、C／P／Rの承認に流用しない。

新規依存、第三者コードの取り込み、リンク方式・toolchain・配布形式・ライセンス本文への差分はない。
既存Microsoft関連の未解決条件を解決済みへ変更していない。固定Windows APIの既存利用を引き継ぎ、再頒布承認やRuntime同梱は追加していない。
バージョンは0.3.0を維持し、SSH署名設定も変更していない。

実DB・実CSV、本番・試用環境は操作していない。git add／commit／push、Release公開・Package操作も実施していない。
隔離アプリと検証用Viteを終了し、合成fixtureは削除せず保持した。Ownerによる実アプリの追加確認とコミット判断を待つ。
