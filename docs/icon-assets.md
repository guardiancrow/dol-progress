# Application iconの制作と再生成

このiconは本プロジェクト用に新規作成した。編集可能な正本は
`assets/icon/icon-source.svg`で、独自に配置した角丸矩形とpathだけで構成する。
第三者のlogo、font glyph、raster artwork、ゲーム画像、GVDB素材は使用していない。
本プロジェクト独自のSVG sourceと生成iconには[MIT License](../LICENSE)を適用する。

濃紺の容器、斜めの方向針、金色の進捗arcで、航海と進捗管理を一般的に表現する。
SVGは512×512の正方形viewBoxを持ち、容器の外側は透明である。
文字、外部参照、script、埋め込み画像、filterは含まない。

## 再生成手順

repositoryの依存関係をlockfileに従って導入済みの環境で、rootから実行する。
制作時はローカルのTauri CLI 2.11.4を使用した。SVGを直接入力できるため、
追加の画像処理dependencyや中間master PNGは不要である。

```powershell
npm run tauri -- icon assets/icon/icon-source.svg --output src-tauri/icons
```

このcommandはdesktopとmobileの出力を生成する。現在のprojectはdesktop用のため、
mobile用出力だけを次のcommandで除去する。削除対象はrootから見た固定pathに限定する。

```powershell
Remove-Item -LiteralPath src-tauri/icons/android,src-tauri/icons/ios -Recurse
```

`src-tauri/icons/`に保持する出力は以下の17件である。

| 用途 | 出力 |
|---|---|
| Tauri bundle設定で参照するPNG | `32x32.png`, `128x128.png`, `128x128@2x.png` |
| Windows executable／bundle | `icon.ico` |
| macOS bundle設定で参照するicon | `icon.icns` |
| 高解像度の確認用PNG | `icon.png`（512×512） |
| desktop用の生成補助PNG | `64x64.png` |
| Windows向け生成補助asset | `Square30x30Logo.png`, `Square44x44Logo.png`, `Square71x71Logo.png`, `Square89x89Logo.png`, `Square107x107Logo.png`, `Square142x142Logo.png`, `Square150x150Logo.png`, `Square284x284Logo.png`, `Square310x310Logo.png`, `StoreLogo.png` |

補助assetは現在のbundle設定から直接参照されないが、Tauri標準のdesktop生成一式として
保持する。ICNSも既存bundle設定と他desktop環境での再生成に合わせて保持する。
Windows上での生成・build確認は、macOS実機での表示確認を意味しない。

CLI更新後には出力名と寸法を確認する。完全なbit単位の再現性は要求しないが、
すべての生成iconはこのSVGから再生成する。

Windowsで既存buildを再利用した場合、実行ファイル内のicon resourceが更新されない
ことがある。iconを置換した後は、本体packageのbuild cacheを削除して再buildする。
次のcommandはbuild出力だけを削除し、アプリケーションのユーザーデータには触れない。

```powershell
cargo clean --manifest-path src-tauri/Cargo.toml --package dol-progress-manager
$env:CARGO_NET_OFFLINE = 'true'
npm run tauri build -- --debug --no-bundle
```

この確認用buildはinstallerを生成しない。icon resourceの反映を確認してから、
installerを生成する場合も同じSVG由来のicon一式を使用する。

## 表示確認

再生成後はPNGの寸法とalpha、ICO内の16／24／32／48／64／256px画像を確認し、
小サイズでも方向針とarcを判別できるか目視する。
Windows build後にはexecutableのicon、window左上、taskbar、bundleを作成した場合は
installerとStart menuの表示を確認する。

Explorerやtaskbarが旧iconを表示する場合は、生成ファイルとexecutable内のiconを
先に確認し、Windowsの表示cacheと区別する。OS全体のicon cacheは削除しない。
build出力はrepositoryに含めない。
