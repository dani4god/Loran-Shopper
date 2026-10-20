import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes, randomInt } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
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
import {
  registration,
  customerOrder,
  quoteInput,
  settingsInput,
  money,
  quoteTotals,
  statusTransition,
  complaintOpen,
  states,
} from "./validation.js";
import {
  HttpError,
  secret,
  otpHash,
  encryptFile,
  decryptFile,
  queueMail,
  paystack,
  listBanks,
  reconcile,
  webhookSignature,
  customerView,
} from "./services.js";
declare global {
  namespace Express {
    interface Request {
      actor?: { id: string; role: string; status: string };
    }
  }
}
export const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS)
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet());
app.use(cors({ origin: process.env.ADMIN_ORIGIN || "http://localhost:5173" }));
app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    if (!webhookSignature(req.body, req.get("x-paystack-signature") || "")) {
      res.sendStatus(401);
      return;
    }
    const event = JSON.parse(req.body.toString());
    if (event.event === "charge.success") {
      try {
        await reconcile(event.data.reference, event.data);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
      }
    }
    res.sendStatus(200);
  },
);
app.use(express.json({ limit: "256kb" }));
app.use("/v1", async (req, res, next) => {
  const id = `${req.ip}:${Math.floor(Date.now() / 60000)}`;
  try {
    const row = await Limit.findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date(Date.now() + 120000) },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (row!.count! > 120)
      throw new HttpError(429, "Too many requests. Try later.");
    res.set("Cache-Control", "no-store");
    next();
  } catch (e) {
    next(e);
  }
});
async function auth(req: Request, _res: Response, next: NextFunction) {
  try {
    const raw = req.get("Authorization") || "";
    if (!raw.startsWith("Bearer ")) throw new HttpError(401, "Please sign in.");
    let payload;
    try {
      payload = (
        await jwtVerify(raw.slice(7), new TextEncoder().encode(secret()), {
          issuer: "loran-shopper",
          audience: "loran-api",
          algorithms: ["HS256"],
        })
      ).payload;
    } catch {
      throw new HttpError(401, "Session expired. Please sign in.");
    }
    const a = await Account.findById(payload.sub);
    if (!a || a.status === "suspended" || a.sessionVersion !== payload.version)
      throw new HttpError(401, "Account unavailable.");
    req.actor = { id: String(a._id), role: a.role!, status: a.status! };
    next();
  } catch (e) {
    next(e);
  }
}
function role(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor || !roles.includes(req.actor.role))
      return next(new HttpError(403, "Not allowed."));
    next();
  };
}
const admin = [auth, role("admin", "superadmin")];
const shopper = [auth, role("shopper")];
function approved(req: Request) {
  if (req.actor?.status !== "approved")
    throw new HttpError(403, "Your application must be approved first.");
}
const loginInput = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(128),
  })
  .strict();

