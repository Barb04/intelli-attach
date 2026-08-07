import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { setAccessToken, setGlobalUser } from "../hooks/useAuth.js";
import { API_BASE_URL } from "../lib/api.js";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Login failed");
      }

      const data = await res.json();
      setAccessToken(data.accessToken);
      setGlobalUser(data.user);
      navigate(`/${data.user.role.toLowerCase()}/dashboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="page" style={{ maxWidth: "380px", paddingTop: "5rem" }}>
      <div className="eyebrow">Geo-Verified Attachment Log</div>
      <form onSubmit={handleSubmit} className="panel">
        <h1>Sign in</h1>
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
          />
        </div>
        {error && (
          <p role="alert" className="msg error">
            {error}
          </p>
        )}
       <button type="submit" style={{ width: "100%" }}>
          Sign in
        </button>
        <p style={{ fontSize: "0.85rem", color: "var(--slate)", marginTop: "1rem" }}>
          Need an account? <Link to="/register">Register</Link>
        </p>
      </form>
    </div>
  );
}