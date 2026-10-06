import { DISCOVERY_HEADERS, QUEST_HEADERS } from "./validation";

export const cp932JapaneseFixture = Uint8Array.from([
  0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x20, 0xb6, 0xc5, 0x20, 0x87, 0x40,
]);

export const invalidCp932Fixture = Uint8Array.from([0x81]);

export const questTsvFixture = [
  [...QUEST_HEADERS, "追加列"].join("\t"),
  [
    "100",
    " テスト依頼A ",
    "5",
    "",
    "仲介人",
    "セビリア",
    "探索",
    "史跡",
    "テスト発見物A",
    "",
    "一行目<br>二行目",
    "2026/01/01",
    "",
    "",
    "2:前提クエスト",
    "3:後続クエスト",
    "原文保持",
  ].join("\t"),
].join("\r\n");

export const discoveryTsvFixture = [
  DISCOVERY_HEADERS.join("\t"),
  [
    "10",
    "史跡",
    "発見物A",
    "2",
    "説明",
    "",
    "",
    "5",
    "100",
    "備考",
    "2026/01/02",
    "100:テスト依頼A,100:重複",
  ].join("\t"),
].join("\n");
