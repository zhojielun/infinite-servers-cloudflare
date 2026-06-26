import { Env, ServerConfig, ServersFile, HistoryRow } from "./types";
import { getConfig, getServers } from "./kv";

function stripSecrets(data: Record<string, unknown>): Record<string, unknown> {
  const { token: _, name: __, ...rest } = data;
  return rest;
}

async function getServersConfig(env: Env): Promise<ServersFile> {
  const raw = await env.CONFIG.get("servers.json", "json");
  return (raw as ServersFile) ?? { servers: {} };
}

async function batchFirstSeen(
  env: Env,
  names: string[],
): Promise<Record<string, string | null>> {
  if (names.length === 0) return {};
  const placeholders = names.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT server, MIN(ts) AS first FROM history WHERE server IN (${placeholders}) GROUP BY server`,
  )
    .bind(...names)
    .all<{ server: string; first: number | null }>();
  const map: Record<string, string | null> = {};
  for (const row of results) {
    map[row.server] = row.first
      ? new Date(row.first * 1000).toISOString().split("T")[0]
      : null;
  }
  return map;
}

async function batchDbFetch(
  env: Env,
  table: string,
  names: string[],
): Promise<Record<string, { data: string }>> {
  if (names.length === 0) return {};
  const placeholders = names.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT server, data FROM ${table} WHERE server IN (${placeholders})`,
  )
    .bind(...names)
    .all<{ server: string; data: string }>();
  const map: Record<string, { data: string }> = {};
  for (const row of results) {
    map[row.server] = row;
  }
  return map;
}

async function getIntervalSeconds(env: Env): Promise<number> {
  const config = await getConfig(env);
  return Math.max(0.5, config["history-interval"]) * 60;
}

export async function saveServerInfo(
  env: Env,
  name: string,
  info: Record<string, unknown>,
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO server_info (server, data, updated) VALUES (?, ?, ?)"
  )
    .bind(name, JSON.stringify(stripSecrets(info)), ts)
    .run();
}

export async function saveServerStatus(
  env: Env,
  name: string,
  status: Record<string, unknown>,
): Promise<void> {
  const interval = await getIntervalSeconds(env);
  const time = parseInt(String(status.time ?? 0), 10);
  const ts = Math.floor(time / interval) * interval;

  const loadavg = status.loadavg;
  const meminfo = (status.meminfo as Record<string, unknown>) ?? {};
  const diskinfo = (status.diskinfo as Record<string, unknown>) ?? {};
  const netdev = (status.netdev as Record<string, unknown>) ?? {};

  const load1 = Array.isArray(loadavg) ? parseFloat(String(loadavg[0] ?? 0)) : parseFloat(String(loadavg ?? 0));
  const memPct = parseFloat(String(meminfo.memUsedPercent ?? 0));
  const diskPct = parseFloat(String(diskinfo.diskPercent ?? 0));
  const netRx = parseInt(String(netdev.rx ?? 0), 10);
  const netTx = parseInt(String(netdev.tx ?? 0), 10);
  const cores = parseInt(String((status.cpuinfo as Record<string, unknown>)?.num ?? 1), 10) || 1;
  const cpuPct = status.cpu_percent != null
    ? parseFloat(String(status.cpu_percent))
    : Math.min(100, Math.round((load1 / cores) * 100));
  const swapPct = parseFloat(String(meminfo.swapPercent ?? 0));

  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO history (server, ts, load1, mem_pct, disk_pct, net_rx, net_tx, cpu_pct, swap_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(name, ts, load1, memPct, diskPct, netRx, netTx, cpuPct, swapPct),
    env.DB.prepare(
      "INSERT OR REPLACE INTO server_status (server, data, updated) VALUES (?, ?, ?)"
    ).bind(name, JSON.stringify(stripSecrets(status)), Math.floor(Date.now() / 1000)),
  ]);

  // keep at most ~100 records per server; clean excess
  const serverCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM history WHERE server = ?")
    .bind(name)
    .first<{ cnt: number }>();
  const cnt = serverCount?.cnt ?? 0;
  if (cnt > 100) {
    const cutoff = ts - 100 * await getIntervalSeconds(env);
    await env.DB.prepare("DELETE FROM history WHERE server = ? AND ts < ?").bind(name, cutoff).run();
  }
}

