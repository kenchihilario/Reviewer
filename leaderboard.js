// Vercel serverless function: GET /api/leaderboard?board=0..5|b   POST /api/leaderboard
// Storage: Upstash Redis (Vercel Marketplace). Env vars are added automatically when you connect it.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const BOARDS = ["0", "1", "2", "3", "4", "5", "b"];

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const getIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.headers["x-real-ip"] ||
  (req.socket && req.socket.remoteAddress) ||
  "unknown";

// Public display only shows part of the IP. Change this if you really want the full address shown.
const maskIp = (ip) =>
  ip.includes(":") ? ip.split(":").slice(0, 2).join(":") + ":…" : ip.split(".").slice(0, 2).join(".") + ".x.x";

function device(ua = "") {
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os + " · " + br;
}

async function top(board) {
  const flat = (await redis(["HGETALL", "lb:" + board])) || [];
  const rows = [];
  for (let i = 1; i < flat.length; i += 2) {
    try { rows.push(JSON.parse(flat[i])); } catch (e) {}
  }
  return rows.sort((a, b) => b.score - a.score || a.t - b.t).slice(0, 10)
    .map(({ name, dev, ip, score }) => ({ name, dev, ip, score }));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "Leaderboard storage not configured" });
  try {
    if (req.method === "GET") {
      const b = String(req.query.board || "");
      if (!BOARDS.includes(b)) return res.status(400).json({ error: "bad board" });
      return res.status(200).json({ rows: await top(b) });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const b = String(body.board);
      const score = Math.floor(Number(body.score));
      const name = String(body.name || "").replace(/[^\w .-]/g, "").trim().slice(0, 16);
      if (!BOARDS.includes(b) || !(score >= 0 && score <= 6000) || !name)
        return res.status(400).json({ error: "invalid" });

      const ip = getIp(req), dev = device(req.headers["user-agent"]);
      const field = ip + "|" + dev, key = "lb:" + b;

      // Different IP/device? -> new entry. Same IP/device? -> only replace if the score is higher.
      const old = await redis(["HGET", key, field]);
      const prev = old ? JSON.parse(old) : null;
      let status = "new";
      if (prev) status = score > prev.score ? "improved" : "same_ip";
      if (!prev || score > prev.score)
        await redis(["HSET", key, field, JSON.stringify({ name, dev, ip: maskIp(ip), score, t: Date.now() })]);
      return res.status(200).json({ status, rows: await top(b) });
    }
    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
};
