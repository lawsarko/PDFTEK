import "server-only";
// pdf-lib can't encrypt or decrypt; this maintained fork can (AES-256 by default), so it's used
// only for password protection. Everything else keeps using pdf-lib.
import { PDFDocument } from "@cantoo/pdf-lib";
import { randomBytes } from "node:crypto";
import { badRequest } from "./http";

export type Permissions = { printing: boolean; copying: boolean; modifying: boolean };

/**
 * Returns a copy that needs `password` to open. When printing, copying or editing is restricted, the
 * owner password is a random secret: anyone opening with the shared password only gets the allowed
 * rights (the same password for both would grant full owner access and void the restrictions).
 */
export async function protectPdf(data: Uint8Array, password: string, perms: Permissions): Promise<Buffer> {
  const doc = await PDFDocument.load(data, { updateMetadata: false });
  const restricted = !perms.printing || !perms.copying || !perms.modifying;
  doc.encrypt({
    userPassword: password,
    ownerPassword: restricted ? randomBytes(24).toString("base64url") : password,
    permissions: {
      printing: perms.printing ? "highResolution" : false,
      copying: perms.copying,
      modifying: perms.modifying,
      annotating: perms.modifying,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: perms.modifying,
    },
  });
  return Buffer.from(await doc.save());
}

/** Removes the password (and any permission restrictions) from an encrypted PDF. */
export async function unlockPdf(data: Uint8Array, password: string): Promise<Buffer> {
  let probe: PDFDocument;
  try {
    probe = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw badRequest("That file doesn't look like a valid PDF.");
  }
  if (!probe.isEncrypted) throw badRequest("This PDF isn't password-protected, so there's nothing to remove.");
  // Files that only restrict printing/copying open with an empty password.
  for (const pw of password ? [password] : [""]) {
    try {
      const doc = await PDFDocument.load(data, { password: pw, updateMetadata: false });
      return Buffer.from(await doc.save());
    } catch (err) {
      if (err instanceof Error && /password/i.test(err.message)) continue;
      console.error("[pdftek] unlock failed", err);
      throw badRequest("We couldn't decrypt this PDF. It may use an unsupported security handler (e.g. certificate-based).");
    }
  }
  throw badRequest(password ? "That password is incorrect." : "This PDF needs a password to open. Enter it and try again.");
}
