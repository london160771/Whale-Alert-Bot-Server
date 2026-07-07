# Whale Alert Bot

Watches Ethereum for large ("whale") transactions and posts alerts to a Discord channel.

## How it works

```
Alchemy (watches the chain)
   → sends a webhook when a big tx happens
   → this server checks it against your USD threshold
   → fetches live price from CoinGecko
   → posts a formatted alert to Discord
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create a Discord webhook
In your Discord server: **Server Settings → Integrations → Webhooks → New Webhook**, then copy the URL.

### 3. Set up Alchemy
1. Create a free account at [alchemy.com](https://www.alchemy.com/)
2. Go to **Notify** → **Create Webhook** → **Address Activity**
3. Add the address(es) you want to watch (or use a "whale watch list" of known exchange/whale wallets)
4. Point the webhook at `https://YOUR_PUBLIC_URL/webhooks/alchemy`
   - While developing locally, use [ngrok](https://ngrok.com/) to expose your local server: `ngrok http 3000`, then use the ngrok URL
5. Copy the **Signing Key** from the webhook settings

### 4. Configure environment variables
```bash
cp .env.example .env
```
Fill in `.env` with your Alchemy signing key, Discord webhook URL, and desired threshold.

### 5. Run it
```bash
npm start
```

## Testing without waiting for a real whale

Simulate an Alchemy webhook payload with curl:

```bash
curl -X POST http://localhost:3000/webhooks/alchemy \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "activity": [
        {
          "fromAddress": "0x1234567890abcdef1234567890abcdef12345678",
          "toAddress": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          "value": 5000,
          "asset": "ETH",
          "category": "external",
          "hash": "0xdeadbeef...someuniquehash"
        }
      ]
    }
  }'
```

Note: local signature verification is skipped automatically if `ALCHEMY_SIGNING_KEY` isn't set, so this works without a real Alchemy connection — useful for testing the Discord formatting and threshold logic in isolation.

## Project structure

```
src/
  index.js           # Express server + webhook handler
  verifySignature.js # Confirms webhooks really came from Alchemy
  priceFeed.js        # Fetches live USD prices from CoinGecko (with caching)
  discord.js          # Formats and sends the Discord alert
```

## Next steps (v2 ideas)

- Support more chains (Base, Polygon, Arbitrum)
- Track a curated list of known whale/exchange wallets instead of all activity
- Add a simple read-only dashboard (React) showing alert history
- Swap in-memory dedupe for Redis/SQLite so it survives restarts
- Post alerts directly to X via the API