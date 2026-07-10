import fetch from "node-fetch";

// Map token symbols we care about to CoinGecko's internal IDs.
// Extend this as you add support for more tokens.
const COINGECKO_IDS = {
  ETH: "ethereum",
  WETH: "weth",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
};

// Simple in-memory cache so we don't hit CoinGecko's rate limit
// if several whale transactions come in close together.
// 5 minutes is plenty — ETH/USDC/etc. prices don't move enough in that
// window to matter for a "is this a whale?" threshold check.
const priceCache = new Map(); // symbol -> { price, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY; // optional but recommended

export async function getUsdPrice(symbol) {
  const upperSymbol = symbol.toUpperCase();
  const coingeckoId = COINGECKO_IDS[upperSymbol];

  if (!coingeckoId) {
    console.warn(`[priceFeed] No CoinGecko mapping for symbol "${symbol}"`);
    return null;
  }

  const cached = priceCache.get(upperSymbol);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", coingeckoId);
    url.searchParams.set("vs_currencies", "usd");

    const headers = {};
    if (COINGECKO_API_KEY) {
      headers["x-cg-demo-api-key"] = COINGECKO_API_KEY;
    }

    const res = await fetch(url, { headers });

    if (res.status === 429) {
      console.warn(
        `[priceFeed] Rate limited by CoinGecko fetching ${symbol}. ${
          cached ? "Using stale cached price." : "No cached price available — skipping."
        }`
      );
      return cached?.price ?? null;
    }

    if (!res.ok) {
      throw new Error(`CoinGecko returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const price = data[coingeckoId]?.usd;

    if (typeof price !== "number") {
      throw new Error("Unexpected response shape from CoinGecko");
    }

    priceCache.set(upperSymbol, { price, fetchedAt: Date.now() });
    return price;
  } catch (err) {
    console.error(`[priceFeed] Failed to fetch price for ${symbol}:`, err.message);
    // Fall back to a stale cached price rather than failing the whole alert, if we have one
    return cached?.price ?? null;
  }
}