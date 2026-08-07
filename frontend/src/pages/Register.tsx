import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../lib/api.js";

export function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"STUDENT" | "ASSESSOR" | "ADMIN">("STUDENT");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName, role }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Registration failed");
      }

      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="page" style={{ maxWidth: "380px", paddingTop: "5rem" }}>
        <div className="eyebrow">Geo-Verified Attachment Log</div>
        <div className="panel">
          <h1>Account created</h1>
          <p>You can now sign in with your email and password.</p>
          <Link to="/login">
            <button style={{ width: "100%" }}>Go to sign in</button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: "380px", paddingTop: "4rem" }}>
      <div className="eyebrow">Geo-Verified Attachment Log</div>
      <form onSubmit={handleSubmit} className="panel">
        <h1>Create account</h1>

        <div className="field">
          <label>Full name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={2}
          />
        </div>

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
          />
        </div>

        <div className="field">
          <label>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            style={{
              width: "100%",
              padding: "0.6rem 0.7rem",
              border: "1px solid var(--slate-light)",
              borderRadius: "var(--radius)",
              background: "var(--paper-raised)",
              fontFamily: "var(--font-body)",
              fontSize: "0.95rem",
              color: "var(--ink)",
            }}
          >
            <option value="STUDENT">Student</option>
            <option value="ASSESSOR">Assessor</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>

        {error && <p className="msg error">{error}</p>}

        <button type="submit" disabled={isSubmitting} style={{ width: "100%" }}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>

        <p style={{ fontSize: "0.85rem", color: "var(--slate)", marginTop: "1rem" }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}