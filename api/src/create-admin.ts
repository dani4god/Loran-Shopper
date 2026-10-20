import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
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
try {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (
    !email ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !password ||
    password.length < 12 ||
    password.includes("replace-")
  )
    throw new Error("Set a valid super admin email and strong password.");
  await mongoose.connect(process.env.MONGODB_URI!);
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
  if (await Account.exists({ email }))
    throw new Error("Account already exists; nothing changed.");
  await Account.create({
    email,
    passwordHash: await bcrypt.hash(password, 12),
    name: process.env.SUPER_ADMIN_NAME || "Platform Admin",
    role: "superadmin",
    status: "approved",
  });
  console.log("Super admin created. Remove SUPER_ADMIN_PASSWORD from .env.");
} catch (e) {
  console.error(e instanceof Error ? e.message : "Admin setup failed");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
