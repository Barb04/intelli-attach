import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pingDatabase } from "./config/db.js";

const app = createApp();

app.listen(env.PORT, async () => {
  const dbOk = await pingDatabase();
  console.log(`🚀 Intelli-Attach API listening on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(dbOk ? "✅ Database connection verified" : "⚠️  Database unreachable at boot");
});
