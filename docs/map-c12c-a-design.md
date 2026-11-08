# Map-C12C-A：GitHub Releases手動更新確認の監査・設計

## 1. 結論・作業範囲・現状

2026年11月8日時点の設計判定を **Map-C12C-A DESIGN READY** とする。標準fetchで固定GitHub APIを手動取得し、Windows x64配布物を確認してから更新案内を出す方式を推奨する。既定ブラウザー起動は既存の固定URL専用Rust処理を拡張する。HTTP／Opener／Updaterプラグインは第一案では追加しない。

今回作成するのは本書のみである。アプリコード、設定、依存、既存仕様書、Git履歴は変更しない。DESIGN READYは実装済み・実機検証済み・バイナリ公開承認済みを意味しない。WebView2との組合せの受入確認はMap-C12C-Bで行う。

| 開始条件 | 確認結果 |
| --- | --- |
| HEAD | `d17e76cceadce80925770423801bbca450a4e954` |
| branch | `feature/map-c12a-discovery-filters` |
| Map-C12B | 上記HEADへコミット済み |
| index／worktree | 開始時clean |
| アプリversion | package.json／tauri.conf.json／Cargo.tomlとも`0.3.0` |

調査対象は`AGENTS.md`、要件書、Map-C12B、AppShell・CSS・既存ポップオーバー、Tauri設定・capability・起動経路、外部リンク処理、配布・第三者ライセンスの現行正本である。`repo-publication-privacy`の通常開発モードDを適用し、日本語文書には`japanese-tech-writing`を適用する。Microsoft関連は`microsoft-licensing`に従って既存判断を継承し、同じCRTや開発資格を再監査しない。

現行構成は次のとおり。

- `AppShell.tsx`は`getVersion()`のPromiseをrefに保持し、取得成功時だけ右端に番号を表示する。通常の画面切替では再取得せず、StrictModeとアンマウントを考慮している。
- フッターはflex・折り返し・右寄せを使用する。既存文言は「データはこのPCのSQLiteに保存されます」。全体には既存の最小幅があり、今回その制約は変更しない。
- `tauri.conf.json`は`csp: null`、devUrlは`http://localhost:1420`。`default.json`の許可は`core:default`と`dialog:allow-open`で、HTTP／Openerは未導入である。
- `src-tauri/src/external_links.rs`は固定GVDB URLだけを引数なしcommandから`ShellExecuteW`で開く。`src/masterData/openGvdbSite.ts`はその薄いIPCアダプターであり、任意URLの起動機能ではない。
- `MasterInfoPopover.tsx`にはportal、viewport内の配置、Escape、外側クリック、フォーカス復帰を扱う非モーダル表示がある。挙動の参考にし、発見物・マスターデータ依存のProviderを更新確認へ転用しない。
- Rust起動は多重起動抑止、Runtime preflight、PortablePaths取得、使用許諾、Data Root準備、Tauri／DB初期化へ進む。更新確認をこの経路へ挿入しない。FrontendのNormal／Recovery分岐も変更せず、通常AppShell内だけに機能を置く。

### 既存仕様との相違

`docs/requirements.md`の5.13には「GitHubへの通信、最新バージョン確認、更新通知・ダウンロードは行わない」と明記されている。これはMap-C12Bの実装と一致しているが、今回の目標とは相違する。Map-C12C-Bでは「利用者が明示操作した場合だけ固定APIで確認し、配布物のある新版を案内する。自動通信・自動ダウンロード・自動インストールは行わない」へ改訂する必要がある。本書の設計を現行仕様の改訂済み事実として扱わない。

8.1のオフライン動作とAGENTS.mdのGVDB自動通信禁止は維持できる。基本機能をオフラインで完結させ、任意の手動更新確認だけを例外として仕様へ明記する。5.4のマスター説明・備考の外部アクセス禁止は、その表示機能に対する制約として維持する。確認範囲で、これ以外に今回の設計と衝突する規定は見つからなかった。

## 2. 通信方式の比較

