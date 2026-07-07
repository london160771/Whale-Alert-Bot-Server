import fetch from "node-fetch";

export async function postWhaleAlert({
  webhookUrl,
  symbol,
  amount,
  usdValue,
  from,
  to,
  txHash,
  network,
  isTestnet,
}) {
  const formattedUsd = usdValue.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const formattedAmount = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });

  const title = isTestnet ? "🧪 Whale Alert (TESTNET — not real value)" : "🐋 Whale Alert";
  const explorerBase = isTestnet ? "https://sepolia.etherscan.io" : "https://etherscan.io";

  const embed = {
    title,
    description: `**${formattedAmount} ${symbol}** (${formattedUsd} at real-world price) just moved`,
    color: isTestnet ? 0xf59e0b : 0x3b82f6,
    fields: [
      { name: "From", value: shorten(from), inline: true },
      { name: "To", value: shorten(to), inline: true },
      { name: "Network", value: network ?? "unknown", inline: true },
      { name: "Tx", value: `[View on Etherscan](${explorerBase}/tx/${txHash})` },
    ],
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed (${res.status}): ${text}`);
  }
}

function shorten(address) {
  if (!address || address.length < 10) return address ?? "unknown";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}