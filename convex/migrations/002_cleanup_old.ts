import { internalMutation } from "../_generated/server";

export const deleteOldDeviceRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    let deletedInfo = 0;
    let deletedSessions = 0;
    let deletedDevices = 0;

    // Delete ALL old deviceInfo per-device rows (data lives in userDeviceInfo now)
    const infoRows = await ctx.db.query("deviceInfo").collect();
    for (const r of infoRows) {
      await ctx.db.delete(r._id);
      deletedInfo++;
    }

    // Delete sessions
    const sessions = await ctx.db.query("sessions").collect();
    for (const s of sessions) {
      await ctx.db.delete(s._id);
      deletedSessions++;
    }

    // Delete devices table rows
    const deviceRows = await ctx.db.query("devices").collect();
    for (const d of deviceRows) {
      await ctx.db.delete(d._id);
      deletedDevices++;
    }

    return { deletedInfo, deletedSessions, deletedDevices };
  },
});