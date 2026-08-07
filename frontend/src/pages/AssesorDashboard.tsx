import { useCallback, useEffect, useState } from "react";
import { getAccessToken } from "../hooks/useAuth.js";
import { API_BASE_URL } from "../lib/api.js";

interface AssignedAttachment {
  id: string;
  start_date: string;
  end_date: string;
  final_grade: string | null;
  graded_at: string | null;
  student_name: string;
  student_email: string;
  company_name: string;
}

interface AssessorEntry {
  id: string;
  entry_date: string;
  narrative: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  distance_from_site_m: number;
  within_geofence: boolean;
  assessor_comment: string | null;
  created_at: string;
}

function statusBadgeClass(status: string) {
  if (status === "APPROVED") return "badge approved";
  if (status === "REJECTED") return "badge rejected";
  return "badge submitted";
}

function weekProgress(startDate: string, endDate: string) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  const totalWeeks = Math.max(1, Math.round((end - start) / msPerWeek));

  if (now < start) return { label: "Not started", percent: 0 };
  if (now > end) return { label: `Completed (${totalWeeks} weeks)`, percent: 100 };

  const currentWeek = Math.min(totalWeeks, Math.floor((now - start) / msPerWeek) + 1);
  return {
    label: `Week ${currentWeek} of ${totalWeeks}`,
    percent: Math.round((currentWeek / totalWeeks) * 100),
  };
}

export function AssessorDashboard() {
  const [attachments, setAttachments] = useState<AssignedAttachment[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [entries, setEntries] = useState<AssessorEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  const [gradeInput, setGradeInput] = useState("");
  const [commentsInput, setCommentsInput] = useState("");
  const [isGrading, setIsGrading] = useState(false);
  const [gradeMessage, setGradeMessage] = useState<string | null>(null);

  const [entryComments, setEntryComments] = useState<Record<string, string>>({});
  const [savingCommentFor, setSavingCommentFor] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    setIsLoadingAttachments(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/attachments/mine`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("Could not load assigned attachments");
      const data = await res.json();
      setAttachments(data.attachments);
      if (data.attachments.length > 0 && !selectedId) {
        setSelectedId(data.attachments[0].id);
      }
    } catch {
      // Non-fatal — the page still renders, just empty.
    } finally {
      setIsLoadingAttachments(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEntries = useCallback(async (attachmentId: string) => {
    setIsLoadingEntries(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/attachments/${attachmentId}/entries`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
      });
      if (!res.ok) throw new Error("Could not load entries");
      const data = await res.json();
      setEntries(data.entries);
    } catch {
      setEntries([]);
    } finally {
      setIsLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  useEffect(() => {
    if (selectedId) {
      loadEntries(selectedId);
      const selected = attachments.find((a) => a.id === selectedId);
      setGradeInput(selected?.final_grade ?? "");
      setCommentsInput("");
      setGradeMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selectedAttachment = attachments.find((a) => a.id === selectedId) ?? null;

  async function handleGradeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setIsGrading(true);
    setGradeMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/attachments/${selectedId}/grade`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken() ?? ""}`,
        },
        body: JSON.stringify({ finalGrade: gradeInput, finalComments: commentsInput }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();

      // Backend returns snake_case here, matching /mine — update local state
      // to keep the attachment list and the grade form in sync without a refetch.
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === selectedId
            ? { ...a, final_grade: data.attachment.final_grade, graded_at: data.attachment.graded_at }
            : a
        )
      );
      setGradeMessage("Grade saved.");
    } catch (err) {
      setGradeMessage(err instanceof Error ? err.message : "Could not save grade.");
    } finally {
      setIsGrading(false);
    }
  }

  async function handleCommentSubmit(entryId: string) {
    const comment = entryComments[entryId]?.trim();
    if (!comment) return;
    setSavingCommentFor(entryId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/attachments/entries/${entryId}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAccessToken() ?? ""}`,
        },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId ? { ...entry, assessor_comment: data.entry.assessor_comment } : entry
        )
      );
      setEntryComments((prev) => ({ ...prev, [entryId]: "" }));
    } catch {
      // Kept simple deliberately — a failed comment save just leaves the
      // textbox populated so the assessor can retry without retyping.
    } finally {
      setSavingCommentFor(null);
    }
  }

  return (
    <div className="page">
      <div className="eyebrow">Assessor</div>
      <h1>Dashboard</h1>

      {isLoadingAttachments && <p>Loading…</p>}
      {!isLoadingAttachments && attachments.length === 0 && (
        <p>No attachments are currently assigned to you.</p>
      )}

      {attachments.length > 1 && (
        <div className="panel">
          <label>Attachment</label>
          <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
            {attachments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.student_name} — {a.company_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedAttachment && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>{selectedAttachment.student_name}</h2>
            <p style={{ color: "var(--slate)", marginTop: "-0.5rem" }}>
              {selectedAttachment.company_name} · {selectedAttachment.student_email}
            </p>

            {(() => {
              const progress = weekProgress(selectedAttachment.start_date, selectedAttachment.end_date);
              return (
                <div style={{ marginTop: "0.8rem" }}>
                  <div style={{ fontSize: "0.85rem", marginBottom: "0.3rem" }}>{progress.label}</div>
                  <div
                    style={{
                      background: "var(--paper-dark, #e8e4da)",
                      borderRadius: "4px",
                      height: "8px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${progress.percent}%`,
                        background: "var(--amber, #E8A33D)",
                        height: "100%",
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            {selectedAttachment.final_grade && (
              <div className="geo-readout within" style={{ marginTop: "0.9rem" }}>
                <span className="geo-label">Final grade</span>
                <span className="geo-value">{selectedAttachment.final_grade}</span>
              </div>
            )}
          </div>

          <hr />

          <h2>Logbook entries</h2>
          {isLoadingEntries && <p>Loading…</p>}
          {!isLoadingEntries && entries.length === 0 && <p>No entries submitted yet.</p>}
          <ul className="entry-list">
            {entries.map((entry) => (
              <li key={entry.id} className="entry-item">
                <div className="entry-date">{entry.entry_date.slice(0, 10)}</div>
                <p className="entry-narrative">{entry.narrative}</p>
                <div className="entry-meta">
                  <span className={statusBadgeClass(entry.status)}>{entry.status}</span>
                  <div className={`geo-readout ${entry.within_geofence ? "within" : "outside"}`}>
                    <span className="geo-label">{entry.within_geofence ? "Within" : "Outside"}</span>
                    <span className="geo-value">{Math.round(entry.distance_from_site_m)}m</span>
                  </div>
                </div>

                {entry.assessor_comment && (
                  <p className="msg info" style={{ marginTop: "0.6rem" }}>
                    Your comment: {entry.assessor_comment}
                  </p>
                )}

                <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder="Add a comment…"
                    value={entryComments[entry.id] ?? ""}
                    onChange={(e) =>
                      setEntryComments((prev) => ({ ...prev, [entry.id]: e.target.value }))
                    }
                    style={{ flex: 1 }}
                  />
                  <button
                    className="secondary"
                    onClick={() => handleCommentSubmit(entry.id)}
                    disabled={savingCommentFor === entry.id}
                  >
                    {savingCommentFor === entry.id ? "Saving…" : "Save"}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <hr />

          <h2>Final grade</h2>
          <form onSubmit={handleGradeSubmit} className="panel">
            <div className="field">
              <label>Grade</label>
              <input
                type="text"
                value={gradeInput}
                onChange={(e) => setGradeInput(e.target.value)}
                placeholder="e.g. A, B+, Pass"
                required
              />
            </div>
            <div className="field">
              <label>Comments</label>
              <textarea
                value={commentsInput}
                onChange={(e) => setCommentsInput(e.target.value)}
                rows={4}
              />
            </div>
            <button type="submit" disabled={isGrading}>
              {isGrading ? "Saving…" : selectedAttachment.final_grade ? "Update grade" : "Submit grade"}
            </button>
            {gradeMessage && <p className="msg info">{gradeMessage}</p>}
          </form>
        </>
      )}
    </div>
  );
}