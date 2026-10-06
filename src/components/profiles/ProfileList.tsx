import type { Profile } from "../../domain/models";

interface ProfileListProps {
  profiles: Profile[];
  selectedProfileId: number | null;
  onSelect(profileId: number): void;
  onEdit(profile: Profile): void;
  onDelete(profile: Profile): void;
}

export function ProfileList({
  profiles,
  selectedProfileId,
  onSelect,
  onEdit,
  onDelete,
}: ProfileListProps) {
  return (
    <ul className="profile-list" aria-label="プロフィール一覧">
      {profiles.map((profile) => (
        <li
          key={profile.id}
          className={profile.id === selectedProfileId ? "profile-card selected" : "profile-card"}
        >
          <button type="button" className="profile-summary" onClick={() => onSelect(profile.id)} aria-pressed={profile.id === selectedProfileId}>
            <span className="profile-name">{profile.name}</span>
            <span className="profile-memo">{profile.memo || "メモなし"}</span>
            <span className="profile-updated">更新: {formatUpdatedAt(profile.updatedAt)}</span>
          </button>
          <div className="profile-actions">
            <button type="button" className="button secondary" onClick={() => onEdit(profile)}>編集</button>
            <button type="button" className="button danger-quiet" onClick={() => onDelete(profile)}>削除</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}
