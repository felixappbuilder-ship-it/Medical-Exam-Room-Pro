// convex/migrations/003_rename_device_info.ts
import { internalMutation } from "../_generated/server";

export const copyUserDeviceInfoToDeviceInfo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("userDeviceInfo").collect();
    for (const r of rows) {
      // Insert into the now-empty deviceInfo table
      await ctx.db.insert("deviceInfo", {
        userId: r.userId,
        infos: r.infos,
      });
      await ctx.db.delete(r._id);
    }
    return { moved: rows.length };
  },
});