| 評価項目 | A：WebView2の標準fetch | B：Tauri HTTPプラグイン |
| --- | --- | --- |
| 互換性 | 現行WebView2のWeb APIを使う。Debug origin／Releaseのアプリoriginで実測する | Tauri 2向けRust／JS plugin。採用版と現行Tauri・Rustの対応確認が必要 |
| CORS | 適用される。GitHub RESTは全originからのCORSを公式に提供 | Rustから通信するためブラウザーのCORSによる応答制限を受けない |
| CSP | WebViewの`connect-src`が制約になる。現状nullなので現行設定に通信先制限があるとは言えない | Rust通信先はCSPだけでは制限できず、plugin scopeを使う。WebViewのCSPを緩める理由にはしない |
| capability | Webのfetch用Tauri capability追加は不要 | fetch・送信・body読取・キャンセルを許可し、scopeを固定APIへ限定する必要がある |
| 通信先 | 入力を取らない固定endpoint＋CSP＋redirect拒否 | 固定endpoint＋URL scope＋redirect制限。scopeだけを設定して安全と判断しない |
| HTTPS | WebView2の通常の証明書検証。証明書エラーを回避しない | plugin／TLS backendの通常検証。danger設定による検証無効化は禁止 |
| redirect | `redirect: 'error'`で追跡せず失敗。応答後のURL検査だけに頼らない | `maxRedirections: 0`を指定。対応版では`scopeRedirects: true`も使用 |
| timeout／cancel | AbortControllerで全処理を中止。ヘッダー受信後のbody停滞も対象 | AbortSignal対応を採用版で確認。connectTimeoutだけではbodyを含む全体timeoutにならない |
| HTTPエラー | fetchがresolveしても200以外を明示判定。CORSによりstatusが読めない場合は通信失敗 | 同じHTTP分類を適用。OS側の通信失敗とHTTP応答を区別 |
| rate limit | 匿名IP単位。読み取れる応答ヘッダーだけ利用 | 同じGitHub側の制限。CORSに制限されずヘッダーを読めても、匿名枠は増えない |
| body／JSON | ReadableStreamで上限付き読取後にunknownとして検証 | JS APIのstream／cancel実装を確認して同じ上限を適用。全量読取しかできなければ第一案の代替にならない |
| 依存・通知 | 新規依存なし。既存WebView2利用条件を継承 | npm／Cargo依存・lock・plugin初期化・通知差分が増える。TLS・proxy・cookie等のfeatureも監査対象 |
| Vitest | fetch関数、Response stream、AbortSignalを注入／モック可能 | 通信アダプターをモック可能。Rust scope・TLS・redirectの保証はVitestだけでは検証できない |
| オフライン | 手動操作の失敗として局所表示 | 同じ。plugin導入でオフライン確認が成功するわけではない |

GitHubの[CORS仕様](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)は`Access-Control-Allow-Origin: *`を示す。これは標準fetchを選べる根拠だが、現在のWebView2・アプリoriginからの疎通を今回実測したものではない。

