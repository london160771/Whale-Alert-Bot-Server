import fetch from "node-fetch";

// Native asset symbols don't have a contract address — map these directly.
const NATIVE_COINGECKO_IDS = {
  ETH: "ethereum",
};

// Simple in-memory cache so we don't hit CoinGecko's rate limit
// if several whale transactions come in close together.
// Keyed by symbol (native) or contract address (tokens).
const priceCache = new Map(); // key -> { price, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY; // optional but recommended

function authHeaders() {
  return COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {};
}

// Looks up USD price for a native asset (ETH) by its known CoinGecko id.
async function getNativePrice(symbol) {
  const upperSymbol = symbol.toUpperCase();
  const coingeckoId = NATIVE_COINGECKO_IDS[upperSymbol];
  if (!coingeckoId) return null;

  const cacheKey = `native:${upperSymbol}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", coingeckoId);
  url.searchParams.set("vs_currencies", "usd");

  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 429) {
    console.warn(`[priceFeed] Rate limited fetching ${symbol}.`);
    return cached?.price ?? null;
  }
  if (!res.ok) throw new Error(`CoinGecko returned HTTP ${res.status}`);

  const data = await res.json();
  const price = data[coingeckoId]?.usd;
  if (typeof price !== "number") throw new Error("Unexpected response shape from CoinGecko");

  priceCache.set(cacheKey, { price, fetchedAt: Date.now() });
  return price;
}

// Looks up USD price for any ERC-20 token by its contract address —
// works for any token without needing to maintain a manual symbol map.
async function getTokenPriceByContract(contractAddress) {
  const lowerAddress = contractAddress.toLowerCase();
  const cacheKey = `token:${lowerAddress}`;
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const url = new URL("https://api.coingecko.com/api/v3/simple/token_price/ethereum");
  url.searchParams.set("contract_addresses", lowerAddress);
  url.searchParams.set("vs_currencies", "usd");

  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 429) {
    console.warn(`[priceFeed] Rate limited fetching contract ${lowerAddress}.`);
    return cached?.price ?? null;
  }
  if (!res.ok) throw new Error(`CoinGecko returned HTTP ${res.status}`);

  const data = await res.json();
  const price = data[lowerAddress]?.usd;

  if (typeof price !== "number") {
    // Not an error — plenty of small/obscure tokens just aren't listed on CoinGecko
    return null;
  }

  priceCache.set(cacheKey, { price, fetchedAt: Date.now() });
  return price;
}

/**
 * Get the USD price for an asset.
 * @param {string} symbol - e.g. "ETH", "USDC"
 * @param {string|null} contractAddress - the token's contract address, if it's an ERC-20 (omit/null for native ETH)
 */
export async function getUsdPrice(symbol, contractAddress = null) {
  try {
    if (!contractAddress) {
      const price = await getNativePrice(symbol);
      if (price === null) {
        console.warn(`[priceFeed] No native price mapping for "${symbol}"`);
      }
      return price;
    }

    const price = await getTokenPriceByContract(contractAddress);
    if (price === null) {
      console.warn(`[priceFeed] No CoinGecko listing for token ${symbol} (${contractAddress})`);
    }
    return price;
  } catch (err) {
    console.error(`[priceFeed] Failed to fetch price for ${symbol}:`, err.message);
    return null;
  }
}