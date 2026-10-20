import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const API = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(
  /\/$/,
  "",
);
// Admin tokens intentionally live in memory only, never localStorage.
let token = "";
async function request<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(API + "/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
const money = (v: number) =>
  "₦" + (v / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 });
function kobo(v: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(v))
    throw new Error("Enter a valid naira amount.");
  return Math.round(Number(v) * 100);
}
type Row = { _id: string; [key: string]: unknown };
type Quote = {
  total: number;
  platformFee: number;
  shopperSettlement: number;
  unitPrices: number[];
  transportFee: number;
  shoppingFee: number;
};
type Account = Row & {
  surname: string;
  firstName: string;
  email: string;
  phone: string;
  status: string;
  identityFile: string;
  markets: string[];
  shoppingFee: number;
  bank?: { name: string; accountName: string; accountNumber: string };
};
type Order = Row & {
  shopperId: string;
  status: string;
  customer: { name: string; email: string; phone: string; address: string };
  quote?: Quote;
  deliveredAt?: string;
  payout?: { reference: string; amount: number };
  items: { name: string; quantity: number; unit: string }[];
};
type Ticket = Row & {
  status: string;
  customer: Order["customer"];
  subject: string;
  message: string;
  resolution?: string;
};
function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState("shoppers");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState("");
  const [news, setNews] = useState({ title: "", body: "" });
  const [newAdmin, setNewAdmin] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [payout, setPayout] = useState({ reference: "", amount: "" });
  const [reason, setReason] = useState("");
  const [bank, setBank] = useState<Account["bank"]>();
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete request.");
    } finally {
      setBusy(false);
    }
  }
  async function load(section = tab, p = page) {
    if (
      ["shoppers", "orders", "payments", "tickets", "pay"].includes(section)
    ) {
      const data = await request<{ records: Row[]; total: number }>(
        `/admin/${section === "pay" ? "orders" : section}?page=${p}`,
      );
      setRows(data.records);
      setTotal(data.total);
    }
    if (section === "platform") {
      const data = await request<{ platformFee: number }>("/admin/platform");
      setPlatform(String(data.platformFee / 100));
    }
  }
  useEffect(() => {
    if (signedIn) void action(() => load());
  }, [signedIn, tab, page]);
  function change(v: string) {
    setTab(v);
    setPage(1);
    setSelected(null);
    setReason("");
    setBank(undefined);
  }
  async function identity(id: string) {
    const res = await fetch(API + "/v1/admin/identity/" + id, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error("Identity document unavailable.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "shopper-identification." +
      (blob.type === "application/pdf"
        ? "pdf"
        : blob.type === "image/png"
          ? "png"
          : "jpg");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return (
    <>
      <header>
        <strong>
          loRan <span>Shopper</span>
        </strong>
        <small>Operations portal</small>
        {signedIn && (
          <button
            onClick={() =>
              action(async () => {
                await request("/logout", "POST", {});
                token = "";
                setSignedIn(false);
                setPassword("");
              })
            }
          >
            Logout
          </button>
        )}
      </header>
      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success" role="status">
            {message}
          </p>
        )}
        {busy && <p>Working…</p>}
        {!signedIn ? (
          <section className="login panel">
            <h1>Admin sign in</h1>
            <p>This portal is separate from the customer and shopper app.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const data = await request<{ token: string; role: string }>(
                    "/login",
                    "POST",
                    { email, password },
                  );
                  if (!["admin", "superadmin"].includes(data.role))
                    throw new Error("Administrator access required.");
                  token = data.token;
                  setRole(data.role);
                  setSignedIn(true);
                  setPassword("");
                });
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button disabled={busy}>Sign in</button>
            </form>
          </section>
        ) : (
          <>
            <nav>
              {[
                "shoppers",
                "orders",
                "payments",
                "tickets",
                "pay",
                "platform",
                "announcements",
                ...(role === "superadmin" ? ["admins"] : []),
              ].map((v) => (
                <button
                  key={v}
                  className={tab === v ? "active" : ""}
                  onClick={() => change(v)}
                >
                  {v === "pay" ? "Pay / settlements" : v}
                </button>
              ))}
            </nav>
            <h1>
              {tab === "pay"
                ? "Shopper settlements"
                : tab[0].toUpperCase() + tab.slice(1)}
            </h1>
            {["shoppers", "orders", "payments", "tickets", "pay"].includes(
              tab,
            ) && (
              <>
                <div className="panel">
                  <button onClick={() => action(() => load())} disabled={busy}>
                    Refresh
                  </button>
                  <div className="table">
                    <table>
                      <thead>
                        <tr>
                          <th>Record</th>
                          <th>Status</th>
                          <th>Details</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row._id}>
                            <td>
                              {tab === "shoppers"
                                ? String(row.firstName) +
                                  " " +
                                  String(row.surname)
                                : tab === "orders" || tab === "pay"
                                  ? String(
                                      (row.customer as Order["customer"])?.name,
                                    )
                                  : tab === "payments"
                                    ? String(row.reference)
                                    : String(row.subject)}
                              <small>{row._id}</small>
                            </td>
                            <td>
                              {String(row.status || "—")}
                              {!!row.payout && (
                                <span className="badge">Cleared</span>
                              )}
                            </td>
                            <td>
                              {tab === "shoppers"
                                ? String(row.email)
                                : tab === "payments"
                                  ? money(Number(row.amount))
                                  : tab === "tickets"
                                    ? String(
                                        (row.customer as Order["customer"])
                                          ?.phone,
                                      )
                                    : String(
                                        (
                                          row.assignedShopper as {
                                            firstName?: string;
                                            surname?: string;
                                          }
                                        )?.firstName || "",
                                      ) +
                                      " " +
                                      String(
                                        (
                                          row.assignedShopper as {
                                            surname?: string;
                                          }
                                        )?.surname || "",
                                      )}
                            </td>
                            <td>
                              <button
                                onClick={() =>
                                  action(async () => {
                                    setSelected(row);
                                    setReason("");
                                    setPayout({
                                      reference: "",
                                      amount: (row.quote as Quote)
                                        ?.shopperSettlement
                                        ? String(
                                            (row.quote as Quote)
                                              .shopperSettlement / 100,
                                          )
                                        : "",
                                    });
                                    if (tab === "pay") {
                                      const o = row as Order;
                                      const accounts = await request<Account>(
                                        `/admin/shopper/${o.shopperId}`,
                                      );
                                      setBank(accounts.bank);
                                    }
                                  })
                                }
                              >
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length === 0 && <p>No records found.</p>}
                  <div className="pagination">
                    <button
                      disabled={page === 1 || busy}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page} · {total} records
                    </span>
                    <button
                      disabled={page * 20 >= total || busy}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
            {selected && (
              <section className="panel">
                <h2>Record details</h2>
                {tab === "shoppers" ? (
                  <>
                    <Details value={selected} />
                    <button
                      onClick={() =>
                        action(() =>
                          identity((selected as Account).identityFile),
                        )
                      }
                    >
                      Download private identification
                    </button>
                    <label>
                      Approval / rejection / suspension reason
                      <textarea
                        required
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="actions">
                      {["approved", "rejected", "suspended"].map((status) => (
                        <button
                          key={status}
                          disabled={busy || !reason}
                          onClick={() =>
                            action(async () => {
                              await request(
                                `/admin/shoppers/${selected._id}`,
                                "PATCH",
                                { status, reason },
                              );
                              setSelected(null);
                              await load();
                              setMessage("Shopper status updated.");
                            })
                          }
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </>
                ) : tab === "tickets" ? (
                  <>
                    <p>
                      <strong>{(selected as Ticket).subject}</strong>
                    </p>
                    <p>{(selected as Ticket).message}</p>
                    <Details value={(selected as Ticket).customer} />
                    <label>
                      Resolution / refund explanation
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={
                        busy || (selected as Ticket).status === "resolved"
                      }
                      onClick={() =>
                        action(async () => {
                          await request(
                            `/admin/tickets/${selected._id}`,
                            "PATCH",
                            { resolution: reason },
                          );
                          await load();
                          setSelected(null);
                          setMessage(
                            "Complaint resolved and customer email queued.",
                          );
                        })
                      }
                    >
                      Resolve complaint
                    </button>
                  </>
                ) : (
                  <>
                    <Details value={selected} />
                    {tab === "pay" && (
                      <>
                        <h3>Verified shopper bank details</h3>
                        {bank ? (
                          <p>
                            {bank.name}
                            <br />
                            {bank.accountName}
                            <br />
                            {bank.accountNumber}
                          </p>
                        ) : (
                          <p>Bank details have not been verified.</p>
                        )}
                        <p>
                          Only record a bank transfer you have already
                          completed. This button does not move funds. Recording
                          is blocked until 24 hours after delivery and while a
                          complaint is open.
                        </p>
                        <label>
                          Transfer reference
                          <input
                            value={payout.reference}
                            onChange={(e) =>
                              setPayout({
                                ...payout,
                                reference: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Amount transferred, ₦
                          <input
                            value={payout.amount}
                            onChange={(e) =>
                              setPayout({ ...payout, amount: e.target.value })
                            }
                          />
                        </label>
                        <button
                          disabled={busy || !!selected.payout || !bank}
                          onClick={() => {
                            if (
                              !confirm(
                                "Confirm you have actually transferred this amount to the displayed bank account?",
                              )
                            )
                              return;
                            void action(async () => {
                              await request(
                                `/admin/orders/${selected._id}/payout`,
                                "POST",
                                {
                                  reference: payout.reference,
                                  amount: kobo(payout.amount),
                                },
                              );
                              await load();
                              setSelected(null);
                              setMessage("Shopper paid in full recorded.");
                            });
                          }}
                        >
                          Shopper paid in full
                        </button>
                      </>
                    )}
                  </>
                )}
              </section>
            )}
            {tab === "platform" && (
              <section className="panel">
                <h2>Platform fee per new quote</h2>
                <p>
                  A flat naira amount deducted from the shopper settlement.
                  Existing quotes retain their snapshot. Customers see the
                  complete items, transport and shopping total.
                </p>
                <label>
                  Platform fee, ₦
                  <input
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request("/admin/platform", "PATCH", {
                        platformFee: kobo(platform),
                      });
                      setMessage("Platform fee updated.");
                    })
                  }
                >
                  Save fee
                </button>
              </section>
            )}
            {tab === "announcements" && (
              <section className="panel">
                <h2>Announcement to shoppers</h2>
                <label>
                  Title
                  <input
                    value={news.title}
                    onChange={(e) =>
                      setNews({ ...news, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  Message
                  <textarea
                    value={news.body}
                    onChange={(e) => setNews({ ...news, body: e.target.value })}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request("/admin/announcements", "POST", news);
                      setNews({ title: "", body: "" });
                      setMessage(
                        "Announcement published to shopper dashboards.",
                      );
                    })
                  }
                >
                  Publish announcement
                </button>
              </section>
            )}
            {tab === "admins" && (
              <section className="panel">
                <h2>Create another administrator</h2>
                <p>Only the super admin can create accounts.</p>
                <label>
                  Name
                  <input
                    value={newAdmin.name}
                    onChange={(e) =>
                      setNewAdmin({ ...newAdmin, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={newAdmin.email}
                    onChange={(e) =>
                      setNewAdmin({ ...newAdmin, email: e.target.value })
                    }
                  />
                </label>
                <label>
                  Temporary password (12+ characters)
                  <input
                    type="password"
                    value={newAdmin.password}
                    onChange={(e) =>
                      setNewAdmin({ ...newAdmin, password: e.target.value })
                    }
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request("/admin/admins", "POST", newAdmin);
                      setNewAdmin({ name: "", email: "", password: "" });
                      setMessage("Admin created. Share credentials privately.");
                    })
                  }
                >
                  Create administrator
                </button>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Details({
  value,
  field = "",
}: {
  value: unknown;
  field?: string;
}): React.ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number")
    return (
      <span>
        {[
          "amount",
          "shoppingFee",
          "total",
          "transportFee",
          "platformFee",
          "shopperSettlement",
          "itemsTotal",
          "estimatedUnitPrice",
        ].includes(field)
          ? money(value)
          : String(value)}
      </span>
    );
  if (typeof value === "string") return <span>{value}</span>;
  if (Array.isArray(value))
    return (
      <div>
        {value.map((v, i) => (
          <div className="detail-block" key={i}>
            <Details value={v} field={field} />
          </div>
        ))}
      </div>
    );
  if (typeof value === "object")
    return (
      <dl className="details">
        {Object.entries(value)
          .filter(
            ([k]) =>
              ![
                "_id",
                "__v",
                "version",
                "shopperId",
                "identityFile",
                "profilePhoto",
                "orderId",
                "createdBy",
                "sessionVersion",
                "passwordReset",
                "otp",
              ].includes(k),
          )
          .map(([k, v]) => (
            <div key={k}>
              <dt>
                {k
                  .replace(/([A-Z])/g, " $1")
                  .replace(/^./, (s) => s.toUpperCase())}
              </dt>
              <dd>
                <Details value={v} field={k} />
              </dd>
            </div>
          ))}
      </dl>
    );
  return null;
}

createRoot(document.getElementById("root")!).render(<App />);
