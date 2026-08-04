import { Pool } from "pg";
import { env } from "./env.js";

/**
 * A single shared connection pool for the process. We don't open a new
 * connection per request — that's slow and exhausts the DB's connection
 * limit fast, which matters a lot on free-tier Postgres (Supabase free tier
 * caps concurrent connections quite low).
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Free-tier managed Postgres providers often require SSL but present a
  // certificate that Node's default TLS validation won't trust out of the
  // box. This is safe for typical hosted Postgres (Supabase/Neon/Render) —
  // just don't do this against a database on the open internet you don't
  // control.
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // A background/idle client emitted an error — log it, don't crash the
  // whole process over a single dropped connection.
  console.error("Unexpected error on idle Postgres client", err);
});

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
