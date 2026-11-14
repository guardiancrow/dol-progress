# 第三者通知の承認と昇格の設計

候補入力の技術検証、Ownerの入力承認、検証コードの承認、正式配布の検証を分ける。v0.5.0の固定入力はOwnerの限定承認を受け、manifest・review・sourceはREVIEWEDへ昇格した。新しい検証コードは別のレビュー待ちであり、正式配布は拒否する。

## 承認対象と最終sourceを分ける

Owner承認は、候補commit、preparation.jsonの相対pathとSHA-256、対象版、toolchain fingerprint、承認範囲と対象外に結び付ける。日時・判断者・範囲はOwnerの明示的な判断に基づき記録する。今回の指示には日時の指定がないため、approved_onはnull、approved_date_statusはNOT_SPECIFIED_IN_OWNER_INSTRUCTIONとしている。

候補snapshotは、そのcommitのGit blobから読み、参照するすべての入力の実bytesを照合する。歴史的な証拠の検証と現行入力の検証を混同しない。入力hashの検査では改行や文字コードを正規化しない。

承認後のmetadataと昇格検証コードを含む最終sourceは、候補commitとは別に確定する。正式runnerへ渡すExpectedSourceHead、実際のHEAD、署名、clean状態、候補からの祖先関係を照合する。最終commit自身のSHAをその中の承認ファイルへ埋め込まない。

## metadataの自己申告を信頼しない

`scripts/notice-approval-decisions.mjs`は、Ownerが承認した対象と承認記録のhashを登録する独立した設定である。approvedNoticeDecisionsには固定入力の限定承認を記録した。コード用のapprovedVerificationDecisionsは空のままである。候補やapprovalファイル、コマンド引数から承認を登録する機能はない。

入力用の登録には候補commit、snapshotとapprovalのpath・hash、判断者、日付の指定状況、toolchain fingerprintを含める。変更後コードのhashはこの入力承認に含めず、別の明示承認後に登録する。承認ファイルの自己申告と再計算したhashだけでは、この信頼設定を代替できない。

信頼設定は検証コードとは別ファイルに置く。検証コード自身のhashを検証コードの本文へ埋め込む循環を避けるためである。信頼設定を含む最終source全体についても、署名とOwnerによるsource確認が必要となる。

新しい検証コードと信頼設定の改行は、`scripts/.gitattributes`で対象を限定してLFに固定する。この属性ファイルも変更後コードのレビューhashへ含める。候補snapshotが固定した既存の属性や入力は変更しない。

`verification-preparation.json`は変更後の実装bytesをレビューするためのPREPARED記録であり、承認証拠ではない。ここにあるhashを自動的にコード承認へ登録しない。信頼設定自身のhashは自己参照を避けるため別扱いとし、最終source全体のレビューと署名で保護する。

## 昇格で許す変更を限定する

| 入力 | 承認後の扱い |
| --- | --- |
| 候補snapshot | 承認対象commitの原本bytesを保持する |
| 版情報・lock・Notices本文・inventory・属性 | 候補の実bytesを保持する。変更があれば承認を使い回さない |
| review | statusをREVIEWED、unresolvedを空配列とし、承認と候補への参照を追加する。coverageは変更しない |
| source | 承認状態と候補への参照を追加する。過去の由来commitと正式CompileのHEADを分ける |
| manifest | 状態、承認・候補参照、変更したreview/sourceのhashだけを更新する |
| 検証コード | 旧候補内の証拠は保持し、新しい実装は別途レビューしたhashに一致させる |

この変更規則は候補の内容から決定的に導出する。ラベルだけの変更、原文・coverageの変更、不正なtoolchain、別版の承認参照を拒否する。正式3工程の実行前に、Package完了や公開承認を記録しない。

候補が検証コードのhashを含む場合、昇格の接続変更でそのコードが変わることがある。旧hashは候補commitの原本を検証するために保持する。変更後コードは別途Ownerレビューの対象とし、旧承認から任意の実装変更を許可しない。

## 検証コードの責務

`inspectNoticeApprovalBinding`は、別に信頼した決定との結び付きをメモリー上で検査する。入力が一致してもformal_approval=falseを返す。この関数への任意のpin指定は、実際の承認を登録する操作ではない。

`inspectRegisteredNoticeInputs`は、固定された候補原本と現在の承認記録・派生metadataを照合する。input_approval=trueとコードの未承認状態を区別し、正式配布を承認する結果は返さない。

`verifyRegisteredNoticeApproval`は、入力とコードの両方の登録済み決定を要求し、最終sourceの署名・clean・HEAD・祖先関係と実ファイルを確認する。呼び出し側から信頼設定を渡す引数はない。コードの承認が未登録なので、現在の正式Notices readerからの呼び出しは拒否する。

`promoteNoticeInputs`は、入力承認を検証して3件のmetadataだけを更新する。原本と現在値が一致することを全件確認してから書き込み、途中失敗では元のbytesへ戻す。既に正しく昇格済みなら書き込まない。snapshot自体や旧版の承認記録は変更しない。コードや合成fixtureの正常系を、Ownerの実際の承認証拠へ転用しない。

## 承認後の工程

入力承認後も、実際の昇格接続コード、承認記録と固定した信頼設定をレビューし、コードの明示承認と署名付きclean sourceを確定する。その同じSHAから正式Compile、Package、独立Verifierを新しいrunで実行する。

Noticesの入力承認は、契約上の新しい許諾、正式3工程の成功、バイナリの公開承認を意味しない。最終ZIPの受入と公開判断は別に行う。
