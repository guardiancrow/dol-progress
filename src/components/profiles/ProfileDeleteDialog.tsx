import { useEffect, useRef, useState } from "react";

import type { Profile } from "../../domain/models";

interface ProfileDeleteDialogProps {
  profile: Profile;
  operationError?: string | null;
  onConfirm(): Promise<void>;
  onCancel(): void;
}

export function ProfileDeleteDialog({
  profile,
  operationError,
  onConfirm,
  onCancel,
}: ProfileDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  async function confirmDelete() {
    setIsDeleting(true);
    try {
      await onConfirm();
    } catch {
      // The shared profile state exposes the user-facing repository error.
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <h2 id="delete-title">プロフィールを削除</h2>
        <p id="delete-description">
          プロフィール「{profile.name}」を削除しますか？
          このプロフィールのクエスト・発見物進捗も削除されます。この操作は取り消せません。
        </p>
        {operationError && (
          <p className="field-error" role="alert">
            {operationError}
          </p>
        )}
        <div className="dialog-actions">
          <button ref={cancelButton} type="button" className="button secondary" onClick={onCancel} disabled={isDeleting}>
            キャンセル
          </button>
          <button type="button" className="button danger" onClick={() => void confirmDelete()} disabled={isDeleting}>
            {isDeleting ? "削除中…" : "削除する"}
          </button>
        </div>
      </section>
    </div>
  );
}
