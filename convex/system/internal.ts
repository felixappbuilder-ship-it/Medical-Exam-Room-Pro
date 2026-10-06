// convex/system/internal.ts
import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// SERVER TIME — used by the frontend for time-drift detection
// ============================================================
export const getServerTime = internalQuery({
  args: {},
  handler: async () => {
    return { serverTime: Date.now() };
  },
});

// ============================================================
// SHARED LINKS
// ============================================================

export const getExpiredSharedLinks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return await ctx.db
      .query("sharedLinks")
      .withIndex("by_expiry", (q) => q.lt("expiry", now))
      .collect();
  },
});

export const deleteSharedLink = internalMutation({
  args: { linkId: v.id("sharedLinks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});

// ============================================================
// APP CONFIG – SINGLETON
// ------------------------------------------------------------
// Uses the first document in the table as the singleton.
// Never rely on a fixed _id literal — Convex manages IDs.
//
// The bridge schema has every new field marked optional so old
// rows validate. These helpers keep the singleton in the new
// shape (all fields present) so downstream reads never need
// `?? defaultValue` fallbacks.
// ============================================================

export const getAppConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appConfig").first();
  },
});

// ------------------------------------------------------------
// DEFAULT PLAN DEFINITIONS
// ------------------------------------------------------------
const DEFAULT_PLANS = [
  {
    id: "monthly",
    name: "Monthly Plan",
    price: 300,
    days: 30,
    popular: false,
    features: [
      "Full access to all subjects",
      "All exam modes (practice, timed, mock)",
      "Detailed analytics and weak-area detection",
      "Certificate generation",
      "Priority support",
    ],
    limitations: ["Single device only", "No notes export"],
    ctaText: "Subscribe – KES 300",
    ctaColor: "success",
    durationText: "30 days",
  },
  {
    id: "quarterly",
    name: "Quarterly Plan",
    price: 850,
    days: 90,
    popular: true,
    features: [
      "Everything in Monthly",
      "Unlimited notes + AI summarization",
      "PDF downloads",
      "Priority support",
      "Save KES 50",
    ],
    savings: "Save KES 50",
    ctaText: "Subscribe – KES 850",
    ctaColor: "success",
    durationText: "3 months",
  },
  {
    id: "yearly",
    name: "Yearly Plan",
    price: 2100,
    days: 270,
    popular: false,
    features: [
      "Everything in Quarterly",
      "Unlimited notes + AI summarization",
      "PDF downloads",
      "Certificate generation",
      "Priority support",
      "Save KES 600",
    ],
    savings: "Save KES 600",
    ctaText: "Subscribe – KES 2,100",
    ctaColor: "success",
    durationText: "9 months",
  },
];

// ------------------------------------------------------------
// ENSURE APP CONFIG
// ------------------------------------------------------------
// 1. If no config exists  → insert the full default config.
// 2. If a config exists   → backfill any missing fields so the
//    singleton always matches the new shape.
//
// Idempotent — safe to call from every action.
// ============================================================
export const ensureAppConfig = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("appConfig").first();

    // ---- Case 1: no config at all ----
    if (!existing) {
      await ctx.db.insert("appConfig", {
        trialDurationHours: 24,
        maintenanceMode: false,
        subscriptionPlans: DEFAULT_PLANS,
        paymentsFrozen: false,
        maxRequestsPerMinute: 60,
        autoApproveWithdrawals: false,
        challengeWinnerPoints: 10,
        twoDeviceDiscountPercent: 15,
        customPenaltyPerDay: 1.75,
        maxDevicesPerSubscription: 2,
      });
      return { action: "created" };
    }

    // ---- Case 2: config exists — backfill any missing fields ----
    const repairs: Record<string, any> = {};

    // System fields
    if (existing.twoDeviceDiscountPercent === undefined) {
      repairs.twoDeviceDiscountPercent = 15;
    }
    if (existing.customPenaltyPerDay === undefined) {
      repairs.customPenaltyPerDay = 1.75;
    }
    if (existing.maxDevicesPerSubscription === undefined) {
      repairs.maxDevicesPerSubscription = 2;
    }
    if (existing.autoApproveWithdrawals === undefined) {
      repairs.autoApproveWithdrawals = false;
    }
    if (existing.challengeWinnerPoints === undefined) {
      repairs.challengeWinnerPoints = 10;
    }

    // Subscription plans — normalise each entry so every plan
    // carries the full metadata shape (id, features, cta, etc.).
    const plans = existing.subscriptionPlans ?? [];
    const normalisedPlans = plans.map((plan: any) => {
      // Derive a stable id if missing
      let id = plan.id;
      if (!id) {
        const lower = String(plan.name || "").toLowerCase();
        if (lower.includes("month")) id = "monthly";
        else if (lower.includes("quarter")) id = "quarterly";
        else if (lower.includes("year")) id = "yearly";
        else id = lower.replace(/\s+/g, "-").slice(0, 20) || "plan";
      }

      // Find the matching default plan (if any) for the missing bits
      const defaultPlan = DEFAULT_PLANS.find((p) => p.id === id);

      return {
        id,
        name: plan.name,
        price: plan.price,
        days: plan.days,
        popular: plan.popular ?? defaultPlan?.popular ?? false,
        features: plan.features ?? defaultPlan?.features ?? [
          "Full access to all subjects",
          "All exam modes",
          "Detailed analytics",
        ],
        limitations: plan.limitations ?? defaultPlan?.limitations ?? undefined,
        savings: plan.savings ?? defaultPlan?.savings ?? undefined,
        ctaText: plan.ctaText ?? defaultPlan?.ctaText ?? `Subscribe – KES ${plan.price}`,
        ctaColor: plan.ctaColor ?? defaultPlan?.ctaColor ?? "success",
        durationText: plan.durationText ?? defaultPlan?.durationText ?? `${plan.days} days`,
      };
    });

    // Only write plans back if any were normalised
    const plansNeedUpdate =
      normalisedPlans.length !== plans.length ||
      normalisedPlans.some((p: any, i: number) => {
        const orig: any = plans[i];
        return (
          p.id !== orig.id ||
          p.popular !== orig.popular ||
          JSON.stringify(p.features) !== JSON.stringify(orig.features) ||
          p.ctaText !== orig.ctaText ||
          p.durationText !== orig.durationText
        );
      });

    if (plansNeedUpdate) {
      repairs.subscriptionPlans = normalisedPlans;
    }

    if (Object.keys(repairs).length > 0) {
      await ctx.db.patch(existing._id, repairs);
      return { action: "repaired", repaired: Object.keys(repairs) };
    }

    return { action: "unchanged" };
  },
});

// ------------------------------------------------------------
// UPDATE APP CONFIG (admin)
// ------------------------------------------------------------
// Caller is responsible for verifying the admin role before
// calling this. Accepts partial updates; every field is optional.
// ============================================================
export const updateAppConfigInternal = internalMutation({
  args: {
    updates: v.object({
      trialDurationHours: v.optional(v.number()),
      maintenanceMode: v.optional(v.boolean()),
      subscriptionPlans: v.optional(
        v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            price: v.number(),
            days: v.number(),
            popular: v.optional(v.boolean()),
            features: v.array(v.string()),
            limitations: v.optional(v.array(v.string())),
            savings: v.optional(v.string()),
            ctaText: v.optional(v.string()),
            ctaColor: v.optional(v.string()),
            durationText: v.optional(v.string()),
          })
        )
      ),
      paymentsFrozen: v.optional(v.boolean()),
      maxRequestsPerMinute: v.optional(v.number()),
      autoApproveWithdrawals: v.optional(v.boolean()),
      challengeWinnerPoints: v.optional(v.number()),
      twoDeviceDiscountPercent: v.optional(v.number()),
      customPenaltyPerDay: v.optional(v.number()),
      maxDevicesPerSubscription: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
      throw new Error("AppConfig missing – run ensureAppConfig first");
    }
    await ctx.db.patch(config._id, args.updates);
  },
});