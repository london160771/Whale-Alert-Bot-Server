import "dotenv/config";
import express from "express";
import { isValidSignature } from "./verifySignature.js";
import { getUsdPrice } from "./priceFeed.js";
import { postWhaleAlert } from "./discord.js";

const app = express();

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
  PORT = 3000,
} = process.env;

const THRESHOLD = Number(WHALE_THRESHOLD_USD);

// Dedupe recent transaction hashes in memory. Good enough for MVP —
// if the process restarts, the set resets, which is an acceptable tradeoff for now.
const seenTxHashes = new Set();
const MAX_SEEN = 5000; // simple cap so this never grows unbounded

app.get("/", (_req, res) => {
  res.send("Whale alert bot is running.");
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
  const { fromAddress, toAddress, value, asset, hash, category } = activity;

  if (!hash || !asset || typeof value !== "number") return;
  if (seenTxHashes.has(hash)) return;

  // "external" = native ETH transfer, "token" = ERC-20 transfer
  if (category !== "external" && category !== "token") return;

  const isTestnet = TESTNET_NETWORKS.has(network);

  const price = await getUsdPrice(asset);
  if (price === null) return; // can't evaluate threshold without a price

  const usdValue = value * price;

  if (usdValue < THRESHOLD) return;

  markSeen(hash);

  const label = isTestnet ? `[TESTNET: ${network}]` : `[${network}]`;
  console.log(
    `[whale] ${label} ${value} ${asset} (~$${usdValue.toFixed(0)}) ${fromAddress} -> ${toAddress}`
  );

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