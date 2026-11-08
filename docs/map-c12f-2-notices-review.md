# Map-C12F-2：v0.4.0正式Noticesの限定差分レビュー

## 結論と対象

判定は **Map-C12F-2 OWNER DECISION READY** とする。新しい承認は行っていない。
既存の通常依存と通知の大部分は継承できる。必要な更新はRust標準ライブラリの適用版・N200の版・N201の提供元通知、CSP関連4件の除外理由、通知見出し、今回の承認証跡と参照hashに限定できる。
Ownerは後述の範囲を承認したうえで更新結果を確認する。現状のPREPARED入力を、そのままREVIEWEDへ変更するだけでは不足する。

2026年11月8日、`release/v0.4.0-preparation`の`ed86f4d85a7499992644387c9a630524a075c25c`から開始した。
Map-C12Fはこのcommitへ保存済みで、開始時のindex・worktreeはcleanだった。
AGENTS.md、repo-publication-privacyのDモード、microsoft-licensing、Release・Notices正本を適用した。
Map-C12Fの585件のVitest、型検査、関連PowerShell試験、Debug／Releaseビルド成功を継承し、今回は再実行していない。

本書の追加以外にコード・設定・依存・Notices・承認状態・Git履歴を変更していない。正式Compile／Package／独立Verifierも実行していない。
これは通知入力の限定レビューであり、Microsoft契約の判断、バイナリの公開承認、最終EXEの全byte包含の証明ではない。

## 1. v0.4.0へ継承できる範囲

比較基点を次のように区別した。

| 基点 | 意味 | 現在までの確認結果 |
| --- | --- | --- |
| `5587413b54c782fa243a3095e5e43269b5860892` | 公開v0.3.0 tagの対象commit | Cargo／npm lockの変更はアプリ版だけ |
| `4396ff971bbb4b543ead88dd51ae7a077d7cb69f` | Noticesの過去のレビュー基点 | 通常依存package名・versionの追加／削除なし。source feature等は別途確認 |
| `0221a705beeca9b638e85e5170eb19f5a22ec064` | Map-C12F開始基点 | 5ファイルの版更新。依存構成の変更なし |

Cargo.lockはdol-progress-managerの`0.3.0`から`0.4.0`への1値、npm lockはtop-levelとroot packageの2値だけが変更されている。
依存crate／npm packageの版、checksum、resolved、依存recordの変更はない。Rust自身の標準ライブラリ依存はこのアプリのCargo.lockに含まれず、後述の別比較が必要である。

targetはWindows x64 MSVCのままで、build.rsの動的CRT指定、SQLite bundled、WebView2 Loader、外部Runtime、固定5ファイルのPortable ZIPという配布構成は不変である。
CRT・リンク方式の再解析や全依存の再収集は不要と判断する。正式ビルド後のpayloadとtoolchainの実測は別工程である。

featureがすべて不変だったとは扱わない。公開v0.3.0／旧レビュー基点からはwindows-sys 0.59の`Win32_Security`と`Win32_System_Threading`が通常依存のfeatureへ追加されている。
既存N164の同じwindows-sys版に含まれるAPI bindingの利用拡大であり、crate版・通知原文・CRT指定・Runtime同梱の変更はない。既存N164の通知を継承する案とする。
TauriのCSPはnullから非nullへ変わった。これを依存版の不変性と混同せず、第4節でhost／target経路を確認した。

既存201通知・6除外のうち、N196–N201とCSP関連4除外以外の原文・coverage・除外判断は、上記の条件に対して継承する。
過去のreviewer／reviewed_at、approval_basis／formal_review、旧source_head・通知由来commit、旧toolchain_refreshは当時の記録として保全する。

## 2. Toolchain変更の評価

