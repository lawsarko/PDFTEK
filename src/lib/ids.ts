import crypto from "node:crypto";

export function id(prefix = ""): string {
  return prefix + crypto.randomBytes(12).toString("base64url");
}

export function token(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export const now = () => Date.now();
