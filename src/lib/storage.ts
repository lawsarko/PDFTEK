import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./db";
import { id } from "./ids";

const ROOT = path.join(DATA_DIR, "files");

function resolveKey(key: string) {
  if (!/^[A-Za-z0-9_\-/.]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return path.join(ROOT, key);
}

export async function putFile(workspaceId: string, data: Uint8Array, ext = "pdf"): Promise<string> {
  const key = `${workspaceId}/${id()}.${ext}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return key;
}

export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key));
}

export async function deleteFile(key: string) {
  await fs.rm(resolveKey(key), { force: true });
}
