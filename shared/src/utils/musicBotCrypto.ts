import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function getEncryptionKey(): Buffer {
  const secret = process.env.MUSIC_BOT_ENCRYPTION_KEY?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("MUSIC_BOT_ENCRYPTION_KEY must contain at least 32 bytes");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/** AES-256-GCM encryption for bot credentials stored in guild configuration. */
export function encryptMusicBotToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMusicBotToken(value: string): string {
  const [version, ivText, tagText, ciphertextText, extra] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra) {
    throw new Error("Invalid encrypted music bot token format");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
