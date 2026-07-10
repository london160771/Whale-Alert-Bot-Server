import mongoose from "mongoose";

const alertSchema = new mongoose.Schema({
  txHash: { type: String, required: true, unique: true },
  network: { type: String, required: true },
  isTestnet: { type: Boolean, default: false },
  asset: { type: String, required: true },
  amount: { type: Number, required: true },
  usdValue: { type: Number, required: true },
  fromAddress: { type: String, required: true },
  toAddress: { type: String, required: true },
  detectedAt: { type: Date, default: Date.now },
});

// Fast "give me the most recent alerts" queries for the dashboard
alertSchema.index({ detectedAt: -1 });

export const Alert = mongoose.model("Alert", alertSchema);