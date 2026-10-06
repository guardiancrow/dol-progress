import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Profile } from "../domain/models";
import type { UpdateProfileInput } from "../repositories/profileRepository";

export interface ProfileRepositoryPort {
  list(): Promise<Profile[]>;
  create(name: string, memo?: string | null): Promise<Profile>;
  update(profileId: number, input: UpdateProfileInput): Promise<Profile>;
  delete(profileId: number): Promise<void>;
}

interface ProfileContextValue {
  profiles: Profile[];
  selectedProfileId: number | null;
  selectedProfile: Profile | null;
  isLoading: boolean;
  errorMessage: string | null;
  selectProfile(profileId: number): void;
  createProfile(name: string, memo: string | null): Promise<Profile>;
  updateProfile(
    profileId: number,
    name: string,
    memo: string | null,
  ): Promise<Profile>;
  deleteProfile(profileId: number): Promise<void>;
  retryLoad(): Promise<void>;
  clearError(): void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

interface ProfileProviderProps {
  repository: ProfileRepositoryPort;
  children: ReactNode;
}

export function ProfileProvider({
  repository,
  children,
}: ProfileProviderProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const loaded = await repository.list();
      setProfiles(loaded);
      setSelectedProfileId((current) =>
        current !== null && loaded.some((profile) => profile.id === current)
          ? current
          : (loaded[0]?.id ?? null),
      );
    } catch (error: unknown) {
      reportError(error);
      setErrorMessage("プロフィールを読み込めませんでした。");
    } finally {
      setIsLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const createProfile = useCallback(
    async (name: string, memo: string | null) => {
      setErrorMessage(null);
      try {
        const created = await repository.create(name, memo);
        setProfiles((current) => [...current, created]);
        setSelectedProfileId(created.id);
        return created;
      } catch (error: unknown) {
        reportError(error);
        setErrorMessage("プロフィールを作成できませんでした。");
        throw error;
      }
    },
    [repository],
  );

  const updateProfile = useCallback(
    async (profileId: number, name: string, memo: string | null) => {
      setErrorMessage(null);
      try {
        const updated = await repository.update(profileId, { name, memo });
        setProfiles((current) =>
          current.map((profile) =>
            profile.id === profileId ? updated : profile,
          ),
        );
        return updated;
      } catch (error: unknown) {
        reportError(error);
        setErrorMessage("プロフィールを更新できませんでした。");
        throw error;
      }
    },
    [repository],
  );

  const deleteProfile = useCallback(
    async (profileId: number) => {
      setErrorMessage(null);
      try {
        await repository.delete(profileId);
        const remaining = profiles.filter((profile) => profile.id !== profileId);
        setProfiles(remaining);
        setSelectedProfileId((selected) =>
          selected === profileId ? (remaining[0]?.id ?? null) : selected,
        );
      } catch (error: unknown) {
        reportError(error);
        setErrorMessage("プロフィールを削除できませんでした。");
        throw error;
      }
    },
    [profiles, repository],
  );

  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const value = useMemo<ProfileContextValue>(
    () => ({
      profiles,
      selectedProfileId,
      selectedProfile,
      isLoading,
      errorMessage,
      selectProfile: setSelectedProfileId,
      createProfile,
      updateProfile,
      deleteProfile,
      retryLoad: loadProfiles,
      clearError: () => setErrorMessage(null),
    }),
    [
      profiles,
      selectedProfileId,
      selectedProfile,
      isLoading,
      errorMessage,
      createProfile,
      updateProfile,
      deleteProfile,
      loadProfiles,
    ],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfiles(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfiles must be used inside ProfileProvider");
  }
  return context;
}

function reportError(error: unknown): void {
  console.error("Profile operation failed", error);
}