HTTPプラグインの[公式利用・許可仕様](https://v2.tauri.app/plugin/http-client/)と[JS実装](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/http/guest-js/index.ts)を確認した。特に[2.7.0の公式変更記録](https://v2.tauri.app/release/http/v2.7.0/)では、redirect先のscope照合がopt-inで追加されている。デフォルトの追跡を残したまま「最初のURLだけ許可」で運用しない。

調査時の上流v2ブランチでは、HTTP pluginのデフォルトfeatureにcookie・system proxy等が含まれる。[Cargo定義](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/http/Cargo.toml)のため、ブラウザーと同じ`credentials`指定だけで認証情報非送信を満たすと推測しない。代替案に進むならcookie機能を不要化し、proxy認証・OSの資格情報の扱いも確認する。[workspace定義](https://github.com/tauri-apps/plugins-workspace/blob/v2/Cargo.toml)はApache-2.0 OR MITだが、推移依存を承認済みとは扱わない。参照した可変ブランチは採用版を固定する証拠の代わりにはならない。

## 3. 推奨方式・最小権限・受入条件

第一案はAとする。GitHubのCORS対応、要求が固定の公開JSON取得だけであること、現在の依存を増やさないことが理由である。transportはUIから分離し、Bへの差替えのためだけの大規模な共通基盤は作らない。

通信先は次の一つだけとし、URL、owner、repo、tag、query、headerをUIやAPI応答から組み立てない。

```text
https://api.github.com/repos/guardiancrow/dol-progress/releases/latest
```

手動操作ごとに固定GETを最大1回送る。初回案の指定は`mode: 'cors'`、`credentials: 'omit'`、`redirect: 'error'`、`cache: 'no-store'`、`referrerPolicy: 'no-referrer'`、`keepalive: false`とAbortSignal。bodyは付けず、Acceptは`application/vnd.github+json`のみとする。Authorization、Cookie、個人名、メール、プロフィール、ファイルパス、現在のアプリ版を送信値として追加しない。

GitHubは有効なUser-Agentを要求するため、標準fetchではWebView2が付ける通常の値を使う。独自User-Agentや現在版を含むheaderへ上書きしない。[GitHubの要求header仕様](https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api#headers)を参照。X-GitHub-Api-Versionは推奨headerだが初回案では付けず、CORS preflightを必要としない単純GETにする。API形状の変化はJSON検証で失敗として扱う。版固定headerを採用する場合は、追加のOPTIONSとCORS対応をBの検証条件へ含める。

**通信のメタデータを隠せるという設計ではない。** 手動確認時にはGitHubや経路上のサービスへ送信元IP、User-Agent、Origin、Accept-Language等が伝わり得る。Cookie等のcredentialsは省略しても、全ネットワーク識別情報の非送信は保証できない。OS／組織proxyの自動認証等までアプリのfetch指定で一律に制御できるとは扱わず、その環境で厳密な認証非送信が必要なら別途確認する。既定ブラウザーを開いた場合は、そのブラウザーのCookie・認証・proxy設定に従う。ここをアプリの匿名API取得と区別して利用者へ説明する。「個人情報を送信しない」はアプリが個人・進捗データを収集・付加しない意味としてOwner確認を要する。IPも一切外部へ渡せない要件ならオンライン確認は成立せず、ネットワーク機能を追加しない案へ戻す。

### CSPの限定

capability追加は不要だが、固定文字列だけでは侵害されたWebView全体の通信先を制限できない。Bでは現在nullのCSPに対し、少なくともconnect-srcを限定する案を検証する。productionの候補は次の値である。

```text
connect-src 'self' ipc: http://ipc.localhost https://api.github.com/repos/guardiancrow/dol-progress/releases/latest
```

これは適用済み設定ではない。既存IPCを残す根拠は[Tauri公式CSPの例](https://v2.tauri.app/security/csp/)にある。`'self'`とIPCはアプリ内部用であり、外部HTTPSの許可は固定APIパスに限る。APIへqueryを付けない規則はコードでも検証する。CSPはfetchのmethod制限や認証非送信を代替せず、connect-srcだけの設定は画像・navigation等を含む完全な外向き通信禁止でもない。受信bodyや外部画像を描画しない設計と組み合わせる。

開発時は[devCsp](https://v2.tauri.app/reference/config/#securityconfig)で、現在のVite originと必要なHMR WebSocketだけを追加する。`ws:`、`https:`全体や外部host wildcardを許可しない。`TAURI_DEV_HOST`等の開発環境差が必要なら具体的なhost・portを確認し、許可を明示する。今回は既存CSPを変更しない。

Bの受入条件は、Tauri devとproduction frontendを埋め込んだDebug／Releaseそれぞれで、IPC・通常画面・ポップオーバー・開発時HMRを維持し、固定APIのCORS応答とredirect拒否が働くこと。ネットワーク検証用の隔離・合成環境だけを使い、実DBで試さない。外部疎通は任意の手動試験とし、Vitestや起動の必須条件にしない。

CORS・WebView2固有の制約でAが受入条件を満たせなければ、scopeを固定APIの完全URL一つへ限定したHTTP pluginを代替候補とする。`http:default`は必要なfetch／cancel／body操作の許可集合としてscope付きで使い、全hostを許可しない。TLS検証を維持し、redirectは0、対応版のscopeRedirectsも有効にする。採用版の互換性、cookie非送信、stream上限、ライセンス・Notices差分を確認してからOwnerへ採用判断を提示する。CORSを無効化するWebView起動flagやTLS検証回避は代替案にしない。

## 4. UI仕様と非同期制御

通常は右端の`v0.3.0`を常時表示し、押せることが分かる控えめなbuttonへ変更する。保存先文言を保持し、新しい常設ナビゲーションや設定項目は追加しない。version取得中・失敗時はC12Bの省略を維持し、代用の番号を固定しない。

Enter／Space／クリックで小さな非モーダル情報表示を開く。開くだけでは通信しない。内容は現在版、比較対象がGitHubのLatest指定通常版である旨、結果、「更新を確認」、閉じる操作とする。更新確認の直前に「GitHubへ接続します。進捗データは送信しません」と短く示す。初回の結果は「未確認」である。

| 結果 | 表示と動作 |
| --- | --- |
| 未確認 | 「未確認」。通信は行っていない |
| 確認中 | ボタンを「確認中…」として再操作を無効化。通常画面は利用可能 |
| 新版あり・対象配布物あり | パネルに公開版と「更新あり」。フッターにも控えめな「更新あり」を添える |
| 現在版と同じ | 「GitHubのLatest指定通常版と同じです」。全Release中の最大版とは断定しない |
| 現在版の方が新しい | 「このPCの版はGitHubのLatest指定通常版より新しいです」。downgradeを促さない |
| 更新確認失敗 | 原因区分に応じた短文。最新版・更新なしへ読み替えない |
| バージョン比較不能 | 「バージョン形式を比較できません」。無効・未対応形式を数値0へ補完しない |

比較結果と配布可否は独立した値とする。タグが新しくてもZIP／検証用hashが未提供なら、パネル内に「公開タグは現在版より新しいですが、対象のWindows x64配布物を確認できません」と表示し、フッターの「更新あり」や更新推奨は出さない。これは比較不能や同じ版という結果ではない。

同じ版・旧版・失敗の結果はパネル内だけに表示する。新版通知も自動でパネルを開いたり、モーダルやOS通知を出したりしない。再確認中は前の判定を現在結果として表示せず、再確認失敗時はフッターの更新案内を外して「確認できない」状態を明示する。結果は同じAppShell内のメモリーだけに保持し、DB・設定・localStorageへ保存しない。

buttonには「アプリケーション情報、現在のバージョン…」のアクセシブル名、aria-expanded／aria-controls／aria-haspopupを付ける。パネルは見出し付きの非モーダルdialogとしてaria-modalをtrueにせず、フォーカスを内部の操作へ移す。Tabを閉じ込めず、Escape・閉じる操作では起点へ戻す。外側クリックや外へフォーカスを移した際には閉じ、移動先からフォーカスを奪わない。取得完了だけでフォーカスを動かさず、結果にはaria-live="polite"を使用する。

パネルはフッター上側を優先してviewport内へ配置し、狭い幅では最大幅をviewport余白内、縦方向はスクロール可能にする。本文を押し上げない。buttonの高さはフッター用に限定し、既存button全体のmin-heightを変えない。version文字列の非分割・右寄せとフッターの折り返しを維持する。600／800／1920px幅、200%拡大、キーボード・スクリーンリーダーをBで確認する。

### 多重送信・取消し

通信はボタンのevent handlerからだけ開始し、mount、StrictModeのeffect、パネル表示、画面切替から開始しない。同期refのin-flight guardとbutton disabledの両方で連打を防ぐ。AppShell単位でAbortControllerとrequest世代を管理し、アンマウント時はabortし、その後の成功・失敗・finallyが別世代のstateやlockを更新しないようにする。

パネルを閉じても同じAppShellの手動リクエストは継続し、開き直しても増やさない。AppShell破棄時のabortは通常の通信エラーとして通知しない。request用timeoutだけを使用し、常駐intervalやポーリングは作らない。

## 5. Release・バージョン・配布物の判定

比較対象は固定latest APIが返す一つの通常公開Releaseとする。GitHubの[Releases API仕様](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)ではdraft／prereleaseを除いたReleaseが対象で、created_atと公開日時も同義ではない。公開側にはmake_latestの指定もある。**APIが返したReleaseを最大SemVerと仮定しない。** 一覧APIやページングで全Releaseを探索する機能はBに含めない。

公開運用として、配布可能な最大通常版をLatestに指定することを推奨する。ただしクライアントはそれを保証せず、返されたtagだけを現在版と比較する。任意の過去Releaseにさらに大きいSemVerが存在しないことまで証明する必要があるなら、別設計で一覧取得・対象期間・件数上限を定める。この限定はUI説明にも反映する。

判定順序は、HTTP／body検証、Release形状、通常公開の確認、tag解析、数値比較、配布物の確認、通知可否とする。`draft`と`prerelease`はbooleanのfalse、`published_at`は有効な公開日時の文字列を要求し、欠落・null・型違いを補正しない。GitHubから想定外のdraft／prereleaseが返れば通常版として扱わず、比較不能の理由を表示する。公開日時は公開済みの形状確認にだけ使用し、版の新旧判定には使わない。

初期のバージョン比較は次に限定する。現在版はC12Bで取得済みのgetVersion()の返値を使い、別のgetVersion()取得経路やpackage.jsonのfallbackを増やさない。

- 現在版はASCIIの`MAJOR.MINOR.PATCH`、公開tagは同じ形式に小文字`v`が0個または1個付く形式を受け入れる。各数値は0または0以外から始まる整数とし、先頭ゼロ、空白、符号、省略、小数、Unicode数字、大文字V、繰り返しvを受け入れない。文字列上限は128文字とする。
- major、minor、patchを左から数値で比較する。精度損失を避けるため整数部をBigInt等で比較し、辞書順やNumberへの無条件変換を使わない。`0.3.10 > 0.3.9`とし、commit SHA・created_at・published_atは番号比較に使わない。
- `-rc.1`等のprereleaseと`+build`等のmetadata付き番号は初回の比較対象外とし、「未対応のバージョン形式」と表示する。SemVerとして無効と断定せず、suffixを削ってstableへ変換しない。GitHubのprerelease=falseでもprerelease風tagをstableとして通知しない。
- 将来の完全SemVer対応では[SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)のprerelease順序・metadata非関与を別途実装・試験する。必要になれば比較ライブラリの採用差分を監査する。今回は新規依存を前提としない。

### Windows x64配布物

Release assetsは検査する。既存の`docs/release-build.md`とpackage scriptの命名規則に合わせ、公開tagから解析した通常版番号について次の二つを要求する案とする。

```text
DOL-Progress-Manager_<version>_windows-x64_portable.zip
DOL-Progress-Manager_<version>_windows-x64_portable.zip.sha256
```

各assetが一意に存在し、stateがuploaded、sizeが正の安全な整数であることを確認する。ZIPは既存Package上限の96MiB以内、外部hashは1KiB以内を初回の案とし、超過は配布未確認として扱う。source archiveのzipball_urlや名前にzipを含むだけのassetで代用しない。Content-Typeだけで配布物を認定しない。

assetの実体・hash本文はダウンロードしないため、この確認は配布物が公開metadata上にあることの確認に限る。hash照合、署名、ZIP内容、第三者通知や配布許諾の充足を保証しない。更新案内に「安全性検証済み」と表示しない。公開前の配布審査をクライアント側のasset検査で代替しない。

## 6. 通信結果・入力検証・エラー処理

設計上の初期値は、request開始からbody読取完了まで10秒、JSON bodyは展開後1MiB、assetsは最大256件とする。これらはGitHub側の上限ではなく、ローカル資源を守るためのアプリ側上限である。

200応答でもJSONとして妥当とは限らない。Content-TypeがJSON系であることを確認し、Content-Lengthが上限を超えれば早期拒否する。小さいContent-Lengthやその欠落は信用せず、streamのbyte数を積算して上限を超えた時点でreader cancelとabortを行う。bodyがない、不正UTF-8、不正JSON、必要field欠落・型違い、想定外の配列数は失敗として扱う。サイズを確認する前にresponse.json()／text()で全量を読まない。

JSONはunknownとして受け取り、tag_name、draft、prerelease、published_at、assetsと使用するassetのname／state／sizeを検証する。余分なfieldは無視し、Release本文、author、avatar、画像、Markdownは描画しない。表示する公開版は解析済み番号から生成し、Reactのtextとして表示する。dangerouslySetInnerHTMLや自動リンク化を使用しない。

requestはredirectを拒否する。成功応答でもresponse.redirectedがfalse、response.urlが固定endpointと一致し、opaqueでないことを追加確認する。最終URLを見てから拒否するだけでは別hostへの送信を防げないため、redirect: errorを省略しない。[Fetch標準](https://fetch.spec.whatwg.org/)に従う。redirectされたこと、DNS、TLS、CORSのいずれが原因かはブラウザーから判別できない場合があり、推測した原因を確定表示しない。

| 結果 | 取扱い |
| --- | --- |
| 200 | 上記のbody・shape・Release・version・assets検証へ進む |
| 403 | 制限またはアクセス拒否。rate-limit headerが読める場合だけ理由を補足。認証tokenを要求しない |
| 404 | 公開Release未提供・repo非公開等を区別できないため「公開Releaseを確認できません」。最新版とは表示しない |
| 429 | rate limitとして局所表示。待機条件を満たすまで送信しない |
| 500等の5xx | GitHub側の応答エラーとして表示。自動再試行しない |
| その他のstatus | 未対応のHTTP応答として失敗。304／204をキャッシュや空Releaseから補完しない |
| timeout | 「更新確認が時間内に完了しませんでした」。body受信が止まった場合も同じ |
| DNS／TLS／CORS／redirect等 | 取得失敗。オフラインと断定せず、通常機能は利用可能と伝える |
| API形状不正・過大body | 応答を確認できない旨だけを表示。生のbodyや例外をログ・画面へ転記しない |
| 比較対象外のtag | 通信失敗と区別し、バージョン比較不能とする |

GitHubの匿名REST枠は送信元IPに関連付けられ、通常60回／時である。他のアプリや同じ回線と共有し得る。[公式rate-limit仕様](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)を参照。1回ずつ直列実行し、通常操作にも前回開始から最低60秒の送信間隔を設ける案とする。これは枠の確保を保証しない。

403／429では、読み取れる有効なRetry-After、remaining=0時のX-RateLimit-Resetから送信可能時刻を計算する。CORSでheaderが見えないことも考慮し、判断できなければ最低60秒待つ。GitHubの[再試行指針](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately)に従い、自動再試行はしない。待機期限はメモリーに持ち、次の明示操作時に検査する。常駐timer、永続キャッシュ、ETag管理、/rate_limitへの追加通信は不要とする。待機中にボタンを押しても通信せず、パネル内へ待機の案内を出す。

## 7. 既定ブラウザー・公開とライセンスの境界

更新案内の「GitHub Releasesを開く」は次の固定URLを開く。

```text
https://github.com/guardiancrow/dol-progress/releases
```

推奨実装は引数なしの`open_releases_page` commandを`external_links.rs`へ追加し、固定URLを内部のWindows helperへ渡す構成である。既存のGVDB commandとそのURLは維持する。FrontendからURL・アプリ名・実行file・引数を受け取る汎用commandへ拡張しない。

現行build.rsはアプリcommandを個別ACLへ登録していない。[Tauriのcapability仕様](https://v2.tauri.app/security/capabilities/)では通常の登録済みアプリcommandはデフォルトでアプリのwindow／webviewから利用できる。`core:default`が固定URLを制限していると誤認しない。第一案では既存方式を踏襲し、引数なしcommandの内部定数を制限境界とする。remote URLへIPCを許可する設定も追加しない。全commandのACL移行は今回の対象外とし、command個別の追加ACLを要求する場合だけBのbuild.rs／permission設計へ明示的に加える。

Releaseのhtml_url、browser_download_url、assets_url、body中のリンクはブラウザー起動へ一切渡さない。リンクを解析して許可する処理自体が不要となる。URLを開くのも別の明示操作とし、取得成功から自動起動しない。既定ブラウザーが行うnavigation後のredirectはアプリ内API通信と別であり、アプリから最終遷移先を制御・保証するとは説明しない。

現行Windows専用処理で目的を満たせるためOpener導入は不要と判断する。将来必要になった場合は[Opener公式仕様](https://v2.tauri.app/plugin/opener/)に従い、`opener:allow-open-url`を固定Releases URL一つのscopeで許可し、opener:default、全https、mailto、file、任意openWithを許可しない。pluginの互換性と依存・ライセンスは採用時に差分評価する。

今回の設計では、Microsoftコード・toolchain・リンク方式・外部Runtime・同梱物・配布形式・使用許諾を変えない。`docs/third-party-licenses.md`の確認済み事項と、SDK受領者保護・合意方式、MSVC startupの個別再配布根拠、配布者本人判断の既存残件をそのまま継承する。更新確認や固定ブラウザーリンクの追加は、残件の解消やバイナリ公開承認を意味しない。新たなHTTP／Opener依存を採用する場合は、そのtarget／feature／Notices差分だけを再評価する。

| Privacyモード | 本機能との境界 |
| --- | --- |
| D：通常開発 | 今回は本書だけ。Bでは新規ソース・合成fixture・文書の機密混入を確認 |
| C：コミット | stage／commitを行う別の段階で実際のstaged diffとmetadataを確認。今回は実施しない |
| P：公開push | 実際の公開基点から新規履歴・refを確認。ソースのpushはバイナリ公開承認と別 |
| R：Release | 実際の配布byte・ZIP・hash・埋込み情報・公開metadataと既存配布gateを確認。更新通知を理由に省略しない |

Dの設計完了をC／P／RのPASSとして流用しない。公開範囲拡大ならIも別に適用する。クライアントは通常公開Releaseを読むだけで、GitHubへ書き込む権限やRelease公開操作を持たない。

## 8. Map-C12C-Bの変更予定ファイルと順序

| ファイル案 | 責務 |
| --- | --- |
| `src/components/layout/AppShell.tsx` | C12Bのversionを渡し、情報表示・更新状態を接続。version取得を重複させない |
| `src/components/layout/AppVersionInfo.tsx`（新規案） | 小さな非モーダル表示とアクセシビリティ。DB・プロフィールに依存しない |
| `src/updates/version.ts`（新規案） | tag解析と整数比較の純粋関数 |
| `src/updates/checkRelease.ts`（新規案） | 固定fetch、timeout、上限付き読取、JSON・Release・asset検証。UI／DBから分離 |
| `src/updates/useUpdateCheck.ts`（新規案） | 手動開始、世代・in-flight・abort・結果・待機期限。状態が小さければ情報コンポーネント内に置く |
| `src/updates/openReleasesPage.ts`（新規案） | 固定の引数なしIPC呼出し |
| `src/App.css` | フッター用button、非モーダル表示、新版の控えめな表示だけ |
| `src-tauri/src/external_links.rs`、`src-tauri/src/lib.rs` | 固定Releases commandと登録。起動処理の順序は維持 |
| `src-tauri/tauri.conf.json` | connect-srcとdevCspの限定案。受入試験を通して確定 |
| 関連Vitest・Rust単体テスト | 下記の合成・モック試験 |
| `docs/requirements.md`、必要に応じREADME、本書／Bの検証記録 | 手動通信の例外・利用者説明・実測結果 |

第一案ではpackage.json、npm／Cargo lock、Cargo.toml、capability、schema／migration、進捗repository、consent／preflightへ変更は不要。Rustに追加するのはOSの既定ブラウザー起動に必要な処理だけであり、比較や通知判断はTypeScriptで行う。

実装順は、仕様改訂の確定、純粋な比較・asset判定、上限付きtransport、非同期制御、UI、固定リンクcommand、CSPの順とする。全Vitest・型検査・Vite・Tauri Debug／Releaseを検証し、最後に隔離環境でWebView2／CSPと実寸UIを確認する。まだ実装・テスト実行・ビルドは行っていない。

## 9. 合成データとHTTPモックのテスト計画

| 区分 | ケースと期待結果 |
| --- | --- |
| 数値比較 | 現在0.3.0／公開v0.3.1はnewer、0.3.1／v0.3.1はsame、0.4.0／v0.3.1はolder。0.3.9／v0.3.10を正しく比較 |
| tag解析 | vなし、先頭ゼロ、空白、省略、符号、Unicode、大文字V、過長、巨大整数、非string。補完せず明示判定 |
| 将来形式 | currentまたはtagのprerelease／metadataは未対応。GitHub flag=falseでもsuffixを削らない |
| Release条件 | draft／prerelease=true、boolean欠落・型違い、latestがSemVer最大と異なる合成例。対象外を最新版と表示しない |
| Release未公開 | 404を「確認できない」とする。未公開・非公開を断定せず、更新なしとしない |
| assets | 正式ZIPと外部sha256、ZIPなし、hashなし、source archiveだけ、別version／arm64、重複、未uploaded、size不正・過大。比較結果と通知可否を分離 |
| transport | 起動・パネル表示・StrictModeでfetchが0回。操作後に固定GETが1回。認証・query・bodyなし、credentials／referrer／redirectの指定 |
| timeout | ヘッダー前、body stream途中の停滞を含む10秒timeout。reader cancel、abort、timer解除 |
| 接続失敗 | DNS／TLS／CORS相当のreject。判別不能な原因を断定せず、通常画面は利用可能 |
| HTTP | 403／404／429／500と未知status、204／304。Retry-After・Resetあり／不可視／不正、再試行待機、追加通信なし |
| body検証 | 不正JSON、必要field欠落、JSON以外、空body、不正UTF-8、Content-Length偽装／欠落、chunk合計超過、assets過多 |
| 多重送信 | 同じevent turnの連打、確認中の再操作、パネルを閉じ再表示、待機期間内の再操作で通信を増やさない |
| lifecycle | 通信中にアンマウント、abort後の遅延resolve／reject、別世代のfinally。state・lockへ旧応答を反映しない |
| 回帰 | 通信不能でもフッター文言、version、ナビゲーション、検索・進捗操作を阻害しない。実DBへの呼出しがない |
| 表示安全性 | tag／bodyにHTML、script、改行、悪意あるURL。HTML・外部画像・Markdownとして解釈しない |
| 外部リンク | html_url／asset URLがjavascript、file、別host、userinfo、偽装subdomain、悪意あるredirectでも使わず、固定・引数なしcommandだけ呼ぶ |
| UI／支援技術 | Enter／Space、Escape、Tab、外側クリック、フォーカス復帰、非モーダル、live通知、常時version、600／800／1920pxと拡大表示 |
| platform受入 | 合成・隔離環境のDebug／ReleaseでCORS、stream abort、redirect拒否、CSP、IPC、HMRを確認。固定リンクは明示した試験操作時だけ開く |

Vitestではfetchと時計を注入・モックし、合成Response／ReadableStreamを使用する。実GitHub、GVDB、実DB、CSV、プロフィール値から期待値を作らない。Rust単体テストではOSのブラウザーを実際に開かず、固定URLと既存helperの戻り値境界を確認する。OS呼出しを伴う表示確認は自動テストと分離する。

## 10. 未決事項・Owner判断・監査結果

| 項目 | 推奨案／Bへ進む条件 |
| --- | --- |
| 仕様の改訂 | 要件書5.13を手動確認だけの例外へ改訂する。今回は未変更 |
| 匿名通信の意味 | アプリは個人・進捗データとcredentialsを付加しない。IP等の不可避な通信metadataが伝わることをOwnerが確認 |
| Latestの範囲 | GitHubのLatest指定版との比較に限定する。全履歴の最大SemVerを保証する機能は追加しない |
| 通知対象 | 正式命名のWindows x64 ZIPと外部sha256の両方がある新版だけを案内する。公開運用もこの命名とLatest指定を合わせる |
| 比較形式 | 初回は通常の3整数だけ。prerelease・metadata対応は後続課題 |
| 資源・操作制限 | 10秒／1MiB／assets 256件／60秒送信間隔を初期値とする。実測で不足があれば根拠付きで見直す |
| WebView2／CSP | BでDebug／Releaseと開発時HMRの受入条件を検証する。今回の資料確認だけで実測成功とは記録しない |
| plugin代替 | Aが受入条件を満たさない場合だけ、固定版・scope・TLS・cookie・ライセンス差分を確認して提案。自動導入しない |
| 公開運用と権利 | 実際の公開Release・assetの存在と、バイナリ公開の既存承認・条件は別に確認する。設計完了から公開GOを導かない |

公式資料の確認は行ったが、外部参照ツールでは指定latest APIの本文を取得できなかった。この結果から404、Release未公開、repo非公開のいずれかを認定していない。実際の現在のRelease・assetsは未確認であり、アプリからの疎通も未実測である。公開済み配布物があることを設計成立の前提にせず、未提供時の扱いを上記に定めた。

技術的な重大障害は今回の調査では見つかっていない。標準fetchの具体的な受入条件と、安全性を緩めない代替案があり、実装計画として成立する。未決事項はBの仕様確定・受入条件として残す。

本書は非公開値を含めず、URLはユーザーが指定した公開用endpointと公式一次資料だけを記載する。Dモードの対象はこの新規文書のみで、目視・秘密情報／絶対pathパターン検査の範囲では混入を検出せず、判定はPASSとする。開始HEADから既存の追跡ファイルとindexに差分がなく、新規ファイルが本書一つであることを確認した。既存ソース・設定・依存・ライセンス・Git履歴への変更はない。実データ、アプリの起動、テスト実行、ビルド・配布工程、Git add／commit／push、Release公開は実施していない。C／P／R監査や過去の署名・許諾の再判定も行っていない。
