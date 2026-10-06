import { type FormEvent, useState } from "react";

import type { Profile } from "../../domain/models";

interface ProfileFormProps {
  profile?: Profile;
  operationError?: string | null;
  onSubmit(name: string, memo: string | null): Promise<void>;
  onCancel(): void;
}

export function ProfileForm({
  profile,
  operationError,
  onSubmit,
  onCancel,
}: ProfileFormProps) {
  const [name, setName] = useState(profile?.name ?? "");
  const [memo, setMemo] = useState(profile?.memo ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedMemo = memo.trim();
    if (normalizedName === "") {
      setValidationError("プロフィール名を入力してください。");
      return;
    }

    setValidationError(null);
    setIsSaving(true);
    try {
      await onSubmit(normalizedName, normalizedMemo || null);
    } catch {
      // The shared profile state exposes the user-facing repository error.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-form-title"
      >
        <h2 id="profile-form-title">
          {profile ? "プロフィールを編集" : "プロフィールを作成"}
        </h2>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="profile-name">プロフィール名</label>
          <input
            autoFocus
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isSaving}
          />
          <label htmlFor="profile-memo">メモ（任意）</label>
          <textarea
            id="profile-memo"
            rows={4}
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            disabled={isSaving}
          />
          {validationError && (
            <p className="field-error" role="alert">
              {validationError}
            </p>
          )}
          {operationError && (
            <p className="field-error" role="alert">
              {operationError}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onCancel} disabled={isSaving}>
              キャンセル
            </button>
            <button type="submit" className="button primary" disabled={isSaving}>
              {isSaving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
