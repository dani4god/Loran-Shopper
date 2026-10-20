import { z } from "zod";
export const states = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
  "FCT Abuja",
] as const;
const text = z.string().trim().min(1).max(200);
const email = z.string().trim().toLowerCase().email().max(254);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, "Use a valid WhatsApp number, preferably +234…")
  .transform((v) =>
    /^0[0-9]{10}$/.test(v)
      ? "+234" + v.slice(1)
      : v.startsWith("+")
        ? v
        : "+" + v,
  );
export const money = z.number().int().min(0).max(1000000000); // All API money is integer kobo.
export const registration = z
  .object({
    surname: text,
    firstName: text,
    otherNames: z.string().trim().max(200),
    email,
    password: z.string().min(12).max(128),
    phone,
    address: text,
    residence: text,
    state: z.enum(states),
    markets: z.array(text).min(1).max(25),
    ownsBusiness: z.boolean(),
    products: z.string().trim().max(1000),
    willing: z.literal(true),
    providesId: z.literal(true),
    mobile: z.boolean(),
    shoppingFee: money,
    profilePhoto: z.string().regex(/^[a-f0-9]{24}$/),
    identityFile: z.string().regex(/^[a-f0-9]{24}$/),
  })
  .strict()
  .refine(
    (v) => !v.ownsBusiness || v.products.length > 0,
    "Describe the products your business sells.",
  );
export const customerOrder = z
  .object({
    shopperId: z.string().regex(/^[a-f0-9]{24}$/),
    market: text,
    customer: z.object({ name: text, email, phone, address: text }).strict(),
    items: z
      .array(
        z
          .object({
            name: text,
            quantity: z.number().positive().max(10000),
            unit: z.string().trim().min(1).max(40),
            estimatedUnitPrice: money.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    notes: z.string().trim().max(2000),
  })
  .strict();
export const quoteInput = z
  .object({
    unitPrices: z.array(money).min(1).max(100),
    transportFee: money,
    shoppingFee: money,
    note: z.string().trim().max(1000),
  })
  .strict();
export const settingsInput = z
  .object({
    shoppingFee: money.optional(),
    profilePhoto: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
    bankCode: z.string().trim().min(1).max(20).optional(),
    accountNumber: z
      .string()
      .regex(/^[0-9]{10}$/)
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide a change.")
  .refine(
    (v) => Boolean(v.bankCode) === Boolean(v.accountNumber),
    "Provide both bank and account number.",
  );
export function statusTransition(status: string, target: string) {
  return (
    (status === "paid" && target === "shopping") ||
    (status === "shopping" && target === "delivered")
  );
}
export function complaintOpen(deliveredAt: Date | undefined, now = new Date()) {
  return (
    !!deliveredAt &&
    now.getTime() >= deliveredAt.getTime() &&
    now.getTime() <= deliveredAt.getTime() + 24 * 3600000
  );
}
export function quoteTotals(
  prices: number[],
  quantities: number[],
  transport: number,
  fee: number,
  platform: number,
) {
  if (prices.length !== quantities.length)
    throw new Error("Every item needs a unit price.");
  const items = prices.reduce(
    (s, p, i) => s + Math.round(p * quantities[i]),
    0,
  );
  const total = items + transport + fee;
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    total > 1000000000 ||
    platform > fee
  )
    throw new Error("Invalid total or shopper fee below platform fee.");
  return {
    itemsTotal: items,
    total,
    platformFee: platform,
    shopperSettlement: total - platform,
  };
}
