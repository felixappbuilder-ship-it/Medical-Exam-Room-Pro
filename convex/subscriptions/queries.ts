// convex/subscriptions/queries.ts
import { query, action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// DEVICE NORMALIZER
// ------------------------------------------------------------
// Old app-store clients send: { deviceFingerprint }
// New clients send:           { deviceId, deviceInfo }
// Both are normalised to the same shape before anything else runs.
// ============================================================
function normalizeDeviceInput(input: {
  deviceId?: string | null;
  deviceFingerprint?: string | null;
}): { deviceId: string; deviceFingerprint: string } | null {
  const id =
    (typeof input.deviceId === "string" && input.deviceId.trim()) ||
    (typeof input.deviceFingerprint === "string" && input.deviceFingerprint.trim()) ||
    "";

  if (!id) return null;
  return { deviceId: id, deviceFingerprint: id };
}

// ============================================================
// 1. GET PLANS (full metadata for frontend rendering)
// ============================================================
export const getPlans = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
      return {
        success: false,
        error: "config_not_found",
        message: "System configuration missing.",
      };
    }
    return {
      success: true,
      data: {
        plans: config.subscriptionPlans,
        twoDeviceDiscountPercent: config.twoDeviceDiscountPercent ?? 15,
        maxDevicesPerSubscription: config.maxDevicesPerSubscription ?? 2,
        customPenaltyPerDay: config.customPenaltyPerDay ?? 1.75,
        trialDurationHours: config.trialDurationHours ?? 24,
      },
    };
  },
});

// ============================================================
// 2. GET SUBSCRIPTION STATUS (with device entitlement)
// ============================================================
export const getSubscriptionStatus = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify authentication token.";
      console.error("[getSubscriptionStatus] Token verification error:", message);
      return { success: false, error: "token_verification_failed", message };
    }

    const userId = payload.userId;
    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );

    if (!subscription) {
      return { success: true, data: null };
    }

    // Fetch devices registered on this subscription
    const devices = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionDevices,
      { subscriptionId: subscription._id }
    );
    const activeDevices = devices.filter((d) => !d.revoked);

    // Fetch deviceInfo array for the user (new tables) to enrich
    // each entry with a friendly display name.
    const infoArray = await ctx.runQuery(
      internal.subscriptions.internal.getUserDeviceInfoArray,
      { userId }
    );
    const idsArray = await ctx.runQuery(
      internal.subscriptions.internal.getUserDeviceIds,
      { userId }
    );
    const infoByDeviceId = new Map<string, any>();
    for (let i = 0; i < idsArray.length; i++) {
      if (infoArray[i]) infoByDeviceId.set(idsArray[i], infoArray[i]);
    }

    return {
      success: true,
      data: {
        _id: subscription._id,
        userId: subscription.userId,
        plan: subscription.plan,
        isActive: subscription.expiryDate > Date.now(),
        expiryDate: subscription.expiryDate,
        status: subscription.status,
        startDate: subscription.startDate,
        autoRenew: subscription.autoRenew ?? false,
        paymentMethod: subscription.paymentMethod ?? null,
        maxDevices: subscription.maxDevices ?? 1,
        hasTwoDeviceDiscount: subscription.hasTwoDeviceDiscount ?? false,
        devicesUsed: activeDevices.length,
        devices: activeDevices.map((d) => {
          const info = infoByDeviceId.get(d.deviceId) || {};
          return {
            deviceId: d.deviceId,
            platform: d.platform || info.platform || "unknown",
            deviceName: buildDisplayName(info),
            isPrimary: d.isPrimary,
            registeredAt: d.registeredAt,
            lastSeen: d.lastSeen,
          };
        }),
      },
    };
  },
});

// ============================================================
// 3. CHECK TRIAL ELIGIBILITY
// ------------------------------------------------------------
// Accepts BOTH old (deviceFingerprint) and new (deviceId) payloads.
// ============================================================
export const checkTrialEligibility = action({
  args: {
    token: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Normalise the device identifier
    const device = normalizeDeviceInput({
      deviceId: args.deviceId,
      deviceFingerprint: args.deviceFingerprint,
    });
    if (!device) {
      return {
        success: false,
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint } = device;

    // ---- Auth ----
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: result.error, message: result.message };
      }
      payload = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify authentication token.";
      console.error("[checkTrialEligibility] Token verification error:", message);
      return { success: false, error: "token_verification_failed", message };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) {
      return { success: false, error: "user_not_found", message: "User not found." };
    }

    // ---- Eligibility rules ----

    // 1. Trial already used on this account
    if (user.trialUsed) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "You have already used your free trial on this account.",
        },
      };
    }

    // 2. Device already used for trial on another account
    //    (legacy devices table — mirrored by addDevice on every write)
    const existingDevice = await ctx.runQuery(
      internal.subscriptions.internal.getDeviceByFingerprint,
      { fingerprint: deviceFingerprint }
    );
    if (existingDevice && existingDevice.userId !== userId) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "This device has already been used for a free trial on another account.",
        },
      };
    }

    // 3. deviceId lookup (redundant with #2 but explicit)
    const existingDeviceById = await ctx.runQuery(
      internal.subscriptions.internal.getDeviceByDeviceId,
      { deviceId }
    );
    if (existingDeviceById && existingDeviceById.userId !== userId) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "This device has already been used for a free trial on another account.",
        },
      };
    }

    // 4. Previous completed payment → not a new user
    const payments = await ctx.runQuery(
      internal.subscriptions.internal.getUserCompletedPayments,
      { userId }
    );
    if (payments.length > 0) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "You have already purchased a subscription. Free trial is for new users only.",
        },
      };
    }

    // 5. Existing non-trial subscription → not a new user
    const subscriptions = await ctx.runQuery(
      internal.subscriptions.internal.getUserSubscriptions,
      { userId }
    );
    const hasPaidPlan = subscriptions.some((sub) => sub.plan !== "trial");
    if (hasPaidPlan) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "You have already subscribed to a paid plan.",
        },
      };
    }

    return {
      success: true,
      data: {
        eligible: true,
        reason: "",
      },
    };
  },
});

