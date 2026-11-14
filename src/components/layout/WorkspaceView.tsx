import { createContext, useContext, type RefCallback } from "react";

interface WorkspaceView {
  controlsVisible: boolean;
  controlsId: string;
  registerControls: RefCallback<HTMLDivElement>;
}

export const WorkspaceViewContext = createContext<WorkspaceView | null>(null);

// 単独で表示するテーブルは、従来どおり通常表示にする。
export function useWorkspaceView() {
  return useContext(WorkspaceViewContext);
}
