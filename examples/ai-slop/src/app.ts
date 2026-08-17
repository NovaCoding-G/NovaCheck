// Intentionally unsafe demo server. Every function below exists to trigger a
// specific NovaCheck detector. Do not copy any of this into real code.
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import express from "express";
import { query } from "./db.ts";

const app = express();
app.use(express.json());

const INTERNAL_API_TOKEN = "b7f3c9a1d2e64f80ab5c3d7e9f1a2b4c";

// TLS verification disabled to "make the integration work".
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  next();
});

app.get("/logs", (req, res) => {
  exec(`tail -n 100 /var/log/${req.query.file}`, (error, stdout) => {
    res.send(error ? String(error) : stdout);
  });
});

app.get("/users", async (req, res) => {
  const rows = await query(
    "SELECT id, email FROM users WHERE tenant = '" + req.query.tenant + "'",
  );
  res.json(rows);
});

app.post("/eval", (req, res) => {
  const result = eval(req.body.expression);
  res.json({ result });
});

app.post("/session", (_req, res) => {
  const token = Math.random().toString(36).slice(2);
  const fingerprint = createHash("md5").update(token).digest("hex");
  res.json({ token, fingerprint, apiToken: INTERNAL_API_TOKEN });
});

app.listen(3000);
