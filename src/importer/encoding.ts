import { ImportError } from "./errors";

export function decodeCp932(bytes: Uint8Array): string {
  try {
    return new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ImportError(
      "DecodeError",
      "ファイルをCP932として読み取れませんでした。",
      detail,
    );
  }
}
