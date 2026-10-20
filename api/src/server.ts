import "dotenv/config";
import mongoose from "mongoose";
import { app } from "./app.js";
import { sendQueued, secret } from "./services.js";
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
secret();
if (!process.env.MONGODB_URI) throw new Error("Set MONGODB_URI");
await mongoose.connect(process.env.MONGODB_URI);
await Promise.all(
  [
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
  ].map((m) => m.init()),
);
const server = app.listen(Number(process.env.PORT || 4000), "0.0.0.0", () =>
  console.log("loRan Shopper API ready"),
);
const timer = setInterval(() => {
  void sendQueued().catch(() => console.error("Email queue unavailable"));
}, 30000);
void sendQueued().catch(() => console.error("Email queue unavailable"));
process.on("SIGTERM", () => {
  clearInterval(timer);
  server.close(() => {
    void mongoose.disconnect().then(() => process.exit(0));
  });
});
