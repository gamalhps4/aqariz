"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";

interface UserAvatarContextValue {
  avatarUrl: string | null;
  setAvatarUrl: (url: string | null) => void;
}

const UserAvatarContext = createContext<UserAvatarContextValue | undefined>(
  undefined
);

interface UserAvatarProviderProps {
  children: React.ReactNode;
}

export function UserAvatarProvider({ children }: UserAvatarProviderProps) {
  const { data: session } = useSession();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Initialize or update avatar URL from the authenticated session
  useEffect(() => {
    const user = session?.user;
    const sessionAvatar =
      (user?.avatar as string | undefined) || user?.image || null;

    if (sessionAvatar) {
      setAvatarUrl(sessionAvatar);
    }
  }, [session?.user?.avatar, session?.user?.image]);

  const value: UserAvatarContextValue = {
    avatarUrl,
    setAvatarUrl,
  };

  return (
    <UserAvatarContext.Provider value={value}>
      {children}
    </UserAvatarContext.Provider>
  );
}

export function useUserAvatar(): UserAvatarContextValue {
  const context = useContext(UserAvatarContext);
  if (!context) {
    throw new Error("useUserAvatar must be used within a UserAvatarProvider");
  }
  return context;
}

