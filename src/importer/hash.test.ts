import { describe, expect, it } from "vitest";

import { calculateSha256 } from "./hash";

describe("calculateSha256", () => {
  it("hashes the original bytes as lowercase hexadecimal", async () => {
    await expect(calculateSha256(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