| 要素 | 旧記録 → 現候補 | 評価・必要な判断 |
| --- | --- | --- |
| rustc | 1.98.0 → 1.99.1 | 標準ライブラリ・compiler builtinsの適用版が変わる。第3節の証拠で更新する |
| cargo | 1.98.0 → 1.99.1 | ビルドツール本体は配布しない。lockは不変。候補fingerprintと既存locked／offlineビルド結果を採用する判断 |
| Node.js | v24.20.0 → v26.13.0 | Node本体は非同梱。固定されたVite等を実行するhost。Node版の変更だけでNodeの全原文をZIPへ追加しない |
| npm | 11.19.0 → 11.20.0 | npm本体は非同梱。install／updateは行わず、既存scriptを実行。依存lockの変更と区別する |
| Tauri CLI | 2.11.4 → 2.11.4 | 不変。CLI本体とFrontendのAPI packageを混同しない |
| Windows PowerShell | 旧承認5.1.26100.9444 → 既存候補5.1.26100.9711 | mappingの候補と今回は同じ。過去の更新候補を含め、runner実行環境として承認対象にする |

Node等の実行結果による生成byteは最終ビルド・Privacy Rの対象になるが、host実行ツール本体が配布EXEへ含まれることを意味しない。
Frontend helperの版・通知条件は既存lockとcoverageを継承する。PowerShell本体やMSVC／SDKのファイルを新しく同梱する計画はない。

正式手順の6要素による現候補fingerprintは`03bc8eeb02bfd006cf7f72f4bf5f4e4110eac9ccd96ad3f2c0d1e961ac9272da`である。
旧承認の`4283dd97…`、PowerShellだけを更新した既存候補の`e2123b4c…`とは別の承認対象になる。旧承認日時を新環境の承認日時へ書き換えない。

## 3. Rust N196–N201の確認結果

### 配布元と確認方法

