import type { PrerequisiteProgressCandidate } from "./prerequisiteProgressReview";

export interface PrerequisiteReviewConfirmation {
  profileId: number;
  profileName: string;
  candidate: PrerequisiteProgressCandidate;
}

export interface PrerequisiteReviewCompletion {
  confirmation: PrerequisiteReviewConfirmation | null;
  pending: boolean;
  message: string | null;
  begin(candidate: PrerequisiteProgressCandidate): void;
  cancel(): void;
  confirm(): Promise<void>;
}
