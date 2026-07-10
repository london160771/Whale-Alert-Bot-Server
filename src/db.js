import mongoose from "mongoose";

export async function connectDB(mongoUri) {
  if (!mongoUri) {
    console.warn(
      "[db] MONGODB_URI not set — alerts will not be saved, dashboard will have nothing to show."
    );
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("[db] Connected to MongoDB");
  } catch (err) {
    console.error("[db] Failed to connect to MongoDB:", err.message);
  }
}