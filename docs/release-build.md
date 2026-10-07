# Windows release build

Windows maintainer 向けに、Rust/Cargo の source paths が配布 application binary に残ることを防ぐ手順を定める。通常の development build は変更しない。application version は0.3.0のままとする。

## 前提

Windows PowerShell 5.1以降または Windows 上の PowerShell 7を使用する。Node/npm、Rust、Tauri は現在の project と lockfiles に従い、npm dependencies と Rust toolchain/dependency cache を事前に準備する。build は `--locked --offline` で Rust dependency の更新・download を行わない。npm scripts と Tauri CLI が実行できる PATH、Git、および通常の Windows build prerequisites が必要。

MSI の WiX ICE 検証には Windows Installer service にアクセスできる通常の Windows host execution context が必要。制限された execution sandbox では service access に失敗する場合がある。script は昇格、UAC bypass、policy変更、ICE検証の無効化を行わない。

## Build

repository root から実行する。script 自身は自身の位置から repository root を解決するため、別の working directory からも呼び出せる。dot-source はせず、script として実行する。

```powershell
& ./scripts/build-release.ps1
# rustc invocation / fresh rebuild の証拠を詳しく残す場合
& ./scripts/build-release.ps1 -VerboseBuild
if ($LASTEXITCODE -ne 0) { throw 'Release build failed' }
```

`CARGO_HOME` は process environment を優先し、未設定の場合だけ Windows の `%USERPROFILE%\.cargo`（profile environment も未設定なら OS の UserProfile directory）を使用する。`RUSTUP_HOME` は process environment を優先し、未設定なら installed `rustup show home` の結果を使用する。解決不能または directory 不存在なら停止する。credentials/config の内容は読まない。

相対 home は repository root を基準に full path へ解決する。明示した absolute home の separator/case/spelling は維持し、slash・dot-segment等の正規化が必要な値は診断して停止する。適切な full Windows path を caller が指定する。解決した homes は child process にも同じ値を設定する。host固有 path は repository に固定しない。

`RUSTFLAGS`、`CARGO_ENCODED_RUSTFLAGS`、`CARGO_TARGET_DIR` が non-empty なら停止する。暗黙の merge/overwrite はしない。Cargo config に設定した追加 flags とも併用する手順ではなく、encoded flags の優先順位を理解した maintainer が release environment を確認する。

4 tokens `--remap-path-prefix`, `<resolved Cargo home>=/cargo`, `--remap-path-prefix`, `<resolved Rustup home>=/rustup` を U+001F で結合し、process-local `CARGO_ENCODED_RUSTFLAGS` に渡す。workspace remap は現在の実測で不要なため追加しない。rustc は textual replacement を行うので、virtualized paths の separator は混在し得る。

process-local `CARGO_TARGET_DIR` は `<repo>\tmp\release-build\target`。Git ignore を確認してから使用する。通常の development target や過去の実験出力は使用しない。新しい target では dependencies も再コンパイルされる。再実行時は同じ flags の Cargo cache を使用できる。全 target の cargo clean はしない。

通常の `npm run tauri -- build --bundles nsis msi -- --locked --offline` を呼び出す。`beforeBuildCommand` が typecheck と frontend build を実行する。出力は以下。

- application EXE: `tmp/release-build/target/release/dol-progress-manager.exe`
- NSIS: `tmp/release-build/target/release/bundle/nsis/`
- MSI: `tmp/release-build/target/release/bundle/msi/`

build 成功・失敗とも `finally` で homes、flags、target environment と working directory を復元する。user/machine environment、registry は変更しない。build が返した non-zero exit code を維持し、preflight / safety guard の失敗は1を返す。

## Cargo.toml guard

build 前に Cargo.toml の exact bytes と SHA-256 を保存する。終了時の bytes が不変なら何もしない。CRLF/LF を正規化した UTF-8 text が完全一致する場合だけ original exact bytes を復元する。内容差分なら書き戻さず失敗として review に残す。before / after-build / final SHA-256 と normalized comparison の判定を表示し、復元後の hash 一致を必須とする。Git index を操作して差分を隠さない。

## Privacy validation

build の exit 0だけで release candidate を合格にしない。build と checker は分離し、以下3実物をそれぞれ検査する。

1. release application EXE
2. 新 NSIS から抽出した application EXE
3. 新 MSI の embedded cabinet から抽出した application EXE

```powershell
& ./scripts/check-release-privacy.ps1 -Path ./tmp/release-build/target/release/dol-progress-manager.exe
if ($LASTEXITCODE -ne 0) { throw 'Application privacy check failed' }
```

同じ host/environment で checker を実行する。homes の解決順序は build と同じで、repository root と current user profile も自動で検査する。binary を read-only で読み、exact prefix の UTF-8 bytes（ASCII paths では Latin-1相当の byte match）と UTF-16LE bytes を探す。UTF-16LE は byte alignment の違いも検出する。file/category/encoding/count を表示し、host-sensitive findings が1件以上なら exit 1、0件なら exit 0。解決・read error も失敗とする。virtual `/cargo` / `/rustup` の件数は informational で固定値を要求しない。

generic drive-like bytes は blocker にしない。machine code の偶然一致を actual host prefix と区別する。この checker は current host の source-path leakage を検査する maintainer toolであり、malware、任意の secrets、別 host で生成した binary の安全性を保証するものではない。

NSIS は maintainer が準備した 7-Zip 等で静的抽出する。MSI は read-only Windows Installer database inspection で Media / File tables と cabinet streams を取得し、CAB を静的抽出する。installer の install/admin-install/uninstall で抽出しない。ツールの場所は PATH または maintainer が選択した値を使用し、machine-specific location は script に固定しない。抽出先は ignored tmp に置く。MSI cabinet の member 名が File ID の場合は File table から application を識別する。

抽出後の2 application payload を同じ checker の `-Path` に渡し、各 invocation の exit code を確認する。hashes、checker出力、抽出 inventory を証拠として保存する。別途、source/tests/node_modules/.git、raw GVDB、user DB、backup/bootstrap config、private keys/allowed_signers、tmp reports の非同梱を確認する。通常の WebView2 downloadBootstrapper 設定と user data の bootstrap config を混同しない。

application metadata は AMD64 / PE32+ / GUI subsystem、ProductName `DOL Progress Manager`、ProductVersion/FileVersion `0.3.0`、IsDebug=false、source ICO の6種と一致を確認する。NSIS installer stub の architecture は application と区別する。NSIS currentUser、MSI ALLUSERS=1 / perMachine、UpgradeCode の継続も確認する。ProductCode は通常 Tauri/WiX の自動生成により変わり得る。既知 ICE warnings を記録し、新しい warning/error を見逃さない。

現在 Authenticode signing は提供しない。WebView2 mode は downloadBootstrapper のまま。guest の WebView2 ABSENT という既知結果を引き継ぎ、offline guest の preprovision と runtime lifecycle は別の検証で扱う。この手順は application/installer を起動しない。

## 最終確認

typecheck、frontend tests/build、Cargo tests/check/fmt、full/production npm audit と保護対象 files の hashes を確認する。ESET等の手動 scan は maintainer の任意の最終検証で、build の dependency ではない。過去の candidate の user-provided ESET on-demand PASS を別hashの新candidateへ継承しない。過去の LiveGuard submission evidence はなく verdict も未取得であり、この build script は submission/verdict を取得しない。

この手順は staging、commit、tag、push、公開、runtime lifecycle を行わない。artifact の privacy/metadata と runtime 動作を別々に検証する。

仕様の参照: [Cargo environment variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html)、[Rustup environment variables](https://rust-lang.github.io/rustup/environment-variables.html)、[rustc source-path remapping](https://doc.rust-lang.org/rustc/remap-source-paths.html)。
