import type { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

interface Props {
  allowedRoles: Array<"STUDENT" | "ASSESSOR" | "SUPERVISOR" | "ADMIN">;
}

export function ProtectedRoute({ allowedRoles, children }: PropsWithChildren<Props>) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