// ============================================================
// 4. GET MY SUBSCRIPTION DEVICES (Manage Devices page)
// ============================================================
export const getMySubscriptionDevices = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auth failed";
      return { success: false, error: "token_verification_failed", message };
    }

    const userId = payload.userId;
    const sub = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    if (!sub) {
      return { success: true, data: { devices: [], maxDevices: 1, devicesUsed: 0 } };
    }

    const devices = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionDevices,
      { subscriptionId: sub._id }
    );
    const activeDevices = devices.filter((d) => !d.revoked);

    // Enrich with display names from the new per-user array
    const infoArray = await ctx.runQuery(
      internal.subscriptions.internal.getUserDeviceInfoArray,
      { userId }
    );
    const idsArray = await ctx.runQuery(
      internal.subscriptions.internal.getUserDeviceIds,
      { userId }
    );
    const infoByDeviceId = new Map<string, any>();
    for (let i = 0; i < idsArray.length; i++) {
      if (infoArray[i]) infoByDeviceId.set(idsArray[i], infoArray[i]);
    }

    return {
      success: true,
      data: {
        maxDevices: sub.maxDevices ?? 1,
        devicesUsed: activeDevices.length,
        devices: activeDevices.map((d) => {
          const info = infoByDeviceId.get(d.deviceId) || {};
          return {
            deviceId: d.deviceId,
            platform: d.platform || info.platform || "unknown",
            deviceName: buildDisplayName(info),
            isPrimary: d.isPrimary,
            registeredAt: d.registeredAt,
            lastSeen: d.lastSeen,
          };
        }),
      },
    };
  },
});

// ============================================================
// 5. CHECK DEVICE ACCESS
// ------------------------------------------------------------
// Accepts BOTH deviceId and deviceFingerprint; deviceId wins.
// ============================================================
export const checkDeviceAccess = action({
  args: {
    token: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const device = normalizeDeviceInput({
      deviceId: args.deviceId,
      deviceFingerprint: args.deviceFingerprint,
    });
    if (!device) {
      return {
        success: false,
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId } = device;

    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auth failed";
      return { success: false, error: "token_verification_failed", message };
    }

    const userId = payload.userId;
    const sub = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    if (!sub) {
      return { success: true, data: { allowed: false, reason: "no_active_subscription" } };
    }

    if (sub.expiryDate <= Date.now()) {
      return { success: true, data: { allowed: false, reason: "subscription_expired" } };
    }

    const devices = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionDevices,
      { subscriptionId: sub._id }
    );
    const activeDevices = devices.filter((d) => !d.revoked);
    const matching = activeDevices.find((d) => d.deviceId === deviceId);

    if (matching) {
      return {
        success: true,
        data: {
          allowed: true,
          isPrimary: matching.isPrimary,
          devicesUsed: activeDevices.length,
        },
      };
    }

    // Not registered yet — check if there is room
    const maxDevices = sub.maxDevices ?? 1;
    if (activeDevices.length < maxDevices) {
      return {
        success: true,
        data: {
          allowed: true,
          needsRegistration: true,
          devicesUsed: activeDevices.length,
          maxDevices,
        },
      };
    }

    return {
      success: true,
      data: {
        allowed: false,
        reason: "max_devices_reached",
        devicesUsed: activeDevices.length,
        maxDevices,
      },
    };
  },
});

// ============================================================
// 6. GET DEVICE INFO JSON
// ------------------------------------------------------------
// Reads from the NEW per-user array first (source of truth),
// then falls back to the legacy per-device table.
// ============================================================
export const getDeviceInfo = action({
  args: { token: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Auth failed" };
    }

    const userId = payload.userId;

    // Source 1: new per-user arrays
    const idsArray = await ctx.runQuery(
      internal.subscriptions.internal.getUserDeviceIds,
      { userId }
    );
    const infoArray = await ctx.runQuery(
      internal.subscriptions.internal.getUserDeviceInfoArray,
      { userId }
    );

    const idx = idsArray.indexOf(args.deviceId);
    if (idx >= 0 && infoArray[idx]) {
      return {
        success: true,
        data: {
          deviceId: args.deviceId,
          platform: infoArray[idx]?.platform || "unknown",
          info: infoArray[idx],
          source: "array" as const,
        },
      };
    }

    // Source 2: legacy per-device table
    const legacy = await ctx.runQuery(
      internal.subscriptions.internal.getDeviceInfoByDeviceId,
      { deviceId: args.deviceId }
    );

    if (!legacy) {
      return { success: true, data: null };
    }

    // Only return if it belongs to the caller (or is unowned)
    if (legacy.userId && legacy.userId !== userId) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        deviceId: legacy.deviceId,
        platform: legacy.platform,
        info: legacy.info,
        updatedAt: legacy.updatedAt,
        source: "legacy" as const,
      },
    };
  },
});

// ============================================================
// DISPLAY NAME HELPER
// ------------------------------------------------------------
// Derives a friendly label from the deviceInfo blob.
// ============================================================
function buildDisplayName(info: any): string {
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