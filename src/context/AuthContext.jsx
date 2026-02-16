import { useCallback, useEffect, useMemo, useState } from "react";
import {
  changeAuthPassword,
  fetchCurrentUser,
  getAuthToken,
  loginAuth,
  logoutAuth,
  registerAuth,
  updateAuthProfile,
} from "../api/musicApi.js";
import AuthContext from "./authContext.js";

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(() => (getAuthToken() ? "loading" : "guest"));
  const [user, setUser] = useState(null);

  const resolveCurrentUser = useCallback(async () => {
    if (!getAuthToken()) {
      return null;
    }

    try {
      const response = await fetchCurrentUser();
      return response?.user ?? null;
    } catch {
      await logoutAuth();
      return null;
    }
  }, []);

  useEffect(() => {
    if (!getAuthToken()) {
      return;
    }

    let cancelled = false;

    const loadCurrentUser = async () => {
      const nextUser = await resolveCurrentUser();
      if (cancelled) {
        return;
      }

      if (nextUser?.id) {
        setUser(nextUser);
        setStatus("authenticated");
        return;
      }

      setUser(null);
      setStatus("guest");
    };

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [resolveCurrentUser]);

  const refreshCurrentUser = useCallback(async () => {
    const nextUser = await resolveCurrentUser();
    if (nextUser?.id) {
      setUser(nextUser);
      setStatus("authenticated");
      return nextUser;
    }

    setUser(null);
    setStatus("guest");
    return null;
  }, [resolveCurrentUser]);

  const signIn = useCallback(async (payload) => {
    setStatus("loading");
    try {
      const response = await loginAuth(payload);
      const nextUser = response?.user ?? null;
      setUser(nextUser);
      setStatus(nextUser?.id ? "authenticated" : "guest");
      return response;
    } catch (error) {
      setUser(null);
      setStatus("guest");
      throw error;
    }
  }, []);

  const signUp = useCallback(async (payload) => {
    setStatus("loading");
    try {
      const response = await registerAuth(payload);
      const nextUser = response?.user ?? null;
      setUser(nextUser);
      setStatus(nextUser?.id ? "authenticated" : "guest");
      return response;
    } catch (error) {
      setUser(null);
      setStatus("guest");
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    await logoutAuth();
    setUser(null);
    setStatus("guest");
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const response = await updateAuthProfile(payload);
    const nextUser = response?.user ?? null;
    if (nextUser?.id) {
      setUser(nextUser);
      setStatus("authenticated");
    }
    return response;
  }, []);

  const changePassword = useCallback(async (payload) => {
    return changeAuthPassword(payload);
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      isAuthenticated: status === "authenticated" && Boolean(user?.id),
      refreshCurrentUser,
      signIn,
      signUp,
      signOut,
      updateProfile,
      changePassword,
    }),
    [status, user, refreshCurrentUser, signIn, signUp, signOut, updateProfile, changePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
