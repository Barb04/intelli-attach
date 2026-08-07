import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./routes/ProtectedRoute.js";
import { Login } from "./pages/Login.js";
import { Register } from "./pages/Register.js";
import { StudentDashboard } from "./pages/StudentDashboard.js";
import { SupervisorApprove } from "./pages/SupervisorApprove.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
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