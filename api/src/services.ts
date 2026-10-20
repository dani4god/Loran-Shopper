import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import nodemailer from "nodemailer";
import { renderEmail } from "./email-template.js";
import { Mail, Order, Payment } from "./models.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("Set SESSION_SECRET");
  return s;
}
export function otpHash(code: string) {
  return createHmac("sha256", secret()).update(code).digest("hex");
}
function fileKey() {
  const key = process.env.FILE_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Set FILE_ENCRYPTION_KEY");
  return Buffer.from(key, "hex");
}
export function encryptFile(bytes: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", fileKey(), iv);
  return {
    bytes: Buffer.concat([c.update(bytes), c.final()]),
    iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
  };
}
export function decryptFile(asset: {
  bytes: Buffer;
  iv?: string | null;
  tag?: string | null;
}) {
  const d = createDecipheriv(
    "aes-256-gcm",
    fileKey(),
    Buffer.from(asset.iv!, "hex"),
  );
  d.setAuthTag(Buffer.from(asset.tag!, "hex"));
  return Buffer.concat([d.update(asset.bytes), d.final()]);
}
export async function queueMail(
  to: string,
  subject: string,
  text: string,
  dedupe: string,
): Promise<void> {
  await Mail.updateOne(
    { dedupe },
    {
      $setOnInsert: {
        to,
        subject,
        text,
        dedupe,
        status: "queued",
        attempts: 0,
        nextAttempt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    },
    { upsert: true },
  );

  // Wait for an email delivery attempt before finishing the request.
  await sendQueued(dedupe);
}
export async function sendQueued(dedupe?: string): Promise<void> {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_FROM ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD
  ) {
    console.error("[Email] SMTP configuration is incomplete.");
    return;
  }

  const port = Number(process.env.SMTP_PORT || 465);

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  // A request sends its specific message.
  // The local worker can still process up to ten queued messages.
  const limit = dedupe ? 1 : 10;

  for (let i = 0; i < limit; i++) {
    const now = new Date();

    const mail = await Mail.findOneAndUpdate(
      {
        ...(dedupe ? { dedupe } : {}),
        attempts: { $lt: 5 },
        $or: [
          {
            status: "queued",
            nextAttempt: { $lte: now },
          },
          {
            status: "sending",
            leaseUntil: { $lte: now },
          },
        ],
      },
      {
        $set: {
          status: "sending",
          leaseUntil: new Date(Date.now() + 120000),
        },
        $inc: {
          attempts: 1,
        },
      },
      {
        new: true,
        sort: { nextAttempt: 1 },
      },
    );

    if (!mail) break;

    try {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: mail.to!,
        subject: mail.subject!,
        text: mail.text!,
        html: renderEmail(mail.subject!, mail.text!),
      });
    } catch {
      console.error(
        "[Email] SMTP delivery failed for queued message:",
        String(mail._id),
      );

      await Mail.updateOne(
        {
          _id: mail._id,
          status: "sending",
          attempts: mail.attempts,
        },
        {
          $set: {
            status: "queued",
            lastError: "SMTP delivery failed",
            nextAttempt: new Date(
              Date.now() + (mail.attempts ?? 1) * 60000,
            ),
          },
          $unset: {
            leaseUntil: 1,
          },
        },
      );

      continue;
    }

    await Mail.updateOne(
      {
        _id: mail._id,
        status: "sending",
        attempts: mail.attempts,
      },
      {
        $set: {
          status: "sent",
        },
        $unset: {
          leaseUntil: 1,
          lastError: 1,
        },
      },
    );
  }
}
export async function paystackEnvelope(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.includes("replace"))
    throw new HttpError(503, "Payment service is not configured.");
  const res = await fetch("https://api.paystack.co" + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok || !data.status)
    throw new HttpError(502, "Paystack request failed. Please try again.");
  return data;
}
export async function paystack(path: string, method = "GET", body?: unknown) {
  return (await paystackEnvelope(path, method, body)).data;
}
export async function listBanks() {
  const banks: { name: string; code: string }[] = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const result = await paystackEnvelope(
      "/bank?country=nigeria&use_cursor=true&perPage=100" +
        (cursor ? "&next=" + encodeURIComponent(cursor) : ""),
    );
    banks.push(...result.data);
    const next = result.meta?.next;
    if (!next || next === cursor)
      return banks
        .filter(
          (b, index, all) => all.findIndex((v) => v.code === b.code) === index,
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    cursor = next;
  }
  throw new HttpError(502, "Unable to finish loading the bank list.");
}
export function webhookSignature(raw: Buffer, signature: string) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", key).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
export async function reconcile(
  reference: string,
  transaction?: Record<string, unknown>,
) {
  const payment = await Payment.findOne({ reference });
  if (!payment) throw new HttpError(404, "Payment reference not found.");
  const data =
    transaction ||
    (await paystack("/transaction/verify/" + encodeURIComponent(reference)));
  if (data.status !== "success") return { paid: false };
  if (
    data.reference !== reference ||
    data.currency !== "NGN" ||
    data.amount !== payment.amount ||
    (data.customer as { email?: string })?.email?.toLowerCase() !==
      payment.customerEmail
  ) {
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: "review",
          reviewReason: "Payment fields do not match.",
        },
      },
    );
    throw new HttpError(409, "Payment requires admin review.");
  }
  const order = await Order.findById(payment.orderId);
  if (!order) throw new HttpError(404, "Order missing.");
  if (
    order.paymentReference !== reference ||
    order.quoteRevision !== payment.quoteRevision ||
    order.quote?.total !== payment.amount
  ) {
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: { status: "review", reviewReason: "Order or quote has changed." },
      },
    );
    throw new HttpError(409, "Payment requires admin review.");
  }
  if (order.status === "accepted") {
    await Order.updateOne(
      { _id: order._id, status: "accepted", paymentReference: reference },
      {
        $set: { status: "paid", paidAt: new Date() },
        $inc: { version: 1 },
        $push: {
          history: {
            status: "paid",
            at: new Date(),
            note: "Verified Paystack payment",
          },
        },
      },
    );
  }
  const current = await Order.findById(order._id);
  if (!["paid", "shopping", "delivered"].includes(current!.status!)) {
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: "review",
          reviewReason: "Payment arrived for a nonpayable order.",
        },
      },
    );
    throw new HttpError(409, "Payment requires admin review.");
  }
  await Payment.updateOne(
    { _id: payment._id },
    { $set: { status: "success", paidAt: new Date() } },
  );
  return { paid: true };
}
export function customerView(row: Record<string, unknown>) {
  const out = { ...row };
  delete out.shopperId;
  delete out.paymentReference;
  delete out.version;
  delete out.__v;
  if (out.quote) {
    const quote = { ...(out.quote as Record<string, unknown>) };
    delete quote.platformFee;
    delete quote.shopperSettlement;
    out.quote = quote;
  }
  if (out.payout) out.payout = { status: "cleared" };
  return out;
}
