import crypto from "crypto";

/**
 * Alchemy signs every webhook payload with your signing key so you can
 * confirm the request really came from Alchemy (and not someone spamming
 * your public endpoint with fake "whale" alerts).
 *
 * Docs: https://docs.alchemy.com/reference/notify-api-quickstart#securing-your-webhooks
 */
export function isValidSignature(rawBody, signatureHeader, signingKey) {
  if (!signingKey) {
    // Allow running without a signing key during local development,
    // but warn loudly so it's never accidentally skipped in production.
    console.warn(
      "[verifySignature] ALCHEMY_SIGNING_KEY not set — skipping signature check. Do not deploy like this."
    );
    return true;
  }

  const hmac = crypto.createHmac("sha256", signingKey);
  hmac.update(rawBody, "utf8");
  const expectedSignature = hmac.digest("hex");

  return expectedSignature === signatureHeader;
}