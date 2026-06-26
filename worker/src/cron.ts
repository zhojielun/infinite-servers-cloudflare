import { Env, ServersFile } from "./types";

const SETTINGS_KEY = "server_settings.json";

export async function runCronCheck(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);
  const hour = new Date().getHours();

  const tgRaw = await env.CONFIG.get<Record<string, unknown>>("config.json", "json");
  const tg = (tgRaw?.telegram as Record<string, unknown>) ?? {};
  const tgEnabled = tg.enabled && tg.bot_token && tg.chat_id;
  const botToken = String(tg.bot_token || "");
  const chatId = String(tg.chat_id || "");

  const serversRaw = await env.CONFIG.get("servers.json", "json") as ServersFile | null;
  if (!serversRaw?.servers) return;

  const settings = (await env.CONFIG.get<Record<string, Record<string, unknown>>>(SETTINGS_KEY, "json")) ?? {};
  let settingsChanged = false;

  for (const [name, sv] of Object.entries(serversRaw.servers)) {
    if (!sv.token || !sv.expiry) continue;

    const expTs = Math.floor(new Date(sv.expiry + "T00:00:00").getTime() / 1000);
    const daysUntilExpiry = Math.floor((expTs - now) / 86400);

    const row = await env.DB.prepare(
      "SELECT updated FROM server_status WHERE server = ?"
    ).bind(name).first<{ updated: number }>();
    const online = row ? (now - row.updated) < 900 : false;

    if (tgEnabled && daysUntilExpiry >= -4 && daysUntilExpiry <= 7 && hour === 0) {
      const lastNotified = (settings[name]?.expiry_notified as string) || "";
      if (lastNotified !== today) {
        const statusText = online ? "Online" : "Offline";
        let urgency: string;
        if (daysUntilExpiry > 0) urgency = `${daysUntilExpiry} day(s) left`;
        else if (daysUntilExpiry === 0) urgency = "Expires today";
        else urgency = `Expired ${Math.abs(daysUntilExpiry)} day(s) ago`;

        const msg = `[Expiry Alert]\nServer: ${name}\nStatus: ${statusText}\nExpiry: ${sv.expiry}\n${urgency}`;

        const ok = await sendTelegram(botToken, chatId, msg);
        if (ok) {
          if (!settings[name]) settings[name] = {};
          settings[name].expiry_notified = today;
          settingsChanged = true;
        }
      }
    }
  }

  if (settingsChanged) {
    await env.CONFIG.put(SETTINGS_KEY, JSON.stringify(settings, null, 2));
  }
}

async function sendTelegram(botToken: string, chatId: string, message: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ chat_id: chatId, text: message }).toString(),
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}
