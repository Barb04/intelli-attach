import { useState } from "react";
import { useOfflineLogbook } from "../hooks/useOfflineLogbook.js";
import { getAccessToken } from "../hooks/useAuth.js";
import { API_BASE_URL } from "../lib/api.js";

// TEMPORARY: hardcoded until a "my current attachment" endpoint exists.
// This id was inserted directly in Supabase for student1@test.com,
// linked to a test site at Nairobi coordinates with a 150m geofence.
const ATTACHMENT_ID = "074de6f4-d37c-4a31-8964-8baf711a5f02";

interface SubmitResult {
  withinGeofence: boolean;
  distanceMeters: number;
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
      // GPS is captured on the device but never trusted client-side — the
      // server re-checks it against the site's registered location via
      // PostGIS. This is just what we report; the server decides what it means.
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

        if (!res.ok) {
          throw new Error(`Server responded ${res.status}`);
        }

        const data = await res.json();
        setResult({
          withinGeofence: data.entry.within_geofence,
          distanceMeters: Math.round(data.entry.distance_from_site_m),
        });
        setNarrative("");
      } catch {
        // Offline, or the request otherwise failed — queue it instead of
        // losing the student's entry. It'll sync automatically once online.
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
    </div>
  );
}