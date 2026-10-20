import express from "express";
import mongoose from "mongoose";

import { app } from "./app.js";
import { secret } from "./services.js";

import {
  Account,
  Order,
  Payment,
  Ticket,
  Asset,
  Mail,
  Setting,
  Announcement,
  Limit,
  Audit,
} from "./models.js";

let connectionPromise: Promise<void> | undefined;

async function connectDatabase(): Promise<void> {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      secret();

      const uri = process.env.MONGODB_URI;

      if (!uri) {
        throw new Error("MONGODB_URI is not configured.");
      }

      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
      });

      await Promise.all([
        Account.init(),
        Order.init(),
        Payment.init(),
        Ticket.init(),
        Asset.init(),
        Mail.init(),
        Setting.init(),
        Announcement.init(),
        Limit.init(),
        Audit.init(),
      ]);
    })().catch((error: unknown) => {
      connectionPromise = undefined;
      throw error;
    });
  }

  await connectionPromise;
}

const handler = express();

handler.disable("x-powered-by");

// Leave request bodies untouched here.
// Your existing app handles JSON and Paystack webhook bodies.
handler.use(async (_req, res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    console.error(
      "[Database] Connection failed:",
      error instanceof Error ? error.name : "Unknown error",
    );

    res.status(503).json({
      error: "The service is temporarily unavailable. Please try again.",
    });
  }
});

handler.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "loRan Shopper API",
    database: mongoose.connection.readyState === 1,
  });
});

handler.use(app);

export default handler;