import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";

export const API = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000"
).trim().replace(/\/+$/, "");

const TOKEN_STORAGE_KEY = "loran_token";
const ORDERS_STORAGE_KEY = "loran_orders";
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

let token = "";
let sessionVersion = 0;
let sessionStorageTask: Promise<void> = Promise.resolve();

type UploadKind = "photo" | "identity";
type SessionExpiredListener = () => void;

const sessionExpiredListeners =
  new Set<SessionExpiredListener>();

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session expired. Please sign in again.");
    this.name = "SessionExpiredError";
  }
}

function debug(
  message: string,
  details?: Record<string, unknown>,
): void {
  if (__DEV__) {
    console.log(`[API] ${message}`, details ?? "");
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function errorMessage(data: unknown, fallback: string): string {
  if (
    isRecord(data) &&
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }
  return fallback;
}

function parseResponse(text: string, status: number): unknown {
  if (!text.trim()) {
    if (status >= 200 && status < 300) return null;
    throw new Error(
      `The server returned an empty response (HTTP ${status}).`,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `The server returned an unreadable response (HTTP ${status}).`,
    );
  }
}

function updateSessionStorage(
  task: () => Promise<void>,
): Promise<void> {
  const next = sessionStorageTask.then(task, task);
  sessionStorageTask = next.catch(() => undefined);
  return next;
}

export function getSessionVersion(): number {
  return sessionVersion;
}

export function hasSavedSession(): boolean {
  return Boolean(token);
}

export function onSessionExpired(
  listener: SessionExpiredListener,
): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export async function restoreSession(): Promise<boolean> {
  const version = sessionVersion;
  await sessionStorageTask;

  const stored =
    (await SecureStore.getItemAsync(TOKEN_STORAGE_KEY)) || "";

  if (version === sessionVersion) token = stored;
  return Boolean(token);
}

export async function saveSession(value: string): Promise<void> {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("The server returned an invalid session.");
  }

  await updateSessionStorage(() =>
    SecureStore.setItemAsync(TOKEN_STORAGE_KEY, normalized),
  );

  sessionVersion += 1;
  token = normalized;
}

export async function clearSession(): Promise<void> {
  token = "";
  sessionVersion += 1;

  await updateSessionStorage(() =>
    SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY),
  );
}

async function expireSession(
  rejectedToken: string,
  rejectedVersion: number,
): Promise<void> {
  if (
    !rejectedToken ||
    token !== rejectedToken ||
    sessionVersion !== rejectedVersion
  ) {
    return;
  }

  const clearing = clearSession();

  for (const listener of sessionExpiredListeners) {
    try {
      listener();
    } catch {
      debug("Session expiration listener failed");
    }
  }

  try {
    await clearing;
  } catch {
    debug("Could not remove expired session from storage");
  }
}

function isShopperSessionPath(path: string): boolean {
  const pathname = path.split("?")[0];
  return (
    pathname === "/me" ||
    pathname.startsWith("/me/") ||
    pathname === "/announcements"
  );
}

export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API}/v1${normalizedPath}`;
  const loggedPath = normalizedPath.split("?")[0];
  const startedAt = Date.now();
  const requestToken = token;
  const requestVersion = sessionVersion;

  debug("Request started", { method, path: loggedPath });

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(requestToken
          ? { Authorization: `Bearer ${requestToken}` }
          : {}),
        ...(body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(key ? { "X-Order-Key": key } : {}),
      },
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    debug("Network request failed", {
      method,
      path: loggedPath,
      elapsedMs: Date.now() - startedAt,
    });

    throw new Error(
      "Cannot reach the API. Check your internet connection, API server, and EXPO_PUBLIC_API_URL.",
    );
  }

  debug("Response headers received", {
    method,
    path: loggedPath,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  });

  if (
    response.status === 401 &&
    isShopperSessionPath(normalizedPath)
  ) {
    await expireSession(requestToken, requestVersion);
    throw new SessionExpiredError();
  }

  let responseText: string;

  try {
    responseText = await response.text();
  } catch {
    throw new Error(
      "The connection was interrupted while reading the server response. Please try again.",
    );
  }

  const data = parseResponse(responseText, response.status);

  if (!response.ok) {
    debug("Request rejected by server", {
      method,
      path: loggedPath,
      status: response.status,
    });

    throw new Error(
      errorMessage(data, `Request failed (HTTP ${response.status}).`),
    );
  }

  debug("Request completed", {
    method,
    path: loggedPath,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  });

  return data as T;
}

function resolveMimeType(
  name: string,
  suppliedType: string,
): string {
  const mimeType = suppliedType.trim().toLowerCase();

  if (mimeType && mimeType !== "application/octet-stream") {
    return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  }

  switch (name.split(".").pop()?.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "";
  }
}

export async function upload(
  uri: string,
  name: string,
  type: string,
  kind: UploadKind,
): Promise<string> {
  if (!uri.trim()) {
    throw new Error("Please select an image first.");
  }

  const mimeType = resolveMimeType(name, type);

  if (!["image/jpeg", "image/png"].includes(mimeType)) {
    throw new Error(
      kind === "identity"
        ? "Choose a JPEG or PNG image of your ID. PDF uploads are not supported."
        : "Choose a JPEG or PNG profile picture.",
    );
  }

  const fallbackName =
    mimeType === "image/png" ? `${kind}.png` : `${kind}.jpg`;

  const fileName = name.trim() || fallbackName;
  const file = new File(uri);

  if (!file.exists) {
    throw new Error(
      "The selected image is unavailable. Please select it again.",
    );
  }
  if (file.size === 0) {
    throw new Error("The selected image is empty.");
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new Error("The image must be 5 MB or smaller.");
  }

  const form = new FormData();
  form.append("kind", kind);
  form.append("file", file, fileName);

  debug("Image upload started", {
    kind,
    size: file.size,
    mimeType,
  });

  const response = await expoFetch(`${API}/v1/uploads`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });

  const parsed = parseResponse(
    await response.text(),
    response.status,
  );

  if (!response.ok) {
    throw new Error(
      errorMessage(parsed, `Upload failed (HTTP ${response.status}).`),
    );
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.id !== "string" ||
    !/^[a-f0-9]{24}$/.test(parsed.id)
  ) {
    throw new Error(
      "The upload server did not return a valid file ID.",
    );
  }

  debug("Image upload completed", {
    kind,
    status: response.status,
  });

  return parsed.id;
}

export function toKobo(value: string): number {
  const amount = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new Error(
      "Enter a valid naira amount with up to 2 decimal places.",
    );
  }

  const kobo = Math.round(Number(amount) * 100);

  if (!Number.isSafeInteger(kobo)) {
    throw new Error("The amount is too large.");
  }

  return kobo;
}

export async function rememberOrder(key: string): Promise<void> {
  const normalizedKey = key.trim().toUpperCase();
  if (!normalizedKey) return;

  const old = await recentOrders();

  await SecureStore.setItemAsync(
    ORDERS_STORAGE_KEY,
    JSON.stringify(
      [
        normalizedKey,
        ...old.filter((value) => value !== normalizedKey),
      ].slice(0, 10),
    ),
  );
}

export async function recentOrders(): Promise<string[]> {
  const stored = await SecureStore.getItemAsync(ORDERS_STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: "Awaiting quote",
    quoted: "Quote ready",
    accepted: "Awaiting payment",
    quote_rejected: "Quote rejected",
    paid: "Payment received",
    shopping: "Shopping in progress",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return labels[status] || status;
}

export function naira(kobo: number): string {
  return (
    "₦" +
    (kobo / 100).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}