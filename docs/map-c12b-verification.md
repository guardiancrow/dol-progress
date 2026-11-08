# Map-C12B：実行中バージョンのフッター表示

## 開始条件

2026年11月8日、次の状態から開始した。新しいブランチは作成していない。

| 項目 | 開始時の値 |
| --- | --- |
| HEAD | `cc34b133e7b3f550a427a87aaea4da1e88549174` |
| branch | `feature/map-c12a-discovery-filters` |
| Map-C12A | 上記HEADへコミット済み |
| Git状態 | index・作業ツリーともclean |
| worktree | 登録済み一つ |
| `package.json` | `0.3.0` |
| `src-tauri/tauri.conf.json` | `0.3.0` |
| `src-tauri/Cargo.toml` | `0.3.0` |

`AGENTS.md`と更新済みの`repo-publication-privacy`を確認し、通常開発モードDを適用した。
既存のSSH署名設定は読み取り確認だけを行い、変更していない。
対象コンポーネント、CSS、Tauri設定・capability、バージョン設定、関連テスト・要件書を確認した範囲で、今回の要求との矛盾は見つからなかった。

## バージョン取得と権限

既存の`AppShell`内で、Tauri 2の公式APIである`@tauri-apps/api/app`の`getVersion()`を使用する。
インストール済みAPIの実装も確認し、`plugin:app|version`を呼ぶ非同期APIであることを確認した。
設定ファイルから番号を読み取ってReactへ埋め込む処理や、固定のバージョン文字列は追加していない。
APIの定義は[Tauri公式のapp API](https://v2.tauri.app/reference/javascript/api/namespaceapp/#getversion)を参照。

既存capabilityには`core:default`がある。公式の[Core Permissions](https://v2.tauri.app/reference/acl/core-permissions/)とローカルの生成済み`acl-manifests.json`で、
`core:default` → `core:app:default` → `allow-version` → `version` commandの許可を確認した。
capabilityとTauri設定は変更しておらず、新しい権限を追加していない。

## 実装範囲

既存フッターの「データはこのPCのSQLiteに保存されます」をspanで囲み、APIが返した番号を右側に`v`付きで表示する。
表示の色・文字サイズ・既存のフッター文言は維持した。フッターだけにflex配置と折り返しを設定し、バージョン文字列は分割せず右寄せする。
ナビゲーション、ヘッダー、本文のレイアウト規則は変更していない。

取得はeffect内で開始し、起動や通常画面の描画を待たせない。取得中と失敗時はバージョンを省略する。
取得Promiseは同じ`AppShell`のrefに保持し、画面切替とStrictModeのeffect再実行で再取得しない。
effectのcleanup後はstateを更新しない。失敗はそのPromiseのハンドラーで処理し、アプリ全体のエラーや再試行へ変換しない。
Tauri bridgeが存在しないブラウザでも、実際のAPIが返すrejectionを処理する。

変更は次の5ファイルに限定した。

- `src/components/layout/AppShell.tsx`：非同期取得とフッター表示。
- `src/App.css`：フッター内の配置・折り返し。
- `src/components/layout/AppShell.test.tsx`：合成・モック環境による9件のテスト。
- `docs/requirements.md`：5.13へ表示・取得・失敗時の契約を追加。
- 本書：開始条件、検証結果、安全性確認の記録。

## 自動検証

| 検証 | 結果 |
| --- | --- |
| 関連Vitest | 1ファイル・9件成功 |
| 全Vitest | 38ファイル・489件成功 |
| TypeScript型検査 | `npm run typecheck`成功。TauriのbeforeBuildでも成功 |
| Vite production build | TauriのbeforeBuildで`npm run build`成功 |
| Tauri Debug build | `npm run tauri -- build --debug --no-bundle -- --locked --offline`成功 |
| Tauri Release build | `npm run tauri -- build --no-bundle -- --locked --offline`成功 |
| Debug／Release EXEのversion resource | 両方のFileVersion・ProductVersionが`0.3.0` |
| 空白検査 | `git diff --check`成功 |

関連テストは、`0.3.0`と合成の別バージョンをAPIから返し、返値に対応する表示を確認した。
Promiseが未完了でもフッターと本文を表示し、画面を切り替えられることを確認した。
rejection後も文言・本文・ナビゲーションが維持され、アプリ全体のエラーや自動再取得が発生しないことを確認した。
Tauri bridgeのないjsdom環境では、モックから元の`getVersion()`実装を呼び出して安全な省略を確認した。

StrictModeでは成功・失敗の両方で取得が1回であることを確認した。
アンマウントした旧画面のPromiseが後で成功・失敗しても、新しい画面のバージョン表示を置き換えないことも確認した。
ナビゲーションの現在位置、本文のworkspace用classと既存フッター文言を維持した。
狭い幅への対応はCSSの折り返し・右寄せ指定を差分レビューした。jsdomは実寸レイアウトを計算しないため、実アプリの幅変更・表示確認はOwner確認事項として残す。

既存テストにはstderrへ例外を出力するケースがあるが、全Vitestの最終実行で失敗はない。
Rustのコード・本番SQLは変更しておらず、Rust全テストは今回再実行していない。

## データ・公開安全性と残存事項

2026年11月8日、開始HEADからの変更コード・テスト・文書と新規ファイルをDモードの対象として確認した。
差分の目視と秘密情報・絶対pathパターン検査で、秘密情報・Owner固有値・実データの追加は検出しなかった。
テストは合成値を使用し、実DB・CSV、本番・試用環境は操作していない。
判定は今回のソース差分範囲でPASSとし、全Git履歴やビルド成果物の公開監査は対象に含めない。

依存・lockfile・ライセンス・出所・リンク方式・配布形式への変更はなく、ライセンス再評価を要する差分はない。
アプリの`0.3.0`、DB schema・migration、データ保存場所、起動・同意処理、SSH署名設定は維持した。
GitHub通信、更新確認・通知、自動ダウンロード、新規設定項目は追加していない。

ビルドはローカルのコンパイル検証として行い、アプリの実起動・実データを使う検証は行っていない。
git add／commit／push、Release公開・Package操作は実施しない。OwnerのDebug／Release表示確認後にコミットを判断する。

ローカルの実装・自動検証の判定は **Map-C12B LOCAL PASS** とする。残る確認は、OwnerによるDebug／Release実アプリのフッター表示と幅変更時の見え方である。
