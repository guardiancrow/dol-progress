import type { QuestRequiredSkill } from "../domain/models";

type RankedSkill = Pick<QuestRequiredSkill, "skillName" | "requiredRank">;

export function getRequiredSkillRank(
  skills: readonly RankedSkill[],
  selectedSkill: string,
): number | null {
  if (selectedSkill === "") return null;

  let matched = false;
  let rank: number | null = null;
  for (const skill of skills) {
    if (skill.skillName !== selectedSkill) continue;
    if (matched) return null;
    matched = true;
    rank = skill.requiredRank;
  }
  return rank;
}
