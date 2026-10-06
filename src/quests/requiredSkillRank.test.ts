import { describe, expect, it } from "vitest";

import { getRequiredSkillRank } from "./requiredSkillRank";

describe("getRequiredSkillRank", () => {
  it("uses only the selected skill's numeric rank among multiple skills", () => {
    const skills = [
      { skillName: "探索", requiredRank: 15 },
      { skillName: "考古学", requiredRank: 17 },
      { skillName: "ラテン語", requiredRank: null },
    ];
    expect(getRequiredSkillRank(skills, "考古学")).toBe(17);
    expect(getRequiredSkillRank(skills, "探索")).toBe(15);
    expect(getRequiredSkillRank(skills, "ラテン語")).toBeNull();
    expect(getRequiredSkillRank(skills, "宗教学")).toBeNull();
  });

  it("keeps zero distinct from NULL", () => {
    expect(getRequiredSkillRank([{ skillName: "考古学", requiredRank: 0 }], "考古学")).toBe(0);
  });

  it("does not pick an arbitrary rank from duplicate skill names", () => {
    expect(getRequiredSkillRank([
      { skillName: "考古学", requiredRank: 5 },
      { skillName: "考古学", requiredRank: 8 },
    ], "考古学")).toBeNull();
  });
});
