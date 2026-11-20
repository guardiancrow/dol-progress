import { useLayoutEffect, useMemo, useState } from "react";
import { WorkspaceReads, type WorkspaceReadScope } from "./WorkspaceReads";

export function useWorkspaceReadScope(workspace: WorkspaceReads | undefined, profileId: number | null): WorkspaceReadScope {
  const [local] = useState(() => ({ reads: new WorkspaceReads(), owner: { active: false } }));
  useLayoutEffect(() => {
    local.owner.active = true;
    return () => { local.owner.active = false; };
  }, [local]);
  useLayoutEffect(() => {
    if (!workspace && profileId !== null) local.reads.invalidateProfile(profileId);
  }, [workspace, profileId, local]);
  return useMemo(() => workspace ? { reads: workspace, owner: local.owner } : local, [workspace, local]);
}
