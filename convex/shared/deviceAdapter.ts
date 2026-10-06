// convex/shared/deviceAdapter.ts

/**
 * Adapter that accepts the OLD payload from app-store clients AND the
 * NEW payload from updated clients, and always returns the new shape.
 *
 * Old clients send:
 *   { deviceFingerprint: "...", deviceInfo: {...}? }
 *
 * New clients send:
 *   { deviceId: "dv_…", deviceInfo: { browser, osName, ... } }
 *
 * Both are normalised to { deviceId, deviceInfo }.
 *
 * This is the ONLY place where legacy field names are recognised.
 * Every action calls this before touching the database.
 */

export interface NormalizedDevice {
  deviceId: string;
  deviceInfo: Record<string, any>;
}

export function normalizeDeviceInput(input: {
  deviceId?: string;
  deviceFingerprint?: string;
  deviceInfo?: any;
}): NormalizedDevice {
  // Priority: deviceId > deviceFingerprint
  const rawId = input.deviceId || input.deviceFingerprint;

  if (!rawId || typeof rawId !== "string" || rawId.trim().length === 0) {
    throw new Error("DEVICE_ID_REQUIRED");
  }

  // Normalise deviceInfo to a plain object. Old clients may send
  // { platform: "web" } or nothing at all.
  let info: Record<string, any> = {};
  if (input.deviceInfo && typeof input.deviceInfo === "object") {
    info = { ...input.deviceInfo };
  }

  // Old clients may have sent the platform string as the entire deviceInfo.
  if (typeof input.deviceInfo === "string") {
    info = { platform: input.deviceInfo };
  }

  // Ensure platform is at least present
  if (!info.platform) {
    info.platform = "unknown";
  }

  return {
    deviceId: rawId.trim(),
    deviceInfo: info,
  };
}

/**
 * Derive a display name from a deviceInfo blob.
 * Used when writing user.devices[] entries.
 */
export function buildDisplayName(info: any): string {
  if (!info || typeof info !== "object") return "Unknown device";
  const platform = String(info.platform || "").toLowerCase();

  if (platform === "android") {
    const brand = String(info.manufacturer || "").trim();
    const model = String(info.model || "").trim();
    return [brand, model].filter(Boolean).join(" ") || "Android device";
  }
  if (platform === "ios") return String(info.model || "").trim() || "iPhone / iPad";
  if (platform === "windows") return "Windows PC";

  const browser = info.browser || "Browser";
  const os = info.osName || "Web";
  return `${browser} on ${os}`;
}