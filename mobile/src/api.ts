import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";

export const API = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000"
)
  .trim()
  .replace(/\/+$/, "");

const TOKEN_STORAGE_KEY = "loran_token";
const ORDERS_STORAGE_KEY = "loran_orders";
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;

let token = "";

type UploadKind = "photo" | "identity";

type UploadResponse = {
  id?: unknown;
  error?: unknown;
};

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

function errorMessage(
  data: unknown,
  fallback: string,
): string {
  if (
    isRecord(data) &&
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }

  return fallback;
}

function parseResponse(
  text: string,
  status: number,
): unknown {
  if (!text.trim()) {
    if (status >= 200 && status < 300) {
      return null;
    }

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

export async function restoreSession(): Promise<boolean> {
  token =
    (await SecureStore.getItemAsync(TOKEN_STORAGE_KEY)) || "";

  return Boolean(token);
}

export async function saveSession(
  value: string,
): Promise<void> {
  if (!value.trim()) {
    throw new Error("The server returned an invalid session.");
  }

  await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, value);
  token = value;
}

export async function clearSession(): Promise<void> {
  token = "";
  await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
}

export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const normalizedPath = path.startsWith("/")
    ? path
    : `/${path}`;

  const url = `${API}/v1${normalizedPath}`;
  const startedAt = Date.now();

  // Exclude query parameters from logs.
  const loggedPath = normalizedPath.split("?")[0];

  debug("Request started", {
    method,
    path: loggedPath,
  });

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(token
          ? { Authorization: `Bearer ${token}` }
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

  let responseText: string;

  try {
    responseText = await response.text();
  } catch {
    debug("Response body could not be read", {
      method,
      path: loggedPath,
      status: response.status,
    });

    throw new Error(
      "The connection was interrupted while reading the server response. Please try again.",
    );
  }

  const data = parseResponse(
    responseText,
    response.status,
  );

  if (!response.ok) {
    debug("Request rejected by server", {
      method,
      path: loggedPath,
      status: response.status,
    });

    throw new Error(
      errorMessage(
        data,
        `Request failed (HTTP ${response.status}).`,
      ),
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
    return mimeType === "image/jpg"
      ? "image/jpeg"
      : mimeType;
  }

  const extension = name.split(".").pop()?.toLowerCase();

  switch (extension) {
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
    mimeType === "image/png"
      ? `${kind}.png`
      : `${kind}.jpg`;

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

  // Keep private identity uploads separate from profile photos.
  form.append("kind", kind);
  form.append("file", file, fileName);

  debug("Image upload started", {
    kind,
    size: file.size,
    mimeType,
  });

  // Let fetch generate the multipart Content-Type and boundary.
  const response = await expoFetch(`${API}/v1/uploads`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
    },
    body: form,
  });

  const responseText = await response.text();

  const parsed = parseResponse(
    responseText,
    response.status,
  );

  if (!response.ok) {
    debug("Image upload rejected", {
      kind,
      status: response.status,
    });

    throw new Error(
      errorMessage(
        parsed,
        `Upload failed (HTTP ${response.status}).`,
      ),
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      "The upload server returned an invalid response.",
    );
  }

  const data: UploadResponse = parsed;

  if (
    typeof data.id !== "string" ||
    !/^[a-f0-9]{24}$/.test(data.id)
  ) {
    throw new Error(
      "The upload server did not return a valid file ID.",
    );
  }

  debug("Image upload completed", {
    kind,
    status: response.status,
  });

  return data.id;
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

export async function rememberOrder(
  key: string,
): Promise<void> {
  const normalizedKey = key.trim().toUpperCase();

  if (!normalizedKey) return;

  const old = await recentOrders();

  const updated = [
    normalizedKey,
    ...old.filter((value) => value !== normalizedKey),
  ].slice(0, 10);

  await SecureStore.setItemAsync(
    ORDERS_STORAGE_KEY,
    JSON.stringify(updated),
  );
}

export async function recentOrders(): Promise<string[]> {
  const stored = await SecureStore.getItemAsync(
    ORDERS_STORAGE_KEY,
  );

  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (value): value is string =>
        typeof value === "string" &&
        value.trim().length > 0,
    );
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