import "dotenv/config";
import express from "express";
import cors from "cors";
import { isValidSignature } from "./verifySignature.js";
import { getUsdPrice } from "./priceFeed.js";
import { postWhaleAlert } from "./discord.js";
import { connectDB } from "./db.js";
import { Alert } from "./models/Alert.js";

const app = express();
app.use(cors()); // allows the dashboard (hosted on a different domain) to call this API

// We need the raw request body (not pre-parsed JSON) to verify Alchemy's signature,
// so we capture it here before express.json() parses it.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

const {
  ALCHEMY_SIGNING_KEY,
  DISCORD_WEBHOOK_URL,
  WHALE_THRESHOLD_USD = "1000000",
  MONGODB_URI,
  PORT = 3000,
} = process.env;

const THRESHOLD = Number(WHALE_THRESHOLD_USD);

connectDB(MONGODB_URI);

// Dedupe recent transaction hashes in memory. Good enough for MVP —
// if the process restarts, the set resets, which is an acceptable tradeoff for now.
const seenTxHashes = new Set();
const MAX_SEEN = 5000; // simple cap so this never grows unbounded

app.get("/", (_req, res) => {
  res.send("Whale alert bot is running.");
});

// Dashboard-facing API: returns recent alerts, newest first.
// ?limit=50 caps how many are returned (default 50, max 200 to avoid abuse).
app.get("/api/alerts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const alerts = await Alert.find().sort({ detectedAt: -1 }).limit(limit);
    res.json(alerts);
  } catch (err) {
    console.error("[api] Failed to fetch alerts:", err.message);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

app.post("/webhooks/alchemy", async (req, res) => {
  const signature = req.get("x-alchemy-signature");

  if (!isValidSignature(req.rawBody, signature, ALCHEMY_SIGNING_KEY)) {
    console.warn("[webhook] Invalid signature — rejecting request");
    return res.status(401).send("Invalid signature");
  }

  // Respond fast so Alchemy doesn't retry/time out; do the real work after.
  res.status(200).send("OK");

  try {
    const network = req.body?.event?.network ?? "UNKNOWN_NETWORK";
    const activities = req.body?.event?.activity ?? [];

    for (const activity of activities) {
      await handleActivity(activity, network);
    }
  } catch (err) {
    console.error("[webhook] Error processing payload:", err);
  }
});

// Alchemy network identifiers that are testnets, not real chains.
// USD price lookups are meaningless on these -- the token has no real value,
// so we label alerts clearly instead of pretending they're real whale moves.
const TESTNET_NETWORKS = new Set([
  "ETH_SEPOLIA",
  "ETH_HOLESKY",
  "MATIC_AMOY",
  "ARB_SEPOLIA",
  "BASE_SEPOLIA",
  "OPT_SEPOLIA",
]);

async function handleActivity(activity, network) {
  const { fromAddress, toAddress, value, asset, hash, category, rawContract } = activity;

  if (!hash || !asset || typeof value !== "number") return;
  if (seenTxHashes.has(hash)) return;

  // "external" = native ETH transfer, "token" = ERC-20 transfer
  if (category !== "external" && category !== "token") return;

  // For ERC-20 transfers, Alchemy includes the token's contract address —
  // we use that for price lookups instead of a manual symbol map, since it
  // works for any token, not just the handful we'd otherwise hardcode.
  const contractAddress = category === "token" ? rawContract?.address ?? null : null;

  const isTestnet = TESTNET_NETWORKS.has(network);

  const price = await getUsdPrice(asset, contractAddress);
  if (price === null) return; // can't evaluate threshold without a price

  const usdValue = value * price;

  if (usdValue < THRESHOLD) return;

  markSeen(hash);

  const label = isTestnet ? `[TESTNET: ${network}]` : `[${network}]`;
  console.log(
    `[whale] ${label} ${value} ${asset} (~$${usdValue.toFixed(0)}) ${fromAddress} -> ${toAddress}`
  );

  try {
    await Alert.create({
      txHash: hash,
      network,
      isTestnet,
      asset,
      amount: value,
      usdValue,
      fromAddress,
      toAddress,
    });
  } catch (err) {
    // Duplicate tx hash or DB hiccup shouldn't stop the Discord alert from going out
    console.error("[db] Failed to save alert:", err.message);
  }

  if (!DISCORD_WEBHOOK_URL) {
    console.warn("[whale] DISCORD_WEBHOOK_URL not set -- alert logged but not sent");
    return;
  }

  await postWhaleAlert({
    webhookUrl: DISCORD_WEBHOOK_URL,
    symbol: asset,
    amount: value,
    usdValue,
    from: fromAddress,
    to: toAddress,
    txHash: hash,
    network,
    isTestnet,
  });
}

function markSeen(hash) {
  seenTxHashes.add(hash);
  if (seenTxHashes.size > MAX_SEEN) {
    const oldest = seenTxHashes.values().next().value;
    seenTxHashes.delete(oldest);
  }
}

app.listen(PORT, () => {
  console.log(`Whale alert bot listening on port ${PORT}`);
  console.log(`Threshold: $${THRESHOLD.toLocaleString()}`);
});