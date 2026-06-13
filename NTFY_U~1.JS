// SMH 30분 전 알림 — GitHub Actions에서 5분마다 실행
// 환경변수: SHEET_API, NTFY_TOPIC
const https = require("https");

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error("JSON parse 실패: " + d.slice(0, 200))); }
      });
    }).on("error", reject);
  });
}

function post(url, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Length": Buffer.byteLength(payload), ...headers },
    };
    const req = https.request(options, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const SHEET_API = process.env.SHEET_API;
  const NTFY_TOPIC = process.env.NTFY_TOPIC;
  if (!SHEET_API || !NTFY_TOPIC) throw new Error("SHEET_API / NTFY_TOPIC 환경변수 없음");

  const data = await get(SHEET_API + "?mode=notificationData");
  const rows = data["일정"] || [];
  const logs = data["알림로그"] || [];

  // 현재 시각 KST
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");

  // 오늘 시간 있는 미완료 일정
  const timedEvs = rows.filter(
    (r) =>
      String(r["날짜"]).slice(0, 10) === today &&
      r["상태"] !== "완료" &&
      r["시간"] &&
      String(r["시간"]).trim() !== ""
  );

  const sentKeys = new Set(logs.map((l) => l.key));

  for (const r of timedEvs) {
    const timeStr = String(r["시간"]).slice(0, 5);
    const [hh, mm] = timeStr.split(":").map(Number);
    if (isNaN(hh) || isNaN(mm)) continue;

    // 이벤트 시각 (KST 기준 today의 hh:mm)
    const evTime = new Date(now);
    evTime.setHours(hh, mm, 0, 0);

    const diffMin = (evTime - now) / 60000;

    // 25~35분 사이일 때만 알림
    if (diffMin < 25 || diffMin > 35) continue;

    const id = String(r["일정ID"] || (r["날짜"] + "_" + r["시간"] + "_" + r["현장명"]));
    const upcomingKey = "upcoming_" + id;

    if (sentKeys.has(upcomingKey)) {
      console.log("이미 발송됨:", upcomingKey);
      continue;
    }

    const site = r["현장명"] || "일정";
    const desc = r["내용"] ? " · " + r["내용"] : "";
    const tag = r["구분"] ? "[" + r["구분"] + "] " : "";
    const memo = r["메모"] ? "\n메모: " + r["메모"] : "";

    const title = "곧 일정: " + timeStr + " " + site;
    const body = "⏰ " + Math.round(diffMin) + "분 후\n" + tag + site + desc + memo;

    const ntfyRes = await post("https://ntfy.sh/" + NTFY_TOPIC, body, {
      Title: title,
      Priority: "4",
      Tags: "bell",
      "Content-Type": "text/plain; charset=utf-8",
    });
    console.log("ntfy 응답:", ntfyRes.status, title);

    await post(
      SHEET_API,
      {
        action: "appendNotificationLog",
        log: {
          key: upcomingKey,
          type: "upcoming",
          eventId: String(r["일정ID"] || ""),
          date: today,
          time: timeStr,
          title,
          body,
        },
      },
      { "Content-Type": "application/json" }
    );
    console.log("로그 기록:", upcomingKey);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