現在のrustcは1.99.1、commitは`58cf8f9c35b355199727627d07ae34a4e2846d67`、hostはx86_64-pc-windows-msvcである。
インストール済みrust-src、標準ライブラリのCargo.lock、Rust配布物の著作権文書・licenseを対象にした。
`lib/rustlib/multirust-channel-manifest.toml`は2026-10-15配布の1.99.1を指す。`COPYRIGHT-library.html`はrust-docsではなく、rustc componentのfile manifestに記載されている。
[Rust公式の1.99.1発表](https://blog.rust-lang.org/2026/10/15/Rust-1.99.1/)と固定commitの原文も照合した。

`<sysroot>`はインストール済みtoolchain rootを意味し、本書にはOwner固有の絶対pathを記録しない。
次の確認は読取のみで、原文を通知入力へコピー・更新していない。

| record | 現候補の証拠・差分 | 推奨処理 |
| --- | --- | --- |
| N196 Unicode | 固定commitのLICENSES/Unicode-3.0.txtと既存原文がbyte一致。配布物の同licenseも一致。著作権表示は1991–2024のまま | 原文を継承。適用rustc版と新しい出典証拠だけ追記 |
| N197 compiler builtins | rust-src内のcompiler_builtinsは0.1.160。LICENSE.txtは既存原文・固定commitの原文とbyte一致 | 原文・license条件を継承。1.99.1への適用を記録。実装byteが不変とは主張しない |
| N198 std等 | 固定commitのLICENSE-APACHE・LICENSE-MITは両方とも既存原文とbyte一致。配布元通知のin-tree license／copyright部分も旧版と一致 | 原文・既存copyrightを継承。適用commitを追記 |
| N199 hashbrown | 標準ライブラリCargo.lockでも0.17.1。現配布元通知のMIT／Apache本文は既存2原文と外側空白除去後に一致 | 原文と版を継承。新toolchainとの対応証拠を追加 |
| N200 rustc-demangle | 標準ライブラリCargo.lockで0.1.27 → 0.1.28。現配布元通知のMIT／Apache本文は既存2原文と外側空白除去後に一致 | inventory・mappingの現適用版を0.1.28へ更新。license本文の再収集は不要 |
| N201 provider NOTICE | COPYRIGHT-library.htmlのpackage版・一覧とraw hashが変化。旧原文全体を1.99.1の文書として扱えない | 新しい提供元原文を追加し、旧原文・旧レビュー証拠を残して現候補との対応を更新 |

N199／N200の比較は、HTML内pre要素から取り出した本文と既存原文の比較である。registry archiveのraw byte一致を確認したとは扱わない。
N196–N198の固定commit原文はUTF-8 byteのSHA-256も照合した。

| 証拠 | SHA-256 |
| --- | --- |
| N196 Unicode（既存原文を継承） | `f5062c9a188d81dfe66b56db4182dcf9e4b17c0d9b0d311a8e20b3a1b075c443` |
| N197 compiler builtins（継承） | `ab6eec6caf0fa5775e411c7a8bc6a45c4ef2956b0980b157ab74fc5cd62a928b` |
| N198 Apache（継承） | `62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a` |
| N198 MIT（継承） | `b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1` |
| 現rust-src library/Cargo.lock | `53d9ccff0c906de434b65af90d5c30063894b940fc839261f1fb06ef2e69e3d3` |
| N201旧原文 | `68129500b616d5838629e68f55ff3aed5e096dacf60ce9eb41bbe599a563afa6` |
| N201現配布元原文（1,499,465 bytes） | `5647be074c8edf7339fd863055923a8fc80bc5610a8d4661ec3b767b9d392c27` |

原文の公開参照先は[Unicode](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/LICENSES/Unicode-3.0.txt)、[compiler builtins](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/compiler-builtins/LICENSE.txt)、[MIT](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/LICENSE-MIT)、[Apache](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/LICENSE-APACHE)、[標準ライブラリlock](https://github.com/rust-lang/rust/blob/58cf8f9c35b355199727627d07ae34a4e2846d67/library/Cargo.lock)である。
N201は`<sysroot>/share/doc/rust/COPYRIGHT-library.html`を使用した。公式docのversion付きURLでの追加取得は404だったため、Web取得成功とは記録しない。
Rust公式配布archiveの再ダウンロードやarchive全体のhash検証はしていない。既存インストールの配布manifestに属する文書を読取り、上記hashで候補を固定した。

### N201の限定差分

provider文書のpackage見出しは142件から141件になった。共通131件の本文は同一で、次の10組はversion表示が変わるがlicense式とlicense本文は同一だった。

| package | 旧 → 現 |
| --- | --- |
| dlmalloc | 0.2.13 → 0.2.14 |
| gimli | 0.32.3 → 0.34.0 |
| itertools | 0.14.0 → 0.15.0 |
| libc | 0.2.185 → 0.2.189 |
| moto-rt | 0.16.0 → 0.16.4 |
| rand | 0.9.2 → 0.9.5 |
| rustc-demangle | 0.1.27 → 0.1.28 |
| unwinding | 0.2.8 → 0.2.10 |
| wasip2 | 1.0.3+wasi-0.2.9 → 1.0.4+wasi-0.2.12 |
| wasip3 | 0.6.0+wasi-0.3.0-rc-2026-03-15 → 0.7.0+wasi-0.3.0 |

rand_core 0.9.3の項目は現文書にない。他versionのrand／libc等は残るので、package名だけで同一項目を選ばず、旧版から消えたversionと新versionを対応付けた。
in-tree部分のlicense／copyrightは同一で、旧N201.coverageの全copyright文字列も現文書に存在した。変更したpackage表示に新しいlicense種別・条件本文の差分は検出していない。
これは提供元のpackage-wide文書の差分であり、WASI／Unix等の全項目がWindows EXEへ入るという判断ではない。

## 4. CSP関連4件の除外判断

現行targetに対し、各packageを明示して次の読取を実施した。全コマンドはexit 0だった。

```text
cargo tree --locked --offline --target x86_64-pc-windows-msvc -e features -i <package> --depth 3
cargo tree --locked --offline --target x86_64-pc-windows-msvc -e normal,no-proc-macro -i <package>
cargo tree --locked --offline --target x86_64-pc-windows-msvc -e features -i tauri-utils
```

| package | 確認した経路 | 通常target経路 |
| --- | --- | --- |
| cssparser 0.37.0 | dom_query 0.28.0／selectors 0.38.0 → tauri-utilsのhost HTML処理 | なし |
| cssparser-macros 0.7.1 | proc-macro → cssparser 0.37.0 | なし |
| selectors 0.38.0 | dom_query 0.28.0 → tauri-utilsのhost HTML処理 | なし |
| dtoa-short 0.3.5 | cssparser 0.37.0 | なし |

tauri-utilsのhtml-manipulation-2はbuild-2／tauri-build・tauri-codegen等のhost build／proc-macro側で有効であり、通常target側にはない。
CSPの固定connect-src文字列を生成・埋め込むことと、hostで動くCSS parserの実装コードをtargetへリンクすることは別である。
現構成に限り4件のincluded=falseを継承する根拠は十分と判断する。4件の原文・coverageを新規included通知として追加する必要は見つからなかった。

旧exclusion_reasonの「CSP null」は現在と一致しない。また「dom_query/html-manipulationなし」はtarget側に限定しないとhostの実測と矛盾する。
次工程では、旧理由をhistorical evidenceへ残し、現行理由を「Windows x64の通常target dependency経路なし。host build／proc-macroのHTML処理。CSPは非nullで、nullを除外条件にしていない」とする案を推奨する。
将来、対象packageが通常target経路へ入るfeature／依存変更があればこの判断を再評価する。最終EXEの逆解析や全byte不在検証は今回の対象外である。

## 5. Owner承認後の更新計画

以下は実行計画であり、本フェーズでは適用していない。
既存の原文148種類と元の承認証跡は保持し、N201の新しい提供元原文を追加する方式を第一候補とする。
旧provider原文は履歴参照と明示し、1.99.1の現原文と取り違えない。

| ファイル・field | 必要な更新 |
| --- | --- |
| THIRD-PARTY-NOTICES.txt | 独自の先頭見出しが現在も0.3.0なので0.4.0へ変更。N196–N201の適用版・参照表示を整合。旧原文のbyteを保持し、新N201原文を全文追加 |
| release/notices/texts/5647be…txt | 第3節の新provider原文をraw byteのまま追加し、完全なhash名・実hash・byte数を照合。既存原文を同名で上書き・削除しない |
| inventory.components[N196–N201] | 適用Rust版を1.99.1へ。N197のbuiltins 0.1.160・N199の0.17.1は維持。N200だけ0.1.28へ。N201の現commitを58cf8f9c…へ対応付ける |
| review.coverage[N196–N200] | license・required_texts・copyrightを継承し、現toolchainへの照合証拠を追加 |
| review.coverage[N201] | 旧required_textを残し、新provider原文のpath／sha256と根拠を追加。copyrightは既存文字列が現原文にもあることを根拠に継承 |
| review.coverageの4除外record | included=falseを維持。旧exclusion_reasonを歴史証拠に保全し、現構成の理由とCargo tree証拠を追加 |
| mapping.json | 現在のrecords・formal_review等を過去の証拠として保全。release_refresh等の別項目に現recordへの対応、現toolchain、照合hash、除外理由の更新証拠を追加。旧toolchain_refreshも保持 |
| review.release_refresh | 実際のOwner承認者・日時・対象SHA／証拠hash・条件を新規記録。旧reviewer／reviewed_at／approval_basisを新承認で上書きしない |
| source.json | 現通知sha256とlock hashを照合。source_commitは元の通知由来として保全し、新本文の由来はsource_updates等で新しい通知を収めたcommit・配布元commit／原文hashへ追跡可能にする。旧由来だけで現本文全体を説明しない |
| v0.4.0-preparation.json | 当時のPREPARED証跡は保持。新レビューを追記または別の版付き証拠へ分離し、当時のsnapshotを承認済みと書き換えない |
| manifest.json | 更新後のinventory／review／source／noticesの実hashを再計算。lock hash、toolchain hashも再照合。source_headは過去のレビュー基点として保持し、新承認の基点は別項目へ記録 |
| docs/third-party-licenses.md、release-build.md、検証報告 | 過去と現承認、現toolchain、原文数・参照数、正式3工程未実行を整合させる |
| scripts/tests/release-inputs.tests.ps1 | 旧coverage完全一致、148原文／357参照の固定検査は今回の正当な更新で失敗する。承認したrecord・fieldだけの差分を許し、他recordの保全と新hash・原文全文収録を引き続き検査するよう更新 |

追加方式なら通知recordは201、除外6のまま、required_textの種類は149・参照は358となる見込みである。mappingの旧coverage値は過去の結果として残し、現集計は別項目で示す。
現通知3,693,605 bytesに新原文1,499,465 bytesを加えても、見出し等を除く計5,193,070 bytesで16MiB上限以内である。更新後の実bytesと上限は再検証する。
新provider原文に正式gateが拒否する未完成markerは検出せず、旧copyright文字列の不足もなかった。

古いsource／review commitを機械的に現在HEADへ変更しない。新本文を記録したcommitが必要な箇所は、そのcommit確定後に由来を追記し、最終cleanな署名checkpointで入力全体を固定する。
既存gateは新fieldの意味まで自動保証しないため、更新後の差分レビューと入力試験で新証拠を確認する。試験の固定期待値だけを変更して無条件に成功させない。

## 6. Ownerが明示的に承認する事項

1. 通常依存・target・動的CRT・Portable配布構成の不変部分と、既存windows-sys通知をv0.4.0へ継承すること。
2. Rust/Cargo 1.99.1、Node 26.13.0、npm 11.20.0、Tauri CLI 2.11.4、Windows PowerShell 5.1.26100.9711を採用し、旧PowerShell更新候補も含めた新fingerprintを正式入力に使うこと。
3. N196–N199の原文継承、N200の0.1.28への適用更新、新N201提供元通知の追加と旧証拠の保全方式。
4. CSP関連4件を、現行Windows x64のhost-only経路に限って除外継承し、null前提の理由を現証拠へ更新すること。
5. 第5節の更新後、実hash・原文収録・限定差分が整合することを条件として、新しいNoticesの承認を記録すること。

これは原文・包含候補・条件表示・出典・toolchainを対応付けた限定承認である。Microsoft関連のSDK受領者条件・合意方式、MSVC startupの個別再頒布根拠、配布者の補償等の既存未解決判断はそのまま残す。
公開承認、全原文の逐語レビュー、特定の最終バイナリの安全性を承認対象へ自動追加しない。

## 7. REVIEWEDへ進める条件と終了状態

Ownerの限定承認後に第5節を適用し、原文保全・新provider原文のhashと全文収録、record／版・除外理由、参照hash、toolchain fingerprint、新承認の対応を確認する。
確認した範囲の未決事項だけを解消し、その後にmanifest.status・review.status・source.formal_review_stateをREVIEWEDへ進める。PREPAREDを単に置換する操作は採用しない。
旧REVIEWEDの事実、旧レビュー日時と証拠は履歴として維持し、legal_clearance／public_release_approvedは自動変更しない。

最終的な署名付きclean HEADからの正式Compile → Package →独立Verifier、Privacy R、合成旧DBからmigration 004を含む更新smoke、残余UI確認・公開判断は別工程である。
Map-C12Fのテスト成功を、新原文追加後や正式3工程の成功へ読み替えない。更新時は影響する入力検査・Notices／Package試験を実施し、実際に生成した成果物を検証する。

今回のDモード対象は本書だけで、秘密情報・Owner固有path・実DB／CSV・非公開バックアップは含めていない。全履歴・全依存・全ライセンスの再監査はしていない。
git add／commit／push、toolchain更新・downgrade、tag、Release、正式ビルド操作は行っていない。PREPAREDは変更せず、Owner判断用の本書を未stageで保全する。
