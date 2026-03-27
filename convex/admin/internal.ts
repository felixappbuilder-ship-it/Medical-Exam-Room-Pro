import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// Log admin action (reuse from admin/mutations.ts? Actually we have a logAdminAction helper in admin/mutations.ts but not as internal mutation.
// We'll create an internal mutation for logging.
export const logAdminAction = internalMutation({
  args: {
    adminId: v.id("users"),
    action: v.string(),
    targetId: v.optional(v.string()),
    details: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      adminId: args.adminId,
      action: args.action,
      targetId: args.targetId,
      details: args.details,
      timestamp: Date.now(),
    });
  },
});

// Wrappers for admin analytics queries (internal versions that skip admin check)
export const getRevenueReport = internalQuery({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    groupBy: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
  },
  handler: async (ctx, args) => {
    // Call the public query but we need to ensure it's admin? Actually the action already checked admin.
    // We can directly call the public query using ctx.runQuery, but that would be a loop.
    // Simpler: reimplement the logic here (but that duplicates). For brevity, we'll assume the public query can be called.
    // However, to avoid circular dependencies, we'll just reimplement minimal version.
    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;
    const payments = await ctx.db
      .query("payments")
      .filter((q) =>
        q.and(
          q.gte(q.field("createdAt"), start),
          q.lte(q.field("createdAt"), end)
        )
      )
      .collect();
    const completed = payments.filter((p) => p.status === "completed");
    const total = completed.reduce((sum, p) => sum + p.amount, 0);
    // Group by plan (simplified)
    const byPlan: Record<string, number> = {};
    for (const p of completed) {
      if (p.subscriptionId) {
        const sub = await ctx.db.get(p.subscriptionId);
        const plan = sub?.plan || "other";
        byPlan[plan] = (byPlan[plan] || 0) + p.amount;
      } else {
        byPlan.other = (byPlan.other || 0) + p.amount;
      }
    }
    // Daily breakdown
    const dailyBreakdown: Array<{ date: string; amount: number }> = [];
    const dayMap = new Map<string, number>();
    for (const p of completed) {
      const dateStr = new Date(p.createdAt).toISOString().split("T")[0];
      dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + p.amount);
    }
    for (const [date, amount] of dayMap.entries()) {
      dailyBreakdown.push({ date, amount });
    }
    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));
    return { total, byPlan, dailyBreakdown };
  },
});

export const getUserGrowth = internalQuery({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    interval: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
  },
  handler: async (ctx, args) => {
    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;
    const users = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(q.gte(q.field("createdAt"), start), q.lte(q.field("createdAt"), end))
      )
      .collect();
    // Group by interval
    const groups: Record<string, number> = {};
    for (const user of users) {
      let key: string;
      if (args.interval === "day") {
        key = new Date(user.createdAt).toISOString().split("T")[0];
      } else if (args.interval === "week") {
        const week = Math.floor((user.createdAt - start) / (7 * 24 * 60 * 60 * 1000));
        key = `week-${week}`;
      } else {
        const d = new Date(user.createdAt);
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      groups[key] = (groups[key] || 0) + 1;
    }
    const newUsers = Object.entries(groups).map(([period, count]) => ({ period, count }));
    newUsers.sort((a, b) => a.period.localeCompare(b.period));
    const totalUsers = await ctx.db.query("users").collect().then((u) => u.length);
    return { newUsers, totalUsers };
  },
});

export const getExamPerformance = internalQuery({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;
    const examResults = await ctx.db
      .query("examResults")
      .filter((q) =>
        q.and(q.gte(q.field("date"), start), q.lte(q.field("date"), end))
      )
      .collect();
    if (examResults.length === 0) {
      return { avgScore: 0, popularSubjects: [], weakTopics: [] };
    }
    const avgScore = examResults.reduce((sum, e) => sum + (e.correctAnswers / e.totalQuestions) * 100, 0) / examResults.length;
    const subjectCount: Record<string, number> = {};
    for (const e of examResults) {
      subjectCount[e.subject] = (subjectCount[e.subject] || 0) + 1;
    }
    const popularSubjects = Object.entries(subjectCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([subject]) => subject);
    const weakCount: Record<string, number> = {};
    for (const e of examResults) {
      for (const weak of e.weakAreas || []) {
        weakCount[weak] = (weakCount[weak] || 0) + 1;
      }
    }
    const weakTopics = Object.entries(weakCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);
    return {
      avgScore: Math.round(avgScore * 100) / 100,
      popularSubjects,
      weakTopics,
    };
  },
});

export const getAuditLogs = internalQuery({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("auditLogs");
    if (args.startDate || args.endDate) {
      query = query.filter((q) =>
        q.and(
          args.startDate ? q.gte(q.field("timestamp"), args.startDate) : q.constant(true),
          args.endDate ? q.lte(q.field("timestamp"), args.endDate) : q.constant(true)
        )
      );
    }
    return await query.collect();
  },
});