// api/leaderboard.js
// GET /api/leaderboard?board=0..5|b
// POST /api/leaderboard

const URL_ =
  process.env.UPSTASH_REDIS_REST_URL_KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_API_URL ||
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_URL_KV_URL ||
  process.env.UPSTASH_REDIS_REST_URL_REDIS_URL;

const TOKEN =
  process.env.UPSTASH_REDIS_REST_URL_KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_API_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN;

const BOARDS = new Set(["0", "1", "2", "3", "4", "5", "b"]);
const MAX_SCORE = 6000;

async function redis(command, retries = 2) {
  if (!URL_ || !TOKEN) {
    throw new Error("Redis environment variables are missing.");
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(URL_, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: controller.signal,
      });

      const text = await response.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid Redis response: HTTP ${response.status}`);
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || `Redis HTTP ${response.status}`);
      }

      return data.result;
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await new Promise(resolve =>
          setTimeout(resolve, 250 * (attempt + 1))
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Redis request failed.");
}

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  return (
    (typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : "") ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function maskIp(ip) {
  if (ip.includes(":")) {
    return ip.split(":").slice(0, 2).join(":") + ":…";
  }

  const parts = ip.split(".");
  return parts.length === 4
    ? `${parts[0]}.${parts[1]}.x.x`
    : "unknown";
}

function device(ua = "") {
  const os = /Windows/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /iPhone|iPad/i.test(ua) ? "iOS"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : "Unknown";

  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";

  return `${os} · ${browser}`;
}

async function top(board) {
  const flat = (await redis(["HGETALL", `lb:${board}`])) || [];

  if (!Array.isArray(flat)) {
    throw new Error("Unexpected Redis leaderboard data.");
  }

  const rows = [];

  for (let i = 1; i < flat.length; i += 2) {
    try {
      const row = JSON.parse(flat[i]);

      if (
        row &&
        typeof row.name === "string" &&
        typeof row.dev === "string" &&
        typeof row.ip === "string" &&
        Number.isFinite(Number(row.score))
      ) {
        rows.push({
          name: row.name,
          dev: row.dev,
          ip: row.ip,
          score: Number(row.score),
          t: Number(row.t) || 0,
        });
      }
    } catch {
      // Skip corrupted entries instead of breaking the entire leaderboard.
    }
  }

  return rows
    .sort((a, b) => b.score - a.score || a.t - b.t)
    .slice(0, 10)
    .map(({ name, dev, ip, score }) => ({
      name,
      dev,
      ip,
      score,
    }));
}

// Atomically save a score only if it beats the existing score.
const SAVE_IF_BETTER = `
local old = redis.call("HGET", KEYS[1], ARGV[1])

if old then
  local ok, previous = pcall(cjson.decode, old)

  if ok and tonumber(previous.score)
     and tonumber(ARGV[2]) <= tonumber(previous.score) then
    return "same_ip"
  end
end

redis.call("HSET", KEYS[1], ARGV[1], ARGV[3])

if old then
  return "improved"
end

return "new"
`;

module.exports = async (req, res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "User-Agent");

  if (!URL_ || !TOKEN) {
    return res.status(503).json({
      error: "Leaderboard storage is not configured.",
    });
  }

  try {
    if (req.method === "GET") {
      const board = String(req.query?.board ?? "");

      if (!BOARDS.has(board)) {
        return res.status(400).json({
          error: "Invalid leaderboard board.",
        });
      }

      return res.status(200).json({
        rows: await top(board),
      });
    }

    if (req.method === "POST") {
      let body = req.body;

      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({
            error: "Invalid JSON body.",
          });
        }
      }

      body = body && typeof body === "object" ? body : {};

      const board = String(body.board ?? "");
      const score = Number(body.score);
      const name = String(body.name ?? "")
        .replace(/[^\w .-]/g, "")
        .trim()
        .slice(0, 16);

      if (
        !BOARDS.has(board) ||
        !Number.isSafeInteger(score) ||
        score < 0 ||
        score > MAX_SCORE ||
        !name
      ) {
        return res.status(400).json({
          error: "Invalid board, score, or name.",
        });
      }

      const ip = getIp(req);
      const dev = device(req.headers["user-agent"] || "");
      const field = `${ip}|${dev}`;
      const key = `lb:${board}`;

      const record = JSON.stringify({
        name,
        dev,
        ip: maskIp(ip),
        score,
        t: Date.now(),
      });

      const status = await redis([
        "EVAL",
        SAVE_IF_BETTER,
        "1",
        key,
        field,
        String(score),
        record,
      ]);

      return res.status(200).json({
        status,
        rows: await top(board),
      });
    }

    res.setHeader("Allow", "GET, POST");

    return res.status(405).json({
      error: "Method not allowed.",
    });
  } catch (error) {
    console.error(
      "[leaderboard] Request failed:",
      error?.message || error
    );

    return res.status(503).json({
      error: "Leaderboard temporarily unavailable. Please try again.",
    });
  }
};