// In production, VITE_API_URL points at the deployed backend.
// Locally, it's unset, so we fall back to a relative path — Vite's
// dev server proxy (or same-origin assumption) handles that case.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";