import type { PrerequisiteProgressCandidate, ReviewQuestIdentity } from "./prerequisiteProgressReview";

interface ConfirmationIdentity {
  profileId: number;
  profileName: string;
  target: ReviewQuestIdentity;
}

export type PrerequisiteReviewConfirmation = ConfirmationIdentity & (
  | { kind: "candidate"; candidate: PrerequisiteProgressCandidate }
  | { kind: "manual"; contextQuestId: number; gameConfirmed: boolean }
);

export interface PrerequisiteReviewCompletion {
  confirmation: PrerequisiteReviewConfirmation | null;
  pending: boolean;
  message: string | null;
  begin(candidate: PrerequisiteProgressCandidate): void;
  beginManual(contextQuestId: number, targetQuestId: number): void;
  setDetailContext(questId: number | null): void;
  setManualConfirmed(confirmed: boolean): void;
  cancel(): void;
  confirm(): Promise<void>;
}
