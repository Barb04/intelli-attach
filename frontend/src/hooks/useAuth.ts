import { useEffect, useState, useCallback } from "react";
import { API_BASE_URL } from "../lib/api.js";

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
interface AuthUser {
  id: string;
  email: string;
  role: "STUDENT" | "ASSESSOR" | "SUPERVISOR" | "ADMIN";
}

/**
 * Deliberately NOT persisting the access token to localStorage. localStorage
 * is readable by any JS running on the page — including an attacker's script
 * if you ever have an XSS bug — which makes it a poor place for bearer
 * tokens. Instead we hold the access token only in memory (this module-level
 * variable survives across component re-renders within a single page load)
 * and rely on the httpOnly refresh cookie + a /refresh call on app boot to
 * silently re-establish a session after a hard reload.
 *
 * Trade-off worth stating plainly at your defense: this means a hard page
 * refresh always costs one /refresh round-trip before the user is "logged
 * in" again from the app's perspective. That's the correct trade for this
 * threat model — a few hundred ms of extra latency versus a token an XSS
 * bug could steal outright.
 */
let inMemoryAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  inMemoryAccessToken = token;
}

export function getAccessToken() {
  return inMemoryAccessToken;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const bootstrapSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("no active session");
      const data = await res.json();
      setAccessToken(data.accessToken);
      const decodedUser = decodeAccessToken(data.accessToken);
      if (decodedUser) setUser(decodedUser);
      // NOTE: in a fuller implementation, decode the access token (or add a
      // lightweight /api/auth/me endpoint) to populate `user` here rather
      // than leaving it to be set explicitly by the login page.
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrapSession();
  }, [bootstrapSession]);

  return { user, setUser, isLoading };
}
