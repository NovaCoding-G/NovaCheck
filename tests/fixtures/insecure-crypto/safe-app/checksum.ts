import { createHash } from "node:crypto";

export function fileChecksum(contents: Buffer) {
  return createHash("sha1").update(contents).digest("hex");
}
