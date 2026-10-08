# 未承認通知の原文正本候補

このdirectoryはPhase 23D-C1C-C1で用意したversion管理対象の入力である。状態はDRAFT、
license clearanceはUNRESOLVED、一般公開はNO-GO。正式配布用の`release/notices/`とは別で、
実reviewerによる承認、最終binaryの包含判定、MPL source提供を代替しない。
今回の追加は未stage・未commitであり、後続checkpointで全文reviewする。

| 入力 | 内容 |
| --- | --- |
| manifest.json | version/target/原監査HEAD、752 component contracts、inventory/review/provenance hash |
| inventory.json | 752 unique ID、207通知候補、28除外、218 UNKNOWN、未承認選択・表示・未解決状態 |
| provenance.json | 個々の154原本の収録根拠、出典、component/version、original/curated hash、35参照資料、環境context |
| texts/ | 148 distinct原文。全文を改変せずraw hash名で共有 |
| copyright-evidence/ | 原文と共用できない6公開source file。元のheader・個別許諾・通知を含む全文 |
| reviews/copyright-review.json | 30件の限定検出review。独立ownerなし26件を含むが、正式な人手承認ではない |

収録は個々の文書の複製許諾と表示保持条件、package/fileの明示許諾を照合した範囲に限定した。
134文書は分類A（license原文）、20文書は分類B（COPYRIGHT/NOTICE・公開source証拠）。
MIT、Apache、BSD等の原文を削らず、AND/WITHと複合文書の各条件を残す。
これはアプリ配布時の全条件が履行済みという判断ではない。
収録根拠の一般条項は[MIT原文](https://opensource.org/license/mit)、
[Apache原文](https://www.apache.org/licenses/LICENSE-2.0)、
[MPL原文](https://www.mozilla.org/en-US/MPL/2.0/)を参照する。
これらのweb本文でpackage固有原文を置き換えていない。

6つの公開source証拠はTao 0.35.3の4file、Ryu 1.0.23の1file、Rust 1.98.0 exact revisionの
REUSE.tomlである。TaoのApache SPDX、RyuのApache/Boost、REUSE自身のMIT/Apache対応を
保持する。Tao keyboardのW3C全文・short notice・元の変更説明も残す。
既存draftはこのsourceから選ばれたowner表示だけを出すため、W3C等の最終配布通知への
全文対応とscopeはA07/A12の実reviewに残る。現行のW3C文書へ原文を差し替えない。

35件は本文を収録しない参照資料で、分類Cが3件、Dが9件、Eが23件。
Microsoft製品契約書は公開URL/hashに留める。installed Windows SDK契約RTFも転載せず、
既存hashと製品landing pageを記録する。landing pageをRTFの取得URLと偽らない。
UCD10旧data/比較terms、不要なgenerator・toolchain source、監査専用原本・archive・logも
入力へ取り込まない。各資料の理由、必要review、draft再現性への影響はprovenanceに記録した。

WebView2 SDK1.0.3650.58のLICENSE/NOTICEは公式nupkg memberから取得した原文で、
前者のBSD複製許諾と必要表示をそのまま保持する。NOTICEは英語全文を保持する。
Microsoft EULA/製品契約・SDK binary/文書全体の転載許可と同一視しない。
Loaderのnative NOTICE scopeは未承認のまま。

全154原本は`transformation=NONE`。original_sha256とcurated_sha256を別fieldで記録し、
今回の両値は一致する。文字コード・改行・BOMを編集していない。
directory内の.gitattributesで原本txtのGit改行変換を禁止し、JSONはLFとする。
原本にある行末space・末尾空行もhash証拠として保持するため、この2種類だけは原本txtの
whitespace検査対象から外す。差分表示と本文・hash検証は維持し、アプリsourceやJSONには適用しない。
今のvalidatorは変換なしだけを受け付け、別hashや無申告変換を拒否する。

出典がpackage archiveのものは公式URL、lock由来archive checksum/integrity、memberと版を
記録する。C1では再downloadしないため、そのURLの匿名到達性や全archive再照合の新証明ではない。
project-owned LICENSEはpublic remoteがないためURLを創作せず、repository memberと理由を残す。
`<cargo-cache>`等は旧出典を識別するtoken、inventory内のtmp/audit参照は歴史的な監査IDであり、
assemblyが読むfilesystem pathではない。入力を欠く場合に旧tmpやcacheへfallbackしない。

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-third-party-notices.ps1 `
      -InputManifest release/notice-source/manifest.json `
      -OutputDirectory tmp/notice-source-draft

出力先は未使用のignored tmp directoryにする。状態DRAFTの3fileを生成する。
manifestのsource_headは継承した原監査HEADで、provenanceのcuration_checkpointとは別である。
元の版・状態を保持した比較により、207/148の通知本文は既存draftと同じbytesを再現する。
inventoryの入力参照先とresultのmanifest/hashは正本への移行に伴い変わる。

MPL sourceは別archiveを匿名HTTPS提供する方針を維持するが、実公開先・URL・維持責任は未定。
原文正本の準備やsource候補hashだけでSOURCE PROVISION COMPLETEへ変更しない。
Microsoft環境の本人確認済みcontextは、現端末がBuild Tools 2022、別端末がCommunity 2022と
Microsoft account sign-in、同一個人開発者。製品利用条件、MSVC/SDK codeの再配布条件、
WebView2 SDK条件は独立して未解決であり、sign-inを後二者の無条件許可としない。
