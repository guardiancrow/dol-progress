import type { Profile } from "../../domain/models";

interface ProfileSelectorProps {
  profiles: Profile[];
  selectedProfileId: number | null;
  disabled: boolean;
  onSelect(profileId: number): void;
}

export function ProfileSelector({
  profiles,
  selectedProfileId,
  disabled,
  onSelect,
}: ProfileSelectorProps) {
  return (
    <div className="profile-selector">
      <label htmlFor="selected-profile">現在のプロフィール</label>
      <select
        id="selected-profile"
        value={selectedProfileId ?? ""}
        disabled={disabled || profiles.length === 0}
        onChange={(event) => onSelect(Number(event.target.value))}
      >
        {profiles.length === 0 && <option value="">プロフィールなし</option>}
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </div>
  );
}