export async function getServerInfo(
  env: Env,
): Promise<Record<string, Record<string, unknown>>> {
  const { servers } = await getServersConfig(env);
  const info: Record<string, Record<string, unknown>> = {};
  const settings = await getSettings(env);

  const names = Object.keys(servers).filter((n) => servers[n].token);

  const firstSeenMap = await batchFirstSeen(env, names);

  const fetchResults = await Promise.allSettled(
    names.map(async (name) => {
      const cfg = servers[name];
      if (!cfg.url) return null;
      const resp = await fetch(`${cfg.url}?k=s`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;
      return { name, data: (await resp.json()) as Record<string, unknown> };
    }),
  );

  const fetchedNames = new Set<string>();
  for (const result of fetchResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { name, data } = result.value;
    fetchedNames.add(name);
    const ts = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT OR REPLACE INTO server_info (server, data, updated) VALUES (?, ?, ?)"
    )
      .bind(name, JSON.stringify(stripSecrets(data)), ts)
      .run();
    info[name] = buildServerEntry(data, name, servers[name], firstSeenMap[name], settings[name]);
  }

  const dbNames = names.filter((n) => !fetchedNames.has(n));
  const dbRows = await batchDbFetch(env, "server_info", dbNames);

  for (const name of dbNames) {
    const row = dbRows[name];
    if (row) {
      const parsed = JSON.parse(row.data);
      info[name] = buildServerEntry(parsed, name, servers[name], firstSeenMap[name], settings[name]);
    } else {
      info[name] = buildServerEntry({}, name, servers[name], firstSeenMap[name], settings[name]);
    }
  }

  return info;
}

export async function getServerStatus(
  env: Env,
): Promise<Record<string, Record<string, unknown>>> {
  const { servers } = await getServersConfig(env);
  const status: Record<string, Record<string, unknown>> = {};

  const names = Object.keys(servers).filter((n) => servers[n].token);

  const fetchResults = await Promise.allSettled(
    names.map(async (name) => {
      const cfg = servers[name];
      if (!cfg.url) return null;
      const resp = await fetch(`${cfg.url}?k=r`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;
      return { name, data: (await resp.json()) as Record<string, unknown> };
    }),
  );

  const fetchedNames = new Set<string>();
  const inserts: ReturnType<typeof env.DB.prepare>[] = [];
  for (const result of fetchResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { name, data } = result.value;
    fetchedNames.add(name);
    status[name] = stripSecrets(data);
    const ts = Math.floor(Date.now() / 1000);
    inserts.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO server_status (server, data, updated) VALUES (?, ?, ?)"
      ).bind(name, JSON.stringify(stripSecrets(data)), ts),
    );
  }
  if (inserts.length > 0) {
    await env.DB.batch(inserts);
  }

  const dbNames = names.filter((n) => !fetchedNames.has(n));
  const dbRows = await batchDbFetch(env, "server_status", dbNames);
  for (const name of dbNames) {
    const row = dbRows[name];
    if (row) {
      const raw = stripSecrets(JSON.parse(row.data));
      // normalize old "ip" field to "ip4"
      if (!raw.ip4 && raw.ip) {
        raw.ip4 = raw.ip;
        delete raw.ip;
      }
      status[name] = raw;
    }
  }

  return status;
}

function buildServerEntry(
  data: Record<string, unknown>,
  name: string,
  cfg: ServerConfig,
  firstSeen: string | null,
  settings?: Record<string, unknown>,
): Record<string, unknown> {
  const s = settings ?? {};
  const raw = stripSecrets(data);
  return {
    ...raw,
    name,
    region: cfg.region || "",
    location: cfg.location || "",
    tags: cfg.tags || [],
    expiry: (s.expiry as string) || cfg.expiry || null,
    purchase_date: (s.purchase_date as string) || cfg.purchase_date || null,
    ip4: (raw.ip4 as string) || (raw.ip as string) || null,
    ip6: (raw.ip6 as string) || null,
    ip_mask: cfg.ip_mask || null,
    first_seen: firstSeen,
  };
}

export async function getServerHistory(
  env: Env,
  name: string,
  hours: number,
): Promise<HistoryRow[]> {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const { results } = await env.DB.prepare(
    "SELECT ts, load1, mem_pct, disk_pct, net_rx, net_tx, cpu_pct, swap_pct FROM history WHERE server = ? AND ts >= ? ORDER BY ts ASC"
  )
    .bind(name, since)
    .all<HistoryRow>();
  return results;
}

export async function getServerIncidents(
  env: Env,
  name: string,
  days: number,
): Promise<
  { kind: string; startTs: number; endTs: number | null; downMin: number }[]
