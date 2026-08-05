import { createHash, createCipher } from "node:crypto";

export function weakHash(pw: string) {
  return createHash("md5").update(pw).digest("hex");
}

export function badToken() {
  const token = Math.random().toString(36);
  return token;
}

export function oldCipher(key: string) {
  return createCipher("aes-128-cbc", key);
}
