import { useCallback, useEffect, useState } from "react";
import { useOfflineLogbook } from "../hooks/useOfflineLogbook.js";
import { getAccessToken } from "../hooks/useAuth.js";
import { API_BASE_URL } from "../lib/api.js";

const ATTACHMENT_ID = "074de6f4-d37c-4a31-8964-8baf711a5f02";

interface SubmitResult {
  withinGeofence: boolean;
  distanceMeters: number;
}

interface LogbookEntry {
  id: string;
  entry_date: string;
  narrative: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  distance_from_site_m: number;
  within_geofence: boolean;
  created_offline: boolean;
  created_at: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });
}

function statusBadgeClass(status: string) {
  if (status === "APPROVED") return "badge approved";
  if (status === "REJECTED") return "badge rejected";
  return "badge submitted";
}

export function StudentDashboard() {
  const { pendingCount, isSyncing, queueEntry, syncPendingEntries } = useOfflineLogbook();

  const [entryDate, setEntryDate] = useState(todayISO());
  const [narrative, setNarrative] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);
  const [requestingFor, setRequestingFor] = useState<string | null>(null);
  const [requestMessages, setRequestMessages] = useState<Record<string, string>>({});

  const loadEntries = useCallback(async () => {
    setIsLoadingEntries(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/logbook/mine`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("Could not load entries");
      const data = await res.json();
      setEntries(data.entries);
    } catch {
      // Non-fatal — the submission form still works even if this list fails.
    } finally {
      setIsLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setQueuedOffline(false);

    if (narrative.trim().length < 10) {
      setError("Narrative must be at least 10 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      const position = await getCurrentPosition();
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      const entry = {
        attachmentId: ATTACHMENT_ID,
        entryDate,
        narrative,
        latitude,
        longitude,
        capturedAt: new Date().toISOString(),
      };

      try {
        const res = await fetch(`${API_BASE_URL}/api/logbook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAccessToken() ?? ""}`,
          },
          body: JSON.stringify({ ...entry, createdOffline: false }),
        });

       if (res.status === 409) {
          const data = await res.json();
          setError(data.error ?? "You already have an entry for this date.");
          return;
        }

        if (res.status === 404) {
          setError("Your attachment record could not be found. Contact your administrator.");
          return;
        }

        if (!res.ok) {
          throw new Error(`Server responded ${res.status}`);
        }

        const data = await res.json();
        setResult({
          withinGeofence: data.entry.within_geofence,
          distanceMeters: Math.round(data.entry.distance_from_site_m),
        });
        setNarrative("");
        await loadEntries();
      } catch {
        await queueEntry(entry);
        setQueuedOffline(true);
        setNarrative("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get your location.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRequestApproval(entryId: string) {
    setRequestingFor(entryId);
    setRequestMessages((prev) => ({ ...prev, [entryId]: "" }));
    try {
      const res = await fetch(`${API_BASE_URL}/api/magiclink/issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken() ?? ""}`,
        },
        body: JSON.stringify({ logbookEntryId: entryId }),
      });

      if (!res.ok) {
        throw new Error("Could not send the approval request.");
      }

      const data = await res.json();
      setRequestMessages((prev) => ({
        ...prev,
        [entryId]: `Approval request sent to ${data.supervisorEmail}.`,
      }));
    } catch (err) {
      setRequestMessages((prev) => ({
        ...prev,
        [entryId]: err instanceof Error ? err.message : "Something went wrong.",
      }));
    } finally {
      setRequestingFor(null);
    }
  }

  return (
    <div className="page">
      <div className="eyebrow">Student</div>
      <h1>Dashboard</h1>

      <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>
          {pendingCount > 0
            ? `${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} queued for sync`
            : "All entries synced"}
          {isSyncing && " — syncing…"}
        </span>
        <button className="secondary" onClick={syncPendingEntries} disabled={isSyncing}>
          Sync now
        </button>
      </div>

      <hr />

      <h2>New logbook entry</h2>
      <form onSubmit={handleSubmit} className="panel">
        <div className="field">
          <label>Entry date</label>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Narrative</label>
          <textarea
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={4}
            required
          />
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Getting location & submitting…" : "Submit entry"}
        </button>

        {error && <p className="msg error">{error}</p>}

        {result && (
          <div style={{ marginTop: "0.9rem" }}>
            <div className={`geo-readout ${result.withinGeofence ? "within" : "outside"}`}>
              <span className="geo-label">
                {result.withinGeofence ? "Within geofence" : "Outside geofence"}
              </span>
              <span className="geo-value">{result.distanceMeters}m from site</span>
            </div>
          </div>
        )}

        {queuedOffline && (
          <p className="msg info">
            Could not reach the server — entry saved offline and will sync automatically.
          </p>
        )}
      </form>

      <hr />

      <h2>My logbook entries</h2>
      {isLoadingEntries && <p>Loading…</p>}
      {!isLoadingEntries && entries.length === 0 && <p>No entries yet.</p>}
      <ul className="entry-list">
        {entries.map((entry) => (
          <li key={entry.id} className="entry-item">
            <div className="entry-date">{entry.entry_date.slice(0, 10)}</div>
            <p className="entry-narrative">{entry.narrative}</p>
            <div className="entry-meta">
              <span className={statusBadgeClass(entry.status)}>{entry.status}</span>
              <div className={`geo-readout ${entry.within_geofence ? "within" : "outside"}`}>
                <span className="geo-label">
                  {entry.within_geofence ? "Within" : "Outside"}
                </span>
                <span className="geo-value">
                  {Math.round(entry.distance_from_site_m)}m
                </span>
              </div>
            </div>
            {entry.status === "SUBMITTED" && (
              <div style={{ marginTop: "0.8rem" }}>
                <button
                  className="secondary"
                  onClick={() => handleRequestApproval(entry.id)}
                  disabled={requestingFor === entry.id}
                >
                  {requestingFor === entry.id ? "Sending…" : "Request supervisor approval"}
                </button>
                {requestMessages[entry.id] && (
                  <p style={{ fontSize: "0.85rem", color: "var(--slate)", marginTop: "0.4rem" }}>
                    {requestMessages[entry.id]}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}