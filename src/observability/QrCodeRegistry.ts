import { randomUUID } from "node:crypto";

const DEFAULT_QR_TTL_MS = 5 * 60 * 1000;

interface QrCodeArtifactRecord {
  id: string;
  filePath: string;
  expiresAt: number;
}

const qrCodeArtifacts = new Map<string, QrCodeArtifactRecord>();

function cleanupExpired(now = Date.now()): void {
  for (const [id, artifact] of qrCodeArtifacts.entries()) {
    if (artifact.expiresAt <= now) {
      qrCodeArtifacts.delete(id);
    }
  }
}

export function registerQrCodeArtifact(
  filePath: string,
  ttlMs = DEFAULT_QR_TTL_MS
): {
  id: string;
  expiresAt: string;
} {
  const normalizedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : DEFAULT_QR_TTL_MS;
  const id = randomUUID();
  const expiresAtTs = Date.now() + normalizedTtlMs;

  cleanupExpired();
  qrCodeArtifacts.set(id, {
    id,
    filePath,
    expiresAt: expiresAtTs
  });

  return {
    id,
    expiresAt: new Date(expiresAtTs).toISOString()
  };
}

export function getQrCodeArtifactFilePath(id: string): string | undefined {
  cleanupExpired();
  const artifact = qrCodeArtifacts.get(id);
  if (!artifact) {
    return undefined;
  }

  if (artifact.expiresAt <= Date.now()) {
    qrCodeArtifacts.delete(id);
    return undefined;
  }

  return artifact.filePath;
}
