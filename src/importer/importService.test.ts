import { describe, expect, it, vi } from "vitest";

import { ImportError } from "./errors";
import type { ImportFileAdapter } from "./fileAdapter";
import { ImportService } from "./importService";
import { discoveryTsvFixture, questTsvFixture } from "./testFixtures";
import type { ImportResult, NormalizedImportRequest } from "./types";

vi.mock("./encoding", () => ({
  decodeCp932: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
}));

const noFileAdapter: ImportFileAdapter = {
  selectFile: async () => null,
};

describe("ImportService", () => {
  it("prepares a selected file without writing until explicitly imported", async () => {
    const applyImport = vi.fn<(request: NormalizedImportRequest) => Promise<ImportResult>>();
    const service = new ImportService(
      { selectFile: async () => ({ fileName: "quests.csv", bytes: new TextEncoder().encode(questTsvFixture) }) },
      { contains: async () => false },
      applyImport,
    );

    const prepared = await service.selectFile("quests");

    expect(prepared).toMatchObject({ dataset: "quests", fileName: "quests.csv", rowCount: 1, warningCount: 1 });
    expect(prepared?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(applyImport).not.toHaveBeenCalled();
  });

  it("stops duplicate imports before invoking the database command", async () => {
    const applyImport = vi.fn<(request: NormalizedImportRequest) => Promise<ImportResult>>();
    const service = new ImportService(
      noFileAdapter,
      { contains: async () => true },
      applyImport,
    );

    const error = await service
      .importBytes("quests", "quests.csv", new TextEncoder().encode(questTsvFixture))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).kind).toBe("DuplicateImport");
    expect(applyImport).not.toHaveBeenCalled();
  });

  it.each([
    ["quests", "quests.csv", questTsvFixture],
    ["discoveries", "discovery_items.csv", discoveryTsvFixture],
  ] as const)("builds a normalized %s request before DB writing", async (dataset, fileName, tsv) => {
    const applyImport = vi.fn(async (request: NormalizedImportRequest) => ({
      dataset: request.dataset,
      fileName: request.fileName,
      sha256: request.sha256,
      importedRowCount:
        request.dataset === "quests"
          ? request.quests.length
          : request.discoveries.length,
      insertedCount: 1,
      updatedCount: 0,
      inactiveCount: 0,
      relationCount: 0,
      warningCount: request.warnings.length,
      warnings: request.warnings,
    }));
    const service = new ImportService(
      noFileAdapter,
      { contains: async () => false },
      applyImport,
    );

    const result = await service.importBytes(
      dataset,
      fileName,
      new TextEncoder().encode(tsv),
    );

    expect(result.importedRowCount).toBe(1);
    const request = applyImport.mock.calls[0]?.[0];
    expect(request?.dataset).toBe(dataset);
    expect(request?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(request?.quests.length).toBe(dataset === "quests" ? 1 : 0);
    expect(request?.discoveries.length).toBe(dataset === "discoveries" ? 1 : 0);
    expect(request?.quests[0]?.sourceOrder ?? request?.discoveries[0]?.sourceOrder).toBe(0);
  });
});