> {
  const interval = await getIntervalSeconds(env);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const gapThreshold = interval * 5;

  const { results } = await env.DB.prepare(
    "SELECT ts FROM history WHERE server = ? AND ts >= ? ORDER BY ts ASC"
  )
    .bind(name, since)
    .all<{ ts: number }>();

  if (results.length < 2) return [];

  const tsList = results.map((r) => r.ts);
  const incidents: {
    kind: string;
    startTs: number;
    endTs: number | null;
    downMin: number;
  }[] = [];
  let gapStart: number | null = null;

  for (let i = 1; i < tsList.length; i++) {
    const gap = tsList[i] - tsList[i - 1];
    if (gap > gapThreshold) {
      if (gapStart === null) gapStart = tsList[i - 1];
    } else {
      if (gapStart !== null) {
        const downMin = Math.floor((tsList[i] - gapStart) / 60);
        incidents.push({ kind: "outage", startTs: gapStart, endTs: tsList[i], downMin });
        gapStart = null;
      }
    }
  }

  if (gapStart !== null) {
    const now = Math.floor(Date.now() / 1000);
    const downMin = Math.floor((now - gapStart) / 60);
    incidents.push({ kind: "outage", startTs: gapStart, endTs: null, downMin });
  }

  return incidents.reverse().slice(0, 10);
}

export async function getServerAvailability(
  env: Env,
  name: string,
  days: number,
): Promise<{
  overall: number;
  days: { date: number; pct: number | null; status: string }[];
  incidents: { kind: string; startTs: number; endTs: number | null; downMin: number }[];
}> {
  const interval = await getIntervalSeconds(env);
  const now = Math.floor(Date.now() / 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);
  const winStart = todayStartSec - (days - 1) * 86400;

  const firstSeenRow = await env.DB.prepare(
    "SELECT MIN(ts) AS first FROM history WHERE server = ?"
  )
    .bind(name)
    .first<{ first: number | null }>();
  const firstSeen = firstSeenRow?.first ?? null;

  const { results: countResults } = await env.DB.prepare(
    "SELECT CAST((ts - ?) / 86400 AS INTEGER) AS bucket, COUNT(*) AS c FROM history WHERE server = ? AND ts >= ? GROUP BY bucket"
  )
    .bind(winStart, name, winStart)
    .all<{ bucket: number; c: number }>();

  const counts: Record<number, number> = {};
  for (const row of countResults) {
    counts[row.bucket] = row.c;
  }

  const dayList: { date: number; pct: number | null; status: string }[] = [];
  const incidents: { kind: string; startTs: number; endTs: number | null; downMin: number }[] = [];
  let sumPct = 0;
  let counted = 0;

  for (let i = 0; i < days; i++) {
    const start = winStart + i * 86400;
    const end = start + 86400;
    const expected = Math.max(1, Math.floor((Math.min(end, now) - start) / interval));
    const present = counts[i] ?? 0;
    const pct = Math.min(100, (present / expected) * 100);

    if (firstSeen === null || end <= firstSeen) {
      dayList.push({ date: start, pct: null, status: "nodata" });
      continue;
    }

    let status: string;
    if (pct >= 99) status = "up";
    else if (pct >= 90) status = "partial";
    else status = "down";

    const pctRound = Math.round(pct * 10) / 10;
    dayList.push({ date: start, pct: pctRound, status });
    sumPct += pctRound;
    counted++;

    if (status !== "up") {
      const downMin = Math.floor(((100 - pct) / 100) * 24 * 60);
      incidents.push({
        kind: status === "down" ? "outage" : "degraded",
        startTs: start,
        endTs: null,
        downMin,
      });
    }
  }

  const overall = counted > 0 ? Math.round((sumPct / counted) * 1000) / 1000 : 0;

  return {
    overall,
    days: dayList,
    incidents: incidents.reverse().slice(0, 5),
  };
}

const SETTINGS_KEY = "server_settings.json";

async function getSettings(env: Env): Promise<Record<string, Record<string, unknown>>> {
  return (await env.CONFIG.get<Record<string, Record<string, unknown>>>(SETTINGS_KEY, "json")) ?? {};
}

export async function saveServerExpiry(
  env: Env,
  name: string,
  expiry: string | null,
): Promise<boolean> {
  const servers = await getServers(env);
  if (!servers[name]) return false;
  const settings = await getSettings(env);
  if (!settings[name]) settings[name] = {};
  if (expiry) {
    settings[name].expiry = expiry;
  } else {
    delete settings[name].expiry;
  }
  await env.CONFIG.put(SETTINGS_KEY, JSON.stringify(settings, null, 2));
  return true;
}

export async function saveServerPurchaseDate(
  env: Env,
  name: string,
  purchaseDate: string | null,
): Promise<boolean> {
  const servers = await getServers(env);
  if (!servers[name]) return false;
  const settings = await getSettings(env);
  if (!settings[name]) settings[name] = {};
  if (purchaseDate) {
    settings[name].purchase_date = purchaseDate;
  } else {
    delete settings[name].purchase_date;
  }
  await env.CONFIG.put(SETTINGS_KEY, JSON.stringify(settings, null, 2));
  return true;
}
