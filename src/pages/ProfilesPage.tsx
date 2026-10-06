import { useEffect, useRef, useState } from "react";

import { ProfileDeleteDialog } from "../components/profiles/ProfileDeleteDialog";
import { ProfileForm } from "../components/profiles/ProfileForm";
import { ProfileList } from "../components/profiles/ProfileList";
import type { Profile } from "../domain/models";
import { useProfiles } from "../profiles/ProfileContext";

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; profile: Profile }
  | { kind: "delete"; profile: Profile }
  | null;

export function ProfilesPage() {
  const {
    profiles,
    selectedProfileId,
    isLoading,
    errorMessage,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    retryLoad,
    clearError,
  } = useProfiles();
  const [dialog, setDialog] = useState<DialogState>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);

  function openDialog(nextDialog: Exclude<DialogState, null>) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearError();
    setDialog(nextDialog);
  }

  function closeDialog() {
    setDialog(null);
  }

  useEffect(() => {
    if (dialog === null && returnFocus.current) {
      const focusTarget = returnFocus.current.isConnected
        ? returnFocus.current
        : createButton.current;
      focusTarget?.focus();
      returnFocus.current = null;
    }
  }, [dialog]);

  return (
    <section aria-labelledby="profiles-title">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">キャラクター管理</p>
          <h2 id="profiles-title">プロフィール</h2>
          <p>キャラクターごとにクエストと発見物の進捗を分けて管理します。</p>
        </div>
        <button ref={createButton} type="button" className="button primary" onClick={() => openDialog({ kind: "create" })}>
          プロフィールを作成
        </button>
      </div>

      {errorMessage && (
        <div className="error-banner" role="alert">
          <span>{errorMessage}</span>
          <button type="button" className="button secondary" onClick={() => void retryLoad()}>再読み込み</button>
        </div>
      )}

      {isLoading ? (
        <div className="state-panel" role="status">プロフィールを読み込んでいます…</div>
      ) : profiles.length === 0 ? (
        <div className="state-panel empty-state">
          <h3>プロフィールがまだありません</h3>
          <p>最初のプロフィールを作成して進捗管理を始めましょう。</p>
          <button type="button" className="button primary" onClick={() => openDialog({ kind: "create" })}>プロフィールを作成</button>
        </div>
      ) : (
        <ProfileList profiles={profiles} selectedProfileId={selectedProfileId} onSelect={selectProfile} onEdit={(profile) => openDialog({ kind: "edit", profile })} onDelete={(profile) => openDialog({ kind: "delete", profile })} />
      )}

      {dialog?.kind === "create" && (
        <ProfileForm operationError={errorMessage} onCancel={closeDialog} onSubmit={async (name, memo) => { await createProfile(name, memo); closeDialog(); }} />
      )}
      {dialog?.kind === "edit" && (
        <ProfileForm profile={dialog.profile} operationError={errorMessage} onCancel={closeDialog} onSubmit={async (name, memo) => { await updateProfile(dialog.profile.id, name, memo); closeDialog(); }} />
      )}
      {dialog?.kind === "delete" && (
        <ProfileDeleteDialog profile={dialog.profile} operationError={errorMessage} onCancel={closeDialog} onConfirm={async () => { await deleteProfile(dialog.profile.id); closeDialog(); }} />
      )}
    </section>
  );
}
