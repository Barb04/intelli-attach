import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../lib/api.js";

interface EntryDetails {
  id: string;
  entry_date: string;
  narrative: string;
  status: string;
  distance_from_site_m: number;
  within_geofence: boolean;
  created_offline: boolean;
}

type Stage = "pin-entry" | "reviewing" | "done";

export function SupervisorApprove() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [pin, setPin] = useState("");
  const [scopedToken, setScopedToken] = useState<string | null>(null);
  const [entry, setEntry] = useState<EntryDetails | null>(null);
  const [stage, setStage] = useState<Stage>("pin-entry");
  const [decisionResult, setDecisionResult] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (!token) {
    return (
      <div className="page">
        <div className="eyebrow">Supervisor</div>
        <h1>Approval</h1>
        <p className="msg error">
          No approval token found in the URL. Use the link exactly as provided.
        </p>
      </div>
    );
  }

  async function handleVerifyPin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      const verifyRes = await fetch(`${API_BASE_URL}/api/magiclink/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });

      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "This approval link or PIN is invalid or expired.");
      }

      const verifyData = await verifyRes.json();
      const newScopedToken: string = verifyData.scopedToken;
      const entryId: string = verifyData.scopeRefId;

      const entryRes = await fetch(`${API_BASE_URL}/api/logbook/${entryId}/for-approval`, {
        headers: { Authorization: `Bearer ${newScopedToken}` },
      });

      if (!entryRes.ok) {
        throw new Error("Could not load the logbook entry for this approval link.");
      }

      const entryData = await entryRes.json();

      setScopedToken(newScopedToken);
      setEntry(entryData.entry);
      setStage("reviewing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDecision(decision: "APPROVED" | "REJECTED") {
    if (!entry || !scopedToken) return;
    setError(null);
    setIsBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/logbook/${entry.id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${scopedToken}`,
        },
        body: JSON.stringify({ decision, comment: comment || undefined }),
      });

      if (!res.ok) {
        throw new Error("Could not submit your decision. The link may have expired.");
      }

      setDecisionResult(decision);
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="eyebrow">Supervisor</div>
      <h1>Approval</h1>

      {error && <p className="msg error">{error}</p>}

      {stage === "pin-entry" && (
        <form onSubmit={handleVerifyPin} className="panel">
          <p style={{ marginTop: 0, color: "var(--slate)" }}>
            Enter the 6-digit PIN sent to you separately to view this entry.
          </p>
          <div className="field">
            <label>PIN</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={isBusy}>
            {isBusy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {stage === "reviewing" && entry && (
        <div className="panel">
          <h2>Logbook entry</h2>
          <div className="entry-date" style={{ marginBottom: "0.6rem" }}>
            {entry.entry_date.slice(0, 10)}
          </div>
          <p>{entry.narrative}</p>

          <div style={{ margin: "1rem 0" }}>
            <div className={`geo-readout ${entry.within_geofence ? "within" : "outside"}`}>
              <span className="geo-label">
                {entry.within_geofence ? "Within geofence" : "Outside geofence"}
              </span>
              <span className="geo-value">
                {Math.round(entry.distance_from_site_m)}m from site
              </span>
            </div>
          </div>

          <p style={{ fontSize: "0.85rem", color: "var(--slate)" }}>
            Submitted {entry.created_offline ? "offline, synced later" : "live"}
          </p>

          <div className="field">
            <label>Comment (optional)</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />
          </div>

          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button onClick={() => handleDecision("APPROVED")} disabled={isBusy}>
              Approve
            </button>
            <button
              className="secondary"
              onClick={() => handleDecision("REJECTED")}
              disabled={isBusy}
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {stage === "done" && (
        <p className={`msg ${decisionResult === "APPROVED" ? "" : "error"}`}>
          Entry {decisionResult === "APPROVED" ? "approved" : "rejected"}. You may close this
          page.
        </p>
      )}
    </div>
  );
}