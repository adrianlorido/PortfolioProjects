import { createHash } from "node:crypto";

/** Deterministic RFC 4122-shaped UUID (v5-style) from a name. Keeps seeds idempotent. */
export function stableUuid(name: string, namespace = "bastion-secplus"): string {
  const hash = createHash("sha1").update(`${namespace}:${name}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
