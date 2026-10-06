import { useEffect, useRef, useState } from "react";

interface RelatedQuestDialogProps {
  discoveryName: string;
  quests: Array<{ id: number; title: string }>;
  onCancel(): void;
  onConfirm(selectedQuestId: number | null): void;
}

export function RelatedQuestDialog({
  discoveryName,
  quests,
  onCancel,
  onConfirm,
}: RelatedQuestDialogProps) {
  const [selection, setSelection] = useState<string>("");
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="related-quest-title"
        aria-describedby="related-quest-description"
      >
        <h2 id="related-quest-title">関連クエストを選択</h2>
        <p id="related-quest-description">
          「{discoveryName}」には複数の関連クエストがあります。どのクエストで発見しましたか？
        </p>
        <fieldset className="related-quest-options">
          <legend>達成済みにするクエスト</legend>
          {quests.map((quest) => (
            <label key={quest.id}>
              <input
                type="radio"
                name="related-quest"
                value={String(quest.id)}
                checked={selection === String(quest.id)}
                onChange={(event) => setSelection(event.target.value)}
              />
              <span>{quest.title}</span>
            </label>
          ))}
          <label>
            <input
              type="radio"
              name="related-quest"
              value="none"
              checked={selection === "none"}
              onChange={(event) => setSelection(event.target.value)}
            />
            <span>クエスト進捗は変更しない</span>
          </label>
        </fieldset>
        <div className="dialog-actions">
          <button ref={cancelButtonRef} type="button" className="button secondary" onClick={onCancel}>
            キャンセル
          </button>
          <button
            type="button"
            className="button primary"
            disabled={selection === ""}
            onClick={() => onConfirm(selection === "none" ? null : Number(selection))}
          >
            発見済みにする
          </button>
        </div>
      </div>
    </div>
  );
}
