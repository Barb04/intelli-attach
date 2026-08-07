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
    <div>
      <h1>Student Dashboard</h1>
      <p>
        {pendingCount > 0
          ? `${pendingCount} entr${pendingCount === 1 ? "y" : "ies"} queued for sync`
          : "All entries synced"}
        {isSyncing && " — syncing…"}
      </p>
      <button onClick={syncPendingEntries} disabled={isSyncing}>
        Sync now
      </button>

      <hr />

      <h2>New Logbook Entry</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            Entry date{" "}
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <label>
            Narrative
            <br />
            <textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              rows={4}
              cols={50}
              required
            />
          </label>
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Getting location & submitting…" : "Submit entry"}
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {result && (
        <p style={{ color: result.withinGeofence ? "green" : "orange" }}>
          Entry submitted — {result.withinGeofence ? "within" : "outside"} geofence
          ({result.distanceMeters}m from site).
        </p>
      )}

      {queuedOffline && (
        <p style={{ color: "blue" }}>
          Could not reach the server — entry saved offline and will sync automatically.
        </p>
      )}

      <hr />

      <h2>My Logbook Entries</h2>
      {isLoadingEntries && <p>Loading…</p>}
      {!isLoadingEntries && entries.length === 0 && <p>No entries yet.</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} style={{ marginBottom: "1em" }}>
            <strong>{entry.entry_date.slice(0, 10)}</strong> — {entry.narrative}
            <br />
            Status: {entry.status} —{" "}
            <span style={{ color: entry.within_geofence ? "green" : "orange" }}>
              {entry.within_geofence ? "within" : "outside"} geofence (
              {Math.round(entry.distance_from_site_m)}m)
            </span>
            <br />
            {entry.status === "SUBMITTED" && (
              <>
                <button
                  onClick={() => handleRequestApproval(entry.id)}
                  disabled={requestingFor === entry.id}
                >
                  {requestingFor === entry.id ? "Sending…" : "Request supervisor approval"}
                </button>
                {requestMessages[entry.id] && (
                  <span style={{ marginLeft: "0.5em" }}>{requestMessages[entry.id]}</span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}