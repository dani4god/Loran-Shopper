import mongoose, { Schema } from "mongoose";
const accountSchema = new Schema(
  {
    role: {
      type: String,
      enum: ["shopper", "admin", "superadmin"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    surname: String,
    firstName: String,
    otherNames: String,
    name: String,
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    sessionVersion: { type: Number, default: 0 },
    phone: String,
    address: String,
    residence: String,
    state: String,
    markets: [String],
    ownsBusiness: Boolean,
    products: String,
    willing: Boolean,
    providesId: Boolean,
    mobile: Boolean,
    shoppingFee: Number,
    profilePhoto: String,
    identityFile: String,
    available: { type: Boolean, default: false },
    reviewReason: String,
    bank: Schema.Types.Mixed,
    otp: Schema.Types.Mixed,
    passwordReset: Schema.Types.Mixed,
  },
  { timestamps: true },
);
const orderSchema = new Schema(
  {
    orderKey: { type: String, required: true, unique: true },
    shopperId: { type: Schema.Types.ObjectId, required: true, index: true },
    market: String,
    customer: Schema.Types.Mixed,
    items: [Schema.Types.Mixed],
    notes: String,
    status: {
      type: String,
      enum: [
        "new",
        "quoted",
        "accepted",
        "quote_rejected",
        "cancelled",
        "paid",
        "shopping",
        "delivered",
      ],
      default: "new",
    },
    quote: Schema.Types.Mixed,
    quoteRevision: { type: Number, default: 0 },
    complaintStatus: { type: String, enum: ["open", "resolved"] },
    rejectionReason: String,
    cancelReason: String,
    paymentReference: String,
    paidAt: Date,
    deliveredAt: Date,
    customerConfirmedAt: Date,
    payout: Schema.Types.Mixed,
    history: [Schema.Types.Mixed],
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);
const paymentSchema = new Schema(
  {
    reference: { type: String, unique: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    quoteRevision: Number,
    amount: Number,
    customerEmail: String,
    status: {
      type: String,
      enum: ["pending", "success", "failed", "review"],
      default: "pending",
    },
    authorizationUrl: String,
    paidAt: Date,
    reviewReason: String,
  },
  { timestamps: true },
);
const ticketSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, unique: true },
    shopperId: Schema.Types.ObjectId,
    customer: Schema.Types.Mixed,
    subject: String,
    message: String,
    status: { type: String, enum: ["open", "resolved"], default: "open" },
    resolution: String,
  },
  { timestamps: true },
);
orderSchema.index({ "payout.reference": 1 }, { unique: true, sparse: true });
const assetSchema = new Schema(
  {
    expiresAt: { type: Date, index: { expires: 0 } },
    owner: Schema.Types.ObjectId,
    kind: { type: String, enum: ["photo", "identity"] },
    mime: String,
    bytes: Buffer,
    iv: String,
    tag: String,
  },
  { timestamps: true },
);
const mailSchema = new Schema(
  {
    to: String,
    subject: String,
    text: String,
    dedupe: { type: String, unique: true },
    status: { type: String, default: "queued" },
    attempts: { type: Number, default: 0 },
    nextAttempt: { type: Date, default: Date.now },
    leaseUntil: Date,
    lastError: String,
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true },
);
const settingSchema = new Schema({
  _id: String,
  platformFee: { type: Number, default: 0 },
});
const announcementSchema = new Schema(
  { title: String, body: String, createdBy: Schema.Types.ObjectId },
  { timestamps: true },
);
const limitSchema = new Schema({
  _id: String,
  count: Number,
  expiresAt: { type: Date, index: { expires: 0 } },
});
const auditSchema = new Schema(
  {
    actor: Schema.Types.ObjectId,
    action: String,
    target: String,
    details: Schema.Types.Mixed,
  },
  { timestamps: true },
);
export const Account = mongoose.model(
  "LoranAccount",
  accountSchema,
  "loran_accounts",
);
export const Order = mongoose.model("LoranOrder", orderSchema, "loran_orders");
export const Payment = mongoose.model(
  "LoranPayment",
  paymentSchema,
  "loran_payments",
);
export const Ticket = mongoose.model(
  "LoranTicket",
  ticketSchema,
  "loran_tickets",
);
export const Asset = mongoose.model("LoranAsset", assetSchema, "loran_assets");
export const Mail = mongoose.model("LoranMail", mailSchema, "loran_mail");
export const Setting = mongoose.model(
  "LoranSetting",
  settingSchema,
  "loran_settings",
);
export const Announcement = mongoose.model(
  "LoranAnnouncement",
  announcementSchema,
  "loran_announcements",
);
export const Limit = mongoose.model("LoranLimit", limitSchema, "loran_limits");
export const Audit = mongoose.model("LoranAudit", auditSchema, "loran_audit");
