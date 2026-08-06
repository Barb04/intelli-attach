import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./routes/ProtectedRoute.js";
import { Login } from "./pages/Login.js";
import { StudentDashboard } from "./pages/StudentDashboard.js";
import { SupervisorApprove } from "./pages/SupervisorApprove.js";

/**
 * Route protection here is a UX convenience, not a security boundary — the
 * real enforcement is server-side RBAC (see backend/src/middleware/rbac.ts).
 * A curious student popping open devtools and editing localStorage to change
 * their perceived role should see... exactly the same API 403s they'd get
 * otherwise, because the API never trusts the client's claim about its own
 * role. Worth saying explicitly in your defense: client-side route guards
 * are for a good user experience, never for actual access control.
 *
 * /supervisor/approve is intentionally NOT wrapped in ProtectedRoute — a
 * supervisor never has a normal logged-in session. Their entire identity
 * for this flow comes from the scoped token embedded in the magic link,
 * verified against a PIN. This mirrors the backend, where that route is
 * guarded by requireScopedApproval rather than the usual authenticate +
 * requireRole chain.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/student/dashboard"
          element={
            <ProtectedRoute allowedRoles={["STUDENT"]}>
              <StudentDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/supervisor/approve" element={<SupervisorApprove />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}