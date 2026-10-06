import { describe, expect, it } from "vitest";

import { discoveryCapabilities } from "./capabilities";

describe("discoveryCapabilities", () => {
  it("keeps report and card capabilities for normal discoveries only", () => {
    expect(discoveryCapabilities({ id: 1, name: "地理", sortOrder: 1 })).toEqual({
      canReport: true,
      hasCard: true,
    });
    expect(discoveryCapabilities({ id: 2, name: "レリック", sortOrder: 2 })).toEqual({
      canReport: false,
      hasCard: false,
    });
  });
});
