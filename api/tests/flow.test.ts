import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import supertest from "supertest";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import {
  quoteTotals,
  complaintOpen,
  statusTransition,
} from "../src/validation.js";
test("money, lifecycle and complaint boundaries", () => {
  assert.deepEqual(quoteTotals([150000], [2], 100000, 50000, 20000), {
    itemsTotal: 300000,
    total: 450000,
    platformFee: 20000,
    shopperSettlement: 430000,
  });
  assert.throws(() => quoteTotals([100], [1], 0, 10, 20));
  assert.equal(statusTransition("new", "shopping"), false);
  assert.equal(statusTransition("paid", "shopping"), true);
  assert.equal(statusTransition("shopping", "delivered"), true);
  const delivered = new Date("2026-01-01T00:00:00Z");
  assert.equal(
    complaintOpen(delivered, new Date("2026-01-02T00:00:00Z")),
    true,
  );
  assert.equal(
    complaintOpen(delivered, new Date("2026-01-02T00:00:00.001Z")),
    false,
  );
});
test("full order/payment/complaint/OTP/admin flow against temporary MongoDB", async () => {
  process.env.SESSION_SECRET =
    "private-test-secret-not-for-production-123456789";
  process.env.FILE_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
  const mongo = await MongoMemoryServer.create({
    instance: { args: process.platform === "win32" ? [] : ["--nounixsocket"] },
  });
  const originalFetch = globalThis.fetch;
  try {
    await mongoose.connect(mongo.getUri("loran_test"));
    const { app } = await import("../src/app.js");
    const {
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
    } = await import("../src/models.js");
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
    const transactions = new Map<string, { amount: number; email: string }>();
    globalThis.fetch = async (input, options) => {
      const url = String(input);
      let data: unknown;
      if (url.endsWith("/transaction/initialize")) {
        const body = JSON.parse(String(options?.body));
        transactions.set(body.reference, {
          amount: body.amount,
          email: body.email,
        });
        data = {
          authorization_url: "https://checkout.paystack.com/test",
          reference: body.reference,
        };
      } else if (url.includes("/transaction/verify/")) {
        const reference = url.split("/").at(-1)!;
        const t = transactions.get(reference)!;
        data = {
          status: "success",
          reference,
          amount: t.amount,
          currency: "NGN",
          customer: { email: t.email },
        };
      } else if (url.includes("/bank/resolve")) {
        data = { account_name: "Demo Shopper", account_number: "0123456789" };
      } else if (url.includes("/bank?")) {
        data = [{ name: "Demo Bank", code: "001" }];
      } else throw new Error("Unexpected external URL");
      return new Response(JSON.stringify({ status: true, data }), {
        headers: { "Content-Type": "application/json" },
      });
    };
    const agent = supertest(app);
    let checks = 0;
    const expectStatus = async (request: supertest.Test, status: number) => {
      const response = await request;
      assert.equal(response.status, status, JSON.stringify(response.body));
      checks++;
      return response;
    };
    const password = "Very-private-password-2026";
    const admin = await Account.create({
      role: "superadmin",
      status: "approved",
      email: "admin@example.com",
      passwordHash: await bcrypt.hash(password, 4),
    });
    const login = await expectStatus(
      agent.post("/v1/login").send({ email: admin.email, password }),
      200,
    );
    const adminToken = login.body.token;
    const png = Buffer.from("89504e470d0a1a0a0000000041424344", "hex");
    const identity = await expectStatus(
      agent
        .post("/v1/uploads")
        .field("kind", "identity")
        .attach("file", Buffer.from("%PDF-test-identification"), "id.pdf"),
      201,
    );
    const photo = await expectStatus(
      agent
        .post("/v1/uploads")
        .field("kind", "photo")
        .attach("file", png, "photo.png"),
      201,
    );
    const registration = {
      surname: "Shopper",
      firstName: "Demo",
      otherNames: "",
      email: "shopper@example.com",
      password,
      phone: "+2348012345678",
      address: "Demo address",
      residence: "Makurdi",
      state: "Benue",
      markets: ["Demo Market"],
      ownsBusiness: false,
      products: "",
      willing: true,
      providesId: true,
      mobile: false,
      shoppingFee: 50000,
      profilePhoto: photo.body.id,
      identityFile: identity.body.id,
    };
    await expectStatus(agent.post("/v1/register").send(registration), 201);
    let shopperLogin = await expectStatus(
      agent.post("/v1/login").send({ email: registration.email, password }),
      200,
    );
    let token = shopperLogin.body.token;
    await expectStatus(
      agent
        .patch("/v1/me/availability")
        .set("Authorization", "Bearer " + token)
        .send({ available: true }),
      403,
    );
    const account = await Account.findOne({ email: registration.email });
    await expectStatus(
      agent
        .patch("/v1/admin/shoppers/" + account!._id)
        .set("Authorization", "Bearer " + adminToken)
        .send({ status: "approved", reason: "Identity checked" }),
      200,
    );
    await expectStatus(
      agent.get("/v1/me").set("Authorization", "Bearer " + token),
      401,
    );
    shopperLogin = await expectStatus(
      agent.post("/v1/login").send({ email: registration.email, password }),
      200,
    );
    token = shopperLogin.body.token;
    await expectStatus(
      agent
        .patch("/v1/me/availability")
        .set("Authorization", "Bearer " + token)
        .send({ available: true }),
      200,
    );
    const list = await expectStatus(agent.get("/v1/shoppers"), 200);
    assert.equal(list.body.records.length, 1);
    assert.equal(list.body.records[0].identityFile, undefined);
    assert.equal(list.body.records[0].email, undefined);
    await expectStatus(agent.get("/v1/photos/" + identity.body.id), 404);
    const encrypted = await Asset.findById(identity.body.id);
    assert.notDeepEqual(
      encrypted!.bytes,
      Buffer.from("%PDF-test-identification"),
    );
    await expectStatus(
      agent.get("/v1/admin/identity/" + identity.body.id),
      401,
    );
    await expectStatus(
      agent
        .get("/v1/admin/identity/" + identity.body.id)
        .set("Authorization", "Bearer " + adminToken),
      200,
    );
    await expectStatus(
      agent
        .patch("/v1/admin/platform")
        .set("Authorization", "Bearer " + adminToken)
        .send({ platformFee: 20000 }),
      200,
    );
    const create = await expectStatus(
      agent.post("/v1/orders").send({
        shopperId: String(account!._id),
        market: "Demo Market",
        customer: {
          name: "Customer Demo",
          email: "customer@example.com",
          phone: "+2348011111111",
          address: "Delivery address",
        },
        items: [
          { name: "Rice", quantity: 2, unit: "kg", estimatedUnitPrice: null },
        ],
        notes: "Good quality",
      }),
      201,
    );
    const key = create.body.orderKey;
    assert.match(key, /^LR-[A-F0-9]{32}$/);
    const order = await Order.findOne({ orderKey: key });
    const orderId = String(order!._id);
    await expectStatus(
      agent.get("/v1/order").set("X-Order-Key", "LR-" + "A".repeat(32)),
      404,
    );
    await expectStatus(
      agent
        .post(`/v1/me/orders/${orderId}/status`)
        .set("Authorization", "Bearer " + token)
        .send({ status: "shopping" }),
      409,
    );
    await expectStatus(
      agent
        .post(`/v1/me/orders/${orderId}/quote`)
        .set("Authorization", "Bearer " + token)
        .send({
          unitPrices: [150000],
          transportFee: 100000,
          shoppingFee: 50000,
          note: "Costed",
        }),
      200,
    );
    const quoted = await expectStatus(
      agent.get("/v1/order").set("X-Order-Key", key),
      200,
    );
    assert.equal(quoted.body.quote.platformFee, undefined);
    assert.equal(quoted.body.quote.total, 450000);
    await expectStatus(
      agent
        .post("/v1/order/quote-decision")
        .set("X-Order-Key", key)
        .send({ accept: true, revision: 0, reason: "" }),
      409,
    );
    await expectStatus(
      agent
        .post("/v1/order/quote-decision")
        .set("X-Order-Key", key)
        .send({ accept: false, revision: 1, reason: "Transport too high" }),
      200,
    );
    await expectStatus(
      agent
        .post(`/v1/me/orders/${orderId}/quote`)
        .set("Authorization", "Bearer " + token)
        .send({
          unitPrices: [150000],
          transportFee: 100000,
          shoppingFee: 50000,
          note: "Reviewed",
        }),
      200,
    );
    await expectStatus(
      agent
        .post("/v1/order/quote-decision")
        .set("X-Order-Key", key)
        .send({ accept: true, revision: 2, reason: "" }),
      200,
    );
    const pay = await expectStatus(
      agent.post("/v1/order/pay").set("X-Order-Key", key).send({ amount: 1 }),
      200,
    );
    assert.equal(
      (await Payment.findOne({ reference: pay.body.reference }))!.amount,
      450000,
    );
    const again = await expectStatus(
      agent.post("/v1/order/pay").set("X-Order-Key", key).send({}),
      200,
    );
    assert.equal(again.body.reference, pay.body.reference);
    await expectStatus(
      agent.post("/v1/order/verify-payment").set("X-Order-Key", key).send({}),
      200,
    );
    await expectStatus(
      agent.post("/v1/order/verify-payment").set("X-Order-Key", key).send({}),
      200,
    );
    assert.equal(
      (await Order.findById(orderId))!.history.filter(
        (h) => h.status === "paid",
      ).length,
      1,
    );
    const event = {
      event: "charge.success",
      data: {
        status: "success",
        reference: pay.body.reference,
        amount: 450000,
        currency: "NGN",
        customer: { email: "customer@example.com" },
      },
    };
    const raw = JSON.stringify(event);
    await expectStatus(
      agent
        .post("/webhooks/paystack")
        .set("Content-Type", "application/json")
        .set("x-paystack-signature", "0".repeat(128))
        .send(raw),
      401,
    );
    await expectStatus(
      agent
        .post("/webhooks/paystack")
        .set("Content-Type", "application/json")
        .set(
          "x-paystack-signature",
          createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!)
            .update(raw)
            .digest("hex"),
        )
        .send(raw),
      200,
    );
    await expectStatus(
      agent
        .post(`/v1/me/orders/${orderId}/status`)
        .set("Authorization", "Bearer " + token)
        .send({ status: "shopping" }),
      200,
    );
    await expectStatus(
      agent
        .post(`/v1/me/orders/${orderId}/status`)
        .set("Authorization", "Bearer " + token)
        .send({ status: "delivered" }),
      200,
    );
    await expectStatus(
      agent.post("/v1/order/complaint").set("X-Order-Key", key).send({
        subject: "Item quality",
        message: "The rice quality is poor.",
      }),
      201,
    );
    await expectStatus(
      agent
        .post(`/v1/admin/orders/${orderId}/payout`)
        .set("Authorization", "Bearer " + adminToken)
        .send({ reference: "BANK-123", amount: 430000 }),
      409,
    );
    await Order.updateOne(
      { _id: orderId },
      { $set: { deliveredAt: new Date(Date.now() - 25 * 3600000) } },
    );
    await expectStatus(
      agent
        .post(`/v1/admin/orders/${orderId}/payout`)
        .set("Authorization", "Bearer " + adminToken)
        .send({ reference: "BANK-123", amount: 430000 }),
      409,
    );
    await expectStatus(
      agent
        .post("/v1/me/settings/request")
        .set("Authorization", "Bearer " + token)
        .send({
          bankCode: "001",
          accountNumber: "0123456789",
          shoppingFee: 60000,
        }),
      200,
    );
    const mail = await Mail.findOne({
      subject: "Approve your loRan Shopper settings change",
    }).sort({ createdAt: -1 });
    const code = mail!.text!.match(/code is ([0-9]{6})/)![1];
    await expectStatus(
      agent
        .post("/v1/me/settings/confirm")
        .set("Authorization", "Bearer " + token)
        .send({ code: "000000" }),
      400,
    );
    await expectStatus(
      agent
        .post("/v1/me/settings/confirm")
        .set("Authorization", "Bearer " + token)
        .send({ code }),
      200,
    );
    await expectStatus(
      agent
        .post("/v1/me/settings/confirm")
        .set("Authorization", "Bearer " + token)
        .send({ code }),
      400,
    );
    assert.equal(
      (await Account.findById(account!._id))!.bank.accountName,
      "Demo Shopper",
    );
    const ticket = await Ticket.findOne({ orderId });
    await expectStatus(
      agent
        .patch("/v1/admin/tickets/" + ticket!._id)
        .set("Authorization", "Bearer " + adminToken)
        .send({ resolution: "Customer issue reviewed and resolved." }),
      200,
    );
    await expectStatus(
      agent
        .post(`/v1/admin/orders/${orderId}/payout`)
        .set("Authorization", "Bearer " + adminToken)
        .send({ reference: "BANK-123", amount: 430000 }),
      200,
    );
    await expectStatus(
      agent
        .post(`/v1/admin/orders/${orderId}/payout`)
        .set("Authorization", "Bearer " + adminToken)
        .send({ reference: "BANK-123", amount: 430000 }),
      409,
    );
    await expectStatus(
      agent.get("/v1/admin/payments").set("Authorization", "Bearer " + token),
      403,
    );
    await expectStatus(
      agent
        .post("/v1/admin/announcements")
        .set("Authorization", "Bearer " + adminToken)
        .send({
          title: "Welcome shoppers",
          body: "New markets are available.",
        }),
      201,
    );
    assert.equal(
      (
        await expectStatus(
          agent
            .get("/v1/announcements")
            .set("Authorization", "Bearer " + token),
          200,
        )
      ).body.length,
      1,
    );
    const earnings = await expectStatus(
      agent.get("/v1/me/earnings").set("Authorization", "Bearer " + token),
      200,
    );
    assert.equal(earnings.body.cleared, 430000);
    assert.equal(earnings.body.shoppingEarnings, 30000);
    const outsider = await Account.create({
      role: "shopper",
      status: "approved",
      email: "outsider@example.com",
      passwordHash: await bcrypt.hash(password, 4),
    });
    const outsiderLogin = await expectStatus(
      agent.post("/v1/login").send({ email: outsider.email, password }),
      200,
    );
    await expectStatus(
      agent
        .post(`/v1/me/orders/${orderId}/status`)
        .set("Authorization", "Bearer " + outsiderLogin.body.token)
        .send({ status: "delivered" }),
      404,
    );
    await expectStatus(
      agent.post("/v1/password/request").send({ email: registration.email }),
      200,
    );
    const resetMail = await Mail.findOne({
      subject: "Reset your loRan Shopper password",
    }).sort({ createdAt: -1 });
    const resetCode = resetMail!.text!.match(/code is ([0-9]{6})/)![1];
    await expectStatus(
      agent
        .post("/v1/password/confirm")
        .send({
          email: registration.email,
          code: resetCode,
          password: "Another-private-password-2026",
        }),
      200,
    );
    await expectStatus(
      agent.get("/v1/me").set("Authorization", "Bearer " + token),
      401,
    );
    await expectStatus(
      agent
        .post("/v1/password/confirm")
        .send({
          email: registration.email,
          code: resetCode,
          password: "Another-private-password-2026",
        }),
      400,
    );
    const renewed = await expectStatus(
      agent
        .post("/v1/login")
        .send({
          email: registration.email,
          password: "Another-private-password-2026",
        }),
      200,
    );
    token = renewed.body.token;
    await expectStatus(
      agent
        .patch("/v1/admin/shoppers/" + account!._id)
        .set("Authorization", "Bearer " + adminToken)
        .send({ status: "suspended", reason: "Complaint review" }),
      200,
    );
    await expectStatus(
      agent.get("/v1/me").set("Authorization", "Bearer " + token),
      401,
    );
    await expectStatus(
      agent.post("/v1/login").send({ email: registration.email, password }),
      401,
    );
    assert.equal(
      (await expectStatus(agent.get("/v1/shoppers"), 200)).body.records.length,
      0,
    );
    console.log(
      `${checks} HTTP assertions passed, plus storage, payment and access-control assertions.`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await mongoose.disconnect();
    await mongo.stop();
  }
});