async function limitedAction(
  req: Request,
  scope: string,
  max: number,
  window: number,
) {
  const id = `${scope}:${req.ip}:${Math.floor(Date.now() / window)}`;
  const row = await Limit.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date(Date.now() + 2 * window) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (row!.count! > max)
    throw new HttpError(429, "Too many attempts. Please try later.");
}
app.post("/v1/password/request", async (req, res) => {
  await limitedAction(req, "password-reset", 5, 3600000);
  const email = z
    .object({ email: z.string().trim().toLowerCase().email() })
    .strict()
    .parse(req.body).email;
  const account = await Account.findOne({
    email,
    role: "shopper",
    status: { $ne: "suspended" },
  });
  if (account) {
    const code = String(randomInt(100000, 1000000));
    const nonce = randomBytes(16).toString("hex");
    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          passwordReset: {
            hash: otpHash(code),
            expiresAt: new Date(Date.now() + 10 * 60000),
            attempts: 0,
            nonce,
          },
        },
      },
    );
    await queueMail(
      email,
      "Reset your loRan Shopper password",
      `Your password reset code is ${code}. It expires in 10 minutes.`,
      "reset:" + account._id + ":" + nonce,
    );
  }
  res.json({
    message: "If an eligible shopper account exists, a code will be emailed.",
  });
});
app.post("/v1/password/confirm", async (req, res) => {
  await limitedAction(req, "reset-confirm", 15, 600000);
  const input = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      code: z.string().regex(/^[0-9]{6}$/),
      password: z.string().min(12).max(128),
    })
    .strict()
    .parse(req.body);
  const account = await Account.findOne({
    email: input.email,
    role: "shopper",
    status: { $ne: "suspended" },
  });
  if (
    !account?.passwordReset ||
    new Date(account.passwordReset.expiresAt).getTime() < Date.now() ||
    account.passwordReset.attempts >= 5
  )
    throw new HttpError(400, "Invalid or expired reset code.");
  const attempted = await Account.findOneAndUpdate(
    {
      _id: account._id,
      "passwordReset.nonce": account.passwordReset.nonce,
      "passwordReset.attempts": { $lt: 5 },
    },
    { $inc: { "passwordReset.attempts": 1 } },
    { returnDocument: "after" },
  );
  if (!attempted || attempted.passwordReset.hash !== otpHash(input.code))
    throw new HttpError(400, "Invalid or expired reset code.");
  const changed = await Account.updateOne(
    {
      _id: account._id,
      "passwordReset.nonce": attempted.passwordReset.nonce,
      "passwordReset.hash": otpHash(input.code),
      "passwordReset.expiresAt": { $gt: new Date() },
    },
    {
      $set: { passwordHash: await bcrypt.hash(input.password, 12) },
      $inc: { sessionVersion: 1 },
      $unset: { passwordReset: 1 },
    },
  );
  if (!changed.modifiedCount)
    throw new HttpError(409, "Reset code already used.");
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/v1/states", (_req, res) => res.json(states));
app.post("/v1/login", async (req, res) => {
  const input = loginInput.parse(req.body);
  const id =
    "login:" + input.email + ":" + Math.floor(Date.now() / (15 * 60000));
  const limit = await Limit.findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date(Date.now() + 30 * 60000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (limit!.count! > 8)
    throw new HttpError(429, "Too many sign-in attempts. Try again later.");
  const a = await Account.findOne({ email: input.email });
  const fallback =
    "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
  const valid = await bcrypt.compare(
    input.password,
    a?.passwordHash || fallback,
  );
  if (!a || !valid || a.status === "suspended")
    throw new HttpError(401, "Invalid credentials or unavailable account.");
  const token = await new SignJWT({ version: a.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(a._id))
    .setIssuer("loran-shopper")
    .setAudience("loran-api")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret()));
  res.json({ token, role: a.role });
});
app.post("/v1/logout", auth, async (req, res) => {
  await Account.updateOne(
    { _id: req.actor!.id },
    { $inc: { sessionVersion: 1 } },
  );
  res.json({ ok: true });
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
app.post("/v1/uploads", upload.single("file"), async (req, res) => {
  await limitedAction(req, "uploads", 20, 3600000);
  const kind = z.enum(["photo", "identity"]).parse(req.body.kind);
  const f = req.file;
  if (!f) throw new HttpError(400, "Choose a file.");
  const jpeg =
    f.buffer[0] === 255 && f.buffer[1] === 216 && f.buffer[2] === 255;
  const png = f.buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const pdf = f.buffer.subarray(0, 5).toString() === "%PDF-";
  if (!jpeg && !png && !(kind === "identity" && pdf))
    throw new HttpError(
      400,
      "Upload a JPEG/PNG photo, or a PDF identity document.",
    );
  const mime = jpeg ? "image/jpeg" : png ? "image/png" : "application/pdf";
  const row = await Asset.create({
    kind,
    mime,
    expiresAt: new Date(Date.now() + 86400000),
    ...(kind === "identity" ? encryptFile(f.buffer) : { bytes: f.buffer }),
  });
  res.status(201).json({ id: String(row._id) });
});
app.get("/v1/photos/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Photo not found.");
  const a = await Asset.findOne({
    _id: req.params.id,
    kind: "photo",
    owner: { $exists: true },
  });
  if (!a) throw new HttpError(404, "Photo not found.");
  res.type(a.mime!).send(a.bytes);
});
app.post("/v1/register", async (req, res) => {
  const input = registration.parse(req.body);
  if (await Account.exists({ email: input.email }))
    throw new HttpError(409, "Email already registered.");
  const assets = await Asset.find({
    _id: { $in: [input.profilePhoto, input.identityFile] },
    owner: { $exists: false },
  });
  if (
    assets.length !== 2 ||
    !assets.some(
      (a) => String(a._id) === input.profilePhoto && a.kind === "photo",
    ) ||
    !assets.some(
      (a) => String(a._id) === input.identityFile && a.kind === "identity",
    )
  )
    throw new HttpError(
      400,
      "Upload your profile photo and identity document first.",
    );
  const { password, ...data } = input;
  const a = await Account.create({
    ...data,
    role: "shopper",
    status: "pending",
    passwordHash: await bcrypt.hash(password, 12),
  });
  await Asset.updateMany(
    { _id: { $in: assets.map((a) => a._id) }, owner: { $exists: false } },
    { $set: { owner: a._id }, $unset: { expiresAt: 1 } },
  );
  await queueMail(
    a.email!,
    "loRan Shopper application received",
    "Our admin team will reach out shortly by email or WhatsApp. Your application is pending approval.",
    "application:" + a._id,
  );
  res.status(201).json({
    message:
      "Application received. Our admin team will reach out shortly by email or WhatsApp. You can sign in to check your application.",
  });
});
app.get("/v1/shoppers", async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const filter: Record<string, unknown> = {
    role: "shopper",
    status: "approved",
    available: true,
  };
  if (req.query.state) filter.state = String(req.query.state);
  const rows = await Account.find(filter)
    .select("surname firstName markets state shoppingFee profilePhoto")
    .sort({ _id: 1 })
    .skip((page - 1) * 20)
    .limit(20)
    .lean();
  res.json({
    records: rows,
    total: await Account.countDocuments(filter),
    page,
  });
});
app.get("/v1/me", auth, async (req, res) => {
  const a = await Account.findById(req.actor!.id)
    .select("-passwordHash -otp -passwordReset -sessionVersion -identityFile")
    .lean();
  res.json(a);
});
app.patch("/v1/me/availability", ...shopper, async (req, res) => {
  approved(req);
  const available = z
    .object({ available: z.boolean() })
    .strict()
    .parse(req.body).available;
  await Account.updateOne(
    { _id: req.actor!.id, status: "approved" },
    { $set: { available } },
  );
  res.json({ ok: true });
});
app.get("/v1/me/orders", ...shopper, async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const filter = { shopperId: req.actor!.id };
  const rows = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * 20)
    .limit(20)
    .lean();
  res.json({ records: rows, total: await Order.countDocuments(filter), page });
});
app.get("/v1/me/earnings", ...shopper, async (req, res) => {
  const result = await Order.aggregate([
    {
      $match: {
        shopperId: new mongoose.Types.ObjectId(req.actor!.id),
        status: { $in: ["paid", "shopping", "delivered"] },
      },
    },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        settlementTotal: { $sum: "$quote.shopperSettlement" },
        shoppingEarnings: {
          $sum: { $subtract: ["$quote.shoppingFee", "$quote.platformFee"] },
        },
        cleared: { $sum: { $ifNull: ["$payout.amount", 0] } },
      },
    },
  ]);
  const value = result[0] || {
    orders: 0,
    settlementTotal: 0,
    shoppingEarnings: 0,
    cleared: 0,
  };
  res.json({ ...value, pending: value.settlementTotal - value.cleared });
});
async function ownOrder(req: Request) {
  approved(req);
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Order not found.");
  const o = await Order.findOne({
    _id: req.params.id,
    shopperId: req.actor!.id,
  });
  if (!o) throw new HttpError(404, "Order not found.");
  return o;
}
app.post("/v1/orders", async (req, res) => {
  await limitedAction(req, "orders", 10, 3600000);
  const input = customerOrder.parse(req.body);
  const a = await Account.findOne({
    _id: input.shopperId,
    role: "shopper",
    status: "approved",
    available: true,
  });
  if (!a || !a.markets.includes(input.market))
    throw new HttpError(409, "Shopper is unavailable for this market.");
  const o = await Order.create({
    ...input,
    orderKey: "LR-" + randomBytes(16).toString("hex").toUpperCase(),
    history: [{ status: "new", at: new Date(), note: "Order submitted" }],
  });
  await queueMail(
    input.customer.email,
    "Your loRan Shopper order",
    `Keep this private order ID: ${o.orderKey}. Use Track order in the app to view progress.`,
    "order:" + o._id,
  );
  await queueMail(
    a.email!,
    "New shopping order",
    `You have a new order from ${input.customer.name}. Open your dashboard to quote it.`,
    "shopper-order:" + o._id,
  );
  res.status(201).json({ orderKey: o.orderKey });
});
async function tracked(req: Request) {
  const key = req.get("X-Order-Key");
  if (!key || !/^LR-[A-F0-9]{32}$/.test(key))
    throw new HttpError(404, "Order not found.");
  const row = await Order.findOne({ orderKey: key });
  if (!row) throw new HttpError(404, "Order not found.");
  return row;
}
app.get("/v1/order", async (req, res) => {
  const o = await tracked(req);
  const shopper = await Account.findById(o.shopperId).select(
    "surname firstName phone",
  );
  res.json({
    ...customerView(o.toObject()),
    shopper,
    complaintDeadline: o.deliveredAt
      ? new Date(o.deliveredAt.getTime() + 86400000)
      : null,
  });
});
app.post("/v1/me/orders/:id/quote", ...shopper, async (req, res) => {
  const o = await ownOrder(req);
  if (!["new", "quote_rejected", "quoted"].includes(o.status!))
    throw new HttpError(409, "This order cannot be quoted now.");
  const input = quoteInput.parse(req.body);
  const platform = (await Setting.findById("platform"))?.platformFee || 0;
  let totals;
  try {
    totals = quoteTotals(
      input.unitPrices,
      o.items.map((i) => i.quantity),
      input.transportFee,
      input.shoppingFee,
      platform,
    );
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Invalid quote.");
  }
  const revision = o.quoteRevision! + 1;
  const quote = { ...input, ...totals };
  const changed = await Order.findOneAndUpdate(
    { _id: o._id, version: o.version, status: o.status },
    {
      $set: { quote, status: "quoted", quoteRevision: revision },
      $inc: { version: 1 },
      $push: {
        history: {
          status: "quoted",
          at: new Date(),
          note: "Quote revision " + revision,
        },
      },
    },
    { returnDocument: "after" },
  );
  if (!changed)
    throw new HttpError(409, "Order changed. Refresh and try again.");
  await queueMail(
    o.customer.email,
    "Your loRan Shopper quote is ready",
    `A quote is ready. Open Track order using ${o.orderKey} to accept or reject it.`,
    "quote:" + o._id + ":" + revision,
  );
  res.json({ ok: true });
});
app.post("/v1/order/quote-decision", async (req, res) => {
  const o = await tracked(req);
  const input = z
    .object({
      accept: z.boolean(),
      revision: z.number().int(),
      reason: z.string().trim().max(2000).default(""),
    })
    .strict()
    .parse(req.body);
  if (!input.accept && !input.reason)
    throw new HttpError(400, "Provide a rejection reason.");
  if (o.status !== "quoted" || o.quoteRevision !== input.revision)
    throw new HttpError(409, "Quote changed. Refresh the order.");
  const status = input.accept ? "accepted" : "quote_rejected";
  const changed = await Order.updateOne(
    {
      _id: o._id,
      status: "quoted",
      quoteRevision: input.revision,
      version: o.version,
    },
    {
      $set: { status, rejectionReason: input.reason },
      $inc: { version: 1 },
      $push: {
        history: {
          status,
          at: new Date(),
          note: input.accept ? "Quote accepted" : input.reason,
        },
      },
    },
  );
  if (!changed.modifiedCount)
    throw new HttpError(409, "Order changed. Refresh.");
  res.json({ ok: true });
});
app.post("/v1/me/orders/:id/cancel", ...shopper, async (req, res) => {
  const o = await ownOrder(req);
  if (!["new", "quoted", "quote_rejected"].includes(o.status!))
    throw new HttpError(409, "Cannot cancel an accepted or paid order.");
  const reason = z
    .object({ reason: z.string().trim().min(1).max(2000) })
    .strict()
    .parse(req.body).reason;
  const changed = await Order.updateOne(
    { _id: o._id, version: o.version, status: o.status },
    {
      $set: { status: "cancelled", cancelReason: reason },
      $inc: { version: 1 },
      $push: { history: { status: "cancelled", at: new Date(), note: reason } },
    },
  );
  if (!changed.modifiedCount) throw new HttpError(409, "Order changed.");
  res.json({ ok: true });
});
app.post("/v1/me/orders/:id/status", ...shopper, async (req, res) => {
  const o = await ownOrder(req);
  const status = z
    .object({ status: z.enum(["shopping", "delivered"]) })
    .strict()
    .parse(req.body).status;
  if (!statusTransition(o.status!, status))
    throw new HttpError(409, "Invalid order status transition.");
  const changed = await Order.updateOne(
    { _id: o._id, status: o.status, version: o.version },
    {
      $set: {
        status,
        ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
      },
      $inc: { version: 1 },
      $push: {
        history: {
          status,
          at: new Date(),
          note:
            status === "shopping"
              ? "Shopping in progress"
              : "Shopper marked delivered",
        },
      },
    },
  );
  if (!changed.modifiedCount) throw new HttpError(409, "Order changed.");
  if (status === "delivered")
    await queueMail(
      o.customer.email,
      "Order marked delivered",
      `Your order was marked delivered. File complaints in the app within 24 hours using ${o.orderKey}.`,
      "delivered:" + o._id,
    );
  res.json({ ok: true });
});
app.post("/v1/order/confirm-delivery", async (req, res) => {
  const o = await tracked(req);
  if (o.status !== "delivered")
    throw new HttpError(409, "Order is not delivered yet.");
  await Order.updateOne(
    { _id: o._id },
    { $set: { customerConfirmedAt: new Date() } },
  );
  res.json({ ok: true });
});
app.post("/v1/order/complaint", async (req, res) => {
  const o = await tracked(req);
  if (!complaintOpen(o.deliveredAt || undefined))
    throw new HttpError(
      409,
      "Complaints must be submitted within 24 hours of the delivered status timestamp.",
    );
  const input = z
    .object({
      subject: z.string().trim().min(2).max(160),
      message: z.string().trim().min(5).max(5000),
    })
    .strict()
    .parse(req.body);
  if (await Ticket.exists({ orderId: o._id }))
    throw new HttpError(409, "A complaint is already filed for this order.");
  if (o.complaintStatus !== "open") {
    const locked = await Order.updateOne(
      {
        _id: o._id,
        status: "delivered",
        version: o.version,
        payout: { $exists: false },
      },
      { $set: { complaintStatus: "open" }, $inc: { version: 1 } },
    );
    if (!locked.modifiedCount)
      throw new HttpError(409, "Order changed. Refresh before filing.");
  }
  await Ticket.create({
    ...input,
    orderId: o._id,
    shopperId: o.shopperId,
    customer: o.customer,
  });
  res.status(201).json({ ok: true });
});
app.post("/v1/order/pay", async (req, res) => {
  const o = await tracked(req);
  if (o.status !== "accepted")
    throw new HttpError(409, "Accept the quote before payment.");
  if (o.paymentReference) {
    const p = await Payment.findOne({ reference: o.paymentReference });
    if (p?.authorizationUrl && p.status === "pending") {
      res.json({ url: p.authorizationUrl, reference: p.reference });
      return;
    }
    throw new HttpError(
      409,
      "A payment is being prepared. Refresh and retry shortly.",
    );
  }
  const reference = "LORAN_" + randomBytes(16).toString("hex");
  const locked = await Order.updateOne(
    {
      _id: o._id,
      status: "accepted",
      version: o.version,
      paymentReference: { $exists: false },
    },
    { $set: { paymentReference: reference }, $inc: { version: 1 } },
  );
  if (!locked.modifiedCount)
    throw new HttpError(409, "Order payment changed. Refresh.");
  const p = await Payment.create({
    reference,
    orderId: o._id,
    amount: o.quote.total,
    quoteRevision: o.quoteRevision,
    customerEmail: o.customer.email,
  });
  try {
    const data = await paystack("/transaction/initialize", "POST", {
      email: o.customer.email,
      amount: o.quote.total,
      currency: "NGN",
      reference,
      callback_url: process.env.PAYMENT_RETURN_URL,
      metadata: { orderId: String(o._id) },
    });
    await Payment.updateOne(
      { _id: p._id },
      { $set: { authorizationUrl: data.authorization_url } },
    );
    res.json({ url: data.authorization_url, reference });
  } catch (e) {
    await Payment.updateOne({ _id: p._id }, { $set: { status: "failed" } });
    await Order.updateOne(
      { _id: o._id, paymentReference: reference },
      { $unset: { paymentReference: 1 } },
    );
    throw e;
  }
});
app.post("/v1/order/verify-payment", async (req, res) => {
  const o = await tracked(req);
  if (!o.paymentReference) throw new HttpError(409, "No payment to verify.");
  res.json(await reconcile(o.paymentReference));
});
app.get("/payment-return", (_req, res) =>
  res
    .type("html")
    .send(
      '<!doctype html><html><meta name="viewport" content="width=device-width"><body><h1>Return to loRan Shopper</h1><p>Close this page, open your order and tap Check payment. The server verifies the payment securely.</p></body></html>',
    ),
);
app.get("/v1/banks", ...shopper, async (_req, res) =>
  res.json(await listBanks()),
);
app.post("/v1/banks/resolve", ...shopper, async (req, res) => {
  const input = z
    .object({
      bankCode: z.string().min(1).max(20),
      accountNumber: z.string().regex(/^[0-9]{10}$/),
    })
    .strict()
    .parse(req.body);
  const result = await paystack(
    "/bank/resolve?account_number=" +
      input.accountNumber +
      "&bank_code=" +
      encodeURIComponent(input.bankCode),
  );
  res.json({
    accountName: result.account_name,
    accountNumber: result.account_number,
  });
});
app.post("/v1/me/settings/request", ...shopper, async (req, res) => {
  const input = settingsInput
  .extend({
    markets: z
      .array(z.string().trim().min(1).max(120))
      .min(1, "Enter at least one market.")
      .max(40, "You can enter up to 40 markets.")
      .transform((markets) => {
        const seen = new Set<string>();

        return markets.filter((market) => {
          const normalized = market.toLowerCase();
          if (seen.has(normalized)) return false;
          seen.add(normalized);
          return true;
        });
      })
      .optional(),
  })
  .parse(req.body);
  const a = await Account.findById(req.actor!.id);
  if (
    a!.otp?.expiresAt &&
    new Date(a!.otp.expiresAt).getTime() > Date.now() + 9 * 60000
  )
    throw new HttpError(429, "Wait one minute before requesting another code.");
  const change: Record<string, unknown> = { ...input };
  if (input.profilePhoto) {
    const asset = await Asset.findOne({
      _id: input.profilePhoto,
      kind: "photo",
      $or: [{ owner: { $exists: false } }, { owner: a!._id }],
    });
    if (!asset) throw new HttpError(400, "Upload a new profile picture first.");
  }
  if (input.bankCode) {
    const result = await paystack(
      "/bank/resolve?account_number=" +
        input.accountNumber +
        "&bank_code=" +
        encodeURIComponent(input.bankCode),
    );
    const banks = await listBanks();
    const bank = banks.find((b: { code: string }) => b.code === input.bankCode);
    if (!bank) throw new HttpError(400, "Choose a supported bank.");
    change.bank = {
      code: input.bankCode,
      name: bank.name,
      accountNumber: result.account_number,
      accountName: result.account_name,
    };
    delete change.bankCode;
    delete change.accountNumber;
  }
  const code = String(randomInt(100000, 1000000));
  const nonce = randomBytes(16).toString("hex");
  await Account.updateOne(
    { _id: a!._id },
    {
      $set: {
        otp: {
          hash: otpHash(code),
          expiresAt: new Date(Date.now() + 10 * 60000),
          attempts: 0,
          change,
          nonce,
        },
      },
    },
  );
  await queueMail(
    a!.email!,
    "Approve your loRan Shopper settings change",
    `Your code is ${code}. It expires in 10 minutes. Do not share it.`,
    "otp:" + a!._id + ":" + nonce,
  );
  res.json({ message: "A confirmation code will be emailed to you." });
});
app.post("/v1/me/settings/confirm", ...shopper, async (req, res) => {
  const code = z
    .object({ code: z.string().regex(/^[0-9]{6}$/) })
    .strict()
    .parse(req.body).code;
  const a = await Account.findById(req.actor!.id);
  if (
    !a?.otp ||
    new Date(a.otp.expiresAt).getTime() < Date.now() ||
    a.otp.attempts >= 5
  )
    throw new HttpError(400, "Code expired. Request a new code.");
  const attempted = await Account.findOneAndUpdate(
    { _id: a._id, "otp.nonce": a.otp.nonce, "otp.attempts": { $lt: 5 } },
    { $inc: { "otp.attempts": 1 } },
    { returnDocument: "after" },
  );
  if (!attempted || attempted.otp.hash !== otpHash(code))
    throw new HttpError(400, "Incorrect code.");
  const changed = await Account.updateOne(
    {
      _id: a._id,
      "otp.nonce": a.otp.nonce,
      "otp.hash": otpHash(code),
      "otp.expiresAt": { $gt: new Date() },
    },
    { $set: attempted.otp.change, $unset: { otp: 1 } },
  );
  if (!changed.modifiedCount) throw new HttpError(409, "Code already used.");
  if (attempted.otp.change.profilePhoto)
    await Asset.updateOne(
      { _id: attempted.otp.change.profilePhoto },
      { $set: { owner: a._id }, $unset: { expiresAt: 1 } },
    );
  await Audit.create({
    actor: a._id,
    action: "settings_changed",
    target: String(a._id),
    details: { fields: Object.keys(attempted.otp.change) },
  });
  res.json({ ok: true });
});
app.get("/v1/announcements", ...shopper, async (_req, res) =>
  res.json(
    await Announcement.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .select("title body createdAt"),
  ),
);
function pagination(req: Request) {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  return { page, skip: (page - 1) * 20 };
}
const lists: {
  path: string;
  Model: mongoose.Model<any>;
  filter: Record<string, unknown>;
  select: string;
}[] = [
  {
    path: "shoppers",
    Model: Account,
    filter: { role: "shopper" },
    select: "-passwordHash -otp -passwordReset -sessionVersion",
  },
  { path: "orders", Model: Order, filter: {}, select: "-orderKey" },
  { path: "payments", Model: Payment, filter: {}, select: "" },
  { path: "tickets", Model: Ticket, filter: {}, select: "" },
];
for (const { path, Model, filter, select } of lists) {
  app.get("/v1/admin/" + path, ...admin, async (req, res) => {
    const { page, skip } = pagination(req);
    let records = await Model.find(filter)
      .select(select)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(20)
      .lean();
    if (path === "orders") {
      const shoppers = await Account.find({
        _id: { $in: records.map((o: any) => o.shopperId) },
      })
        .select("firstName surname email")
        .lean();
      records = records.map((o: any) => ({
        ...o,
        assignedShopper: shoppers.find(
          (a) => String(a._id) === String(o.shopperId),
        ),
      }));
    }
    res.json({ records, total: await Model.countDocuments(filter), page });
  });
}
app.get("/v1/admin/shopper/:id", ...admin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Shopper missing.");
  const account = await Account.findOne({ _id: req.params.id, role: "shopper" })
    .select("-passwordHash -otp -passwordReset -sessionVersion -identityFile")
    .lean();
  if (!account) throw new HttpError(404, "Shopper missing.");
  res.json(account);
});
app.get("/v1/admin/identity/:id", ...admin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Not found.");
  const a = await Asset.findOne({
    _id: req.params.id,
    kind: "identity",
    owner: { $exists: true },
  });
  if (!a) throw new HttpError(404, "Not found.");
  await Audit.create({
    actor: req.actor!.id,
    action: "identity_viewed",
    target: String(a._id),
  });
  res
    .type(a.mime!)
    .set(
      "Content-Disposition",
      'attachment; filename="identity-document.' +
        (a.mime === "application/pdf"
          ? "pdf"
          : a.mime === "image/png"
            ? "png"
            : "jpg") +
        '"',
    )
    .send(decryptFile({ bytes: Buffer.from(a.bytes!), iv: a.iv, tag: a.tag }));
});
app.patch("/v1/admin/shoppers/:id", ...admin, async (req, res) => {
  const input = z
    .object({
      status: z.enum(["approved", "rejected", "suspended"]),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict()
    .parse(req.body);
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Shopper missing.");
  const a = await Account.findOneAndUpdate(
    { _id: req.params.id, role: "shopper" },
    {
      $set: {
        status: input.status,
        reviewReason: input.reason,
        available: false,
      },
      $inc: { sessionVersion: 1 },
    },
    { returnDocument: "after" },
  );
  if (!a) throw new HttpError(404, "Shopper missing.");
  await Audit.create({
    actor: req.actor!.id,
    action: "shopper_" + input.status,
    target: String(a._id),
    details: { reason: input.reason },
  });
  await queueMail(
    a.email!,
    "loRan Shopper application update",
    `Your status is ${input.status}. ${input.reason}`,
    "review:" + a._id + ":" + a.sessionVersion,
  );
  res.json({ ok: true });
});
app.get("/v1/admin/platform", ...admin, async (_req, res) =>
  res.json({
    platformFee: (await Setting.findById("platform"))?.platformFee || 0,
  }),
);
app.patch("/v1/admin/platform", ...admin, async (req, res) => {
  const input = z.object({ platformFee: money }).strict().parse(req.body);
  await Setting.updateOne(
    { _id: "platform" },
    { $set: input },
    { upsert: true },
  );
  await Audit.create({
    actor: req.actor!.id,
    action: "platform_fee",
    target: "platform",
    details: input,
  });
  res.json({ ok: true });
});
app.get("/v1/me/platform", ...shopper, async (_req, res) =>
  res.json({
    platformFee: (await Setting.findById("platform"))?.platformFee || 0,
  }),
);
app.post("/v1/admin/announcements", ...admin, async (req, res) => {
  const input = z
    .object({
      title: z.string().trim().min(2).max(160),
      body: z.string().trim().min(2).max(5000),
    })
    .strict()
    .parse(req.body);
  await Announcement.create({ ...input, createdBy: req.actor!.id });
  res.status(201).json({ ok: true });
});
app.post("/v1/admin/admins", auth, role("superadmin"), async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(160),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(12).max(128),
    })
    .strict()
    .parse(req.body);
  if (await Account.exists({ email: input.email }))
    throw new HttpError(409, "Email exists.");
  const { password, ...data } = input;
  const a = await Account.create({
    ...data,
    role: "admin",
    status: "approved",
    passwordHash: await bcrypt.hash(password, 12),
  });
  await Audit.create({
    actor: req.actor!.id,
    action: "admin_created",
    target: String(a._id),
  });
  res.status(201).json({ ok: true });
});
app.patch("/v1/admin/tickets/:id", ...admin, async (req, res) => {
  const resolution = z
    .object({ resolution: z.string().trim().min(5).max(5000) })
    .strict()
    .parse(req.body).resolution;
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Ticket missing.");
  const ticket = await Ticket.findByIdAndUpdate(
    req.params.id,
    { $set: { status: "resolved", resolution } },
    { returnDocument: "after" },
  );
  if (!ticket) throw new HttpError(404, "Ticket missing.");
  await Order.updateOne(
    { _id: ticket.orderId },
    { $set: { complaintStatus: "resolved" }, $inc: { version: 1 } },
  );
  await queueMail(
    ticket.customer.email,
    "Complaint resolution",
    resolution,
    "resolution:" + ticket._id,
  );
  await Audit.create({
    actor: req.actor!.id,
    action: "complaint_resolved",
    target: String(ticket._id),
    details: { resolution },
  });
  res.json({ ok: true });
});
app.post("/v1/admin/orders/:id/payout", ...admin, async (req, res) => {
  const input = z
    .object({ reference: z.string().trim().min(3).max(200), amount: money })
    .strict()
    .parse(req.body);
  if (!mongoose.isValidObjectId(req.params.id))
    throw new HttpError(404, "Order missing.");
  const o = await Order.findById(req.params.id);
  if (
    !o ||
    o.status !== "delivered" ||
    !o.deliveredAt ||
    Date.now() <= o.deliveredAt.getTime() + 86400000
  )
    throw new HttpError(409, "Payout recording opens 24 hours after delivery.");
  if (
    o.complaintStatus === "open" ||
    (await Ticket.exists({ orderId: o._id, status: "open" }))
  )
    throw new HttpError(409, "Resolve the open complaint first.");
  if (input.amount !== o.quote.shopperSettlement)
    throw new HttpError(400, "Amount must match the shopper settlement.");
  const a = await Account.findById(o.shopperId);
  if (!a?.bank)
    throw new HttpError(409, "Shopper must verify bank details first.");
  const changed = await Order.updateOne(
    {
      _id: o._id,
      payout: { $exists: false },
      complaintStatus: { $ne: "open" },
      version: o.version,
    },
    {
      $set: {
        payout: {
          ...input,
          status: "cleared",
          at: new Date(),
          actor: req.actor!.id,
          bank: a.bank,
        },
      },
      $inc: { version: 1 },
    },
  );
  if (!changed.modifiedCount)
    throw new HttpError(409, "Payout already recorded or order changed.");
  await Audit.create({
    actor: req.actor!.id,
    action: "payout_recorded",
    target: String(o._id),
    details: input,
  });
  res.json({ ok: true });
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0].message });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if ((error as { code?: number }).code === 11000) {
    res.status(409).json({ error: "This record already exists." });
    return;
  }
  if (error instanceof multer.MulterError) {
    res
      .status(400)
      .json({ error: "File upload failed. Maximum size is 5 MB." });
    return;
  }
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "Unknown",
  );
  res.status(500).json({ error: "Service unavailable. Please try again." });
});
