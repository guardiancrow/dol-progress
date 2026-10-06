import { invoke } from "@tauri-apps/api/core";

export interface DataRootInfo {
  mode: "default" | "custom";
  dataRoot: string;
  databasePath: string;
  defaultDatabasePath: string;
  defaultDatabaseExists: boolean;
}

export interface RecoveryInfo {
  message: string;
  configuredRoot?: string;
  lastGoodAvailable: boolean;
  pendingPreviousAvailable: boolean;
}

export type StartupPresentation =
  | { kind: "normal"; mode: "default" | "custom"; dataRoot: string; databasePath: string; defaultDatabasePath: string; defaultDatabaseExists: boolean }
  | { kind: "recovery"; message: string; configuredRoot?: string; lastGoodAvailable: boolean; pendingPreviousAvailable: boolean };

export const dataRootService = {
  status: () => invoke<StartupPresentation>("data_root_status"),
  chooseCustom: () => invoke<string | null>("choose_custom_data_root"),
  migrateSelected: () => invoke<void>("migrate_selected_data_root"),
  migrateToDefault: () => invoke<void>("migrate_to_default_data_root"),
  chooseExisting: () => invoke<string | null>("recovery_choose_existing_root"),
  activateExisting: () => invoke<void>("recovery_activate_selected_root"),
  activateLastGood: () => invoke<void>("recovery_activate_last_good"),
  rollbackPrevious: () => invoke<void>("recovery_rollback_previous"),
};
