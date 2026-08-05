import { exec, spawn } from "node:child_process";
import cors from "cors";
import https from "node:https";

export function runUserCmd(userInput: string) {
  exec(`ls ${userInput}`);
  exec("rm " + userInput);
  spawn("sh", ["-c", userInput], { shell: true });
}

export function listSafe() {
  exec("ls -la");
  spawn("ls", ["-la"]);
}

export function leakySql(id: string, db: { query: (s: string) => void }) {
  db.query(`SELECT * FROM users WHERE id = '${id}'`);
  db.query("SELECT * FROM users WHERE id = " + id);
}

export function safeSql(db: { query: (s: string, p: unknown[]) => void }) {
  db.query("SELECT * FROM users WHERE id = $1", [1]);
}

export function openCors() {
  return cors({ origin: "*" });
}

export function reflectCors() {
  return cors({ origin: true });
}

export function badTls() {
  return https.request({
    hostname: "example.com",
    rejectUnauthorized: false,
  });
}

export function runEval(code: string) {
  return eval(code);
}

export function xss(html: string, el: HTMLElement) {
  el.innerHTML = html;
}
