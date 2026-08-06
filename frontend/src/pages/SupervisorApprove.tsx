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
      <div>
        <h1>Supervisor Approval</h1>
        <p style={{ color: "red" }}>
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
    <div>
      <h1>Supervisor Approval</h1>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {stage === "pin-entry" && (
        <form onSubmit={handleVerifyPin}>
          <p>Enter the 6-digit PIN sent to you separately to view this entry.</p>
          <label>
            PIN{" "}
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <br />
          <button type="submit" disabled={isBusy}>
            {isBusy ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {stage === "reviewing" && entry && (
        <div>
          <h2>Logbook Entry</h2>
          <p>
            <strong>Date:</strong> {entry.entry_date.slice(0, 10)}
          </p>
          <p>
            <strong>Narrative:</strong> {entry.narrative}
          </p>
          <p>
            <strong>Location check:</strong>{" "}
            <span style={{ color: entry.within_geofence ? "green" : "orange" }}>
              {entry.within_geofence ? "Within geofence" : "Outside geofence"} (
              {Math.round(entry.distance_from_site_m)}m from site)
            </span>
          </p>
          <p>
            <strong>Submitted:</strong>{" "}
            {entry.created_offline ? "Offline, synced later" : "Live"}
          </p>

          <label>
            Comment (optional)
            <br />
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              cols={50}
            />
          </label>
          <br />
          <button onClick={() => handleDecision("APPROVED")} disabled={isBusy}>
            Approve
          </button>{" "}
          <button onClick={() => handleDecision("REJECTED")} disabled={isBusy}>
            Reject
          </button>
        </div>
      )}

      {stage === "done" && (
        <p style={{ color: decisionResult === "APPROVED" ? "green" : "orangered" }}>
          Entry {decisionResult === "APPROVED" ? "approved" : "rejected"}. You may close
          this page.
        </p>
      )}
    </div>
  );
}