import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY debe estar definida en .env como 64 caracteres hex (32 bytes)."
    );
  }
  return Buffer.from(hex, "hex");
}

// Formato de salida: iv:authTag:ciphertext (todo en base64), para poder
// almacenarlo como un unico string en Environment.tokenCipher.
export function encryptToken(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
    ":"
  );
}

export function decryptToken(payload: string): string {
  const key = getKey();
  const [ivB64, authTagB64, dataB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Formato invalido de token cifrado.");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// Enmascara un token para mostrarlo en la UI sin exponerlo (ej. "dt0c01***").
export function maskToken(plainText: string): string {
  if (plainText.length <= 8) return "***";
  return `${plainText.slice(0, 8)}***`;
}

// Redacta cualquier token de Dynatrace que aparezca en logs de stdout/stderr
// antes de persistirlos en Job.output.
const DT_TOKEN_PATTERN = /dt0[a-zA-Z]0[01]\.[A-Z0-9]+\.[A-Za-z0-9]+/g;

export function sanitizeLogOutput(text: string): string {
  return text.replace(DT_TOKEN_PATTERN, "***REDACTED***");
}
