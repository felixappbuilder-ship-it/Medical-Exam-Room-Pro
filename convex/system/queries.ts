// convex/system/queries.ts
import { query } from "../_generated/server";
import { internal } from "../_generated/api";

// ============================================================
// GET SERVER TIME (public)
// ------------------------------------------------------------
// Lightweight endpoint that returns the backend's Date.now().
// Used by the frontend security module for time-drift detection
// and by any UI that needs an authoritative clock.
//
// The `success` wrapper matches every other public query so the
// frontend can use the same parsing helper everywhere.
// ============================================================
export const getServerTime = query({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runQuery(internal.system.internal.getServerTime, {});
    return {
      success: true,
      data: {
        serverTime: result.serverTime,
      },
    };
  },
});

// ============================================================
// GET APP CONFIG (public)
// ------------------------------------------------------------
// Returns all fields needed by the frontend to render:
//   - Trial duration (dynamic, default 24h)
//   - Subscription plans (admin-editable prices + metadata)
//   - Two-device discount and max devices (for multi-device UI)
//   - Custom amount penalty (informational for the frontend)
//   - Maintenance mode (frontend shows maintenance screen)
//   - Challenge winner points (leaderboard UI)
//
// Sensitive flags (paymentsFrozen) are intentionally NOT exposed
// here — they are enforced server-side only.
//
// Every optional field is coalesced to a concrete value so the
// frontend never has to null-check. `ensureAppConfig` keeps the
// singleton in the full shape; this query is the last safety net.
// ============================================================
export const getAppConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
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
        // ---- Core ----
        trialDurationHours: config.trialDurationHours ?? 24,
        maintenanceMode: config.maintenanceMode ?? false,
        maxRequestsPerMinute: config.maxRequestsPerMinute ?? 60,

        // ---- Subscription plans (full metadata) ----
        subscriptionPlans: (config.subscriptionPlans ?? []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          days: p.days,
          popular: p.popular ?? false,
          features: p.features ?? [],
          limitations: p.limitations ?? [],
          savings: p.savings ?? null,
          ctaText: p.ctaText ?? `Subscribe – KES ${p.price}`,
          ctaColor: p.ctaColor ?? "success",
          durationText: p.durationText ?? `${p.days} days`,
        })),

        // ---- Multi-device subscription settings ----
        twoDeviceDiscountPercent: config.twoDeviceDiscountPercent ?? 15,
        maxDevicesPerSubscription: config.maxDevicesPerSubscription ?? 2,
        customPenaltyPerDay: config.customPenaltyPerDay ?? 1.75,

        // ---- Leaderboard / challenge settings ----
        challengeWinnerPoints: config.challengeWinnerPoints ?? 10,

        // ---- Other admin-configurable flags that are safe to expose ----
        autoApproveWithdrawals: config.autoApproveWithdrawals ?? false,
      },
    };
  },
});