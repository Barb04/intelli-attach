import { useEffect, useState, useCallback } from "react";
import { API_BASE_URL } from "../lib/api.js";

interface AuthUser {
  id: string;
  email: string;
  role: "STUDENT" | "ASSESSOR" | "SUPERVISOR" | "ADMIN";
}

/**
 * Deliberately NOT persisting the access token to localStorage. localStorage
 * is readable by any JS running on the page — including an attacker's script
 * if you ever have an XSS bug — which makes it a poor place for bearer
 * tokens. Instead we hold the access token only in memory and rely on the
 * httpOnly refresh cookie + a /refresh call on app boot to silently
 * re-establish a session after a hard reload.
 */
let inMemoryAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getAccessToken() {
  return inMemoryAccessToken;
}

/**
 * The logged-in user's identity lives at module scope too, alongside the
 * access token — this way ANY component calling useAuth() sees the same
 * user immediately, not just the component that happened to trigger the
 * login. Login.tsx sets this the moment login succeeds; bootstrapSession
 * sets it after a page-reload session restore. The listener set is how
 * every mounted useAuth() consumer gets notified when that shared value
 * changes, since plain module state alone doesn't trigger React re-renders.
 */
let currentUser: AuthUser | null = null;
const userListeners = new Set<(user: AuthUser | null) => void>();

export function setGlobalUser(user: AuthUser | null) {
  currentUser = user;
  userListeners.forEach((listener) => listener(user));
}

function decodeAccessToken(token: string): AuthUser | null {
  try {
    const payload = token.split(".")[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded));
    return { id: json.sub, email: json.email, role: json.role };
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(currentUser);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    userListeners.add(setUser);
    return () => {
      userListeners.delete(setUser);
    };
  }, []);

  const bootstrapSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("no active session");
      const data = await res.json();
      setAccessToken(data.accessToken);
      const decodedUser = decodeAccessToken(data.accessToken);
      if (decodedUser) setGlobalUser(decodedUser);
    } catch {
      setAccessToken(null);
      setGlobalUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  return { user, setUser: setGlobalUser, isLoading };
}