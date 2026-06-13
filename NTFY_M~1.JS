// SMH 아침 요약 알림 — GitHub Actions에서 실행
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

  // 일정 + 알림로그 가져오기
  const data = await get(SHEET_API + "?mode=notificationData");
  const rows = data["일정"] || [];
  const logs = data["알림로그"] || [];

  // 오늘 날짜 KST
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const today =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");

  const morningKey = "morning_" + today;

  // 중복 방지
  if (logs.some((l) => l.key === morningKey)) {
    console.log("이미 발송됨:", morningKey);
    return;
  }

  // 오늘 미완료 일정
  const todayEvs = rows
    .filter((r) => String(r["날짜"]).slice(0, 10) === today && r["상태"] !== "완료")
    .sort((a, b) => ((a["시간"] || "99:99") > (b["시간"] || "99:99") ? 1 : -1));

  // 지난 미완료 일정
  const overdueEvs = rows.filter(
    (r) => r["날짜"] && String(r["날짜"]).slice(0, 10) < today && r["상태"] !== "완료"
  );

  if (!todayEvs.length && !overdueEvs.length) {
    console.log("오늘 일정 없음 — 알림 생략");
    return;
  }

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const todayLabel =
    (now.getMonth() + 1) + "월 " + now.getDate() + "일 (" + dayNames[now.getDay()] + ")";

  const titleParts = [];
  if (todayEvs.length) titleParts.push("오늘 " + todayEvs.length + "건");
  if (overdueEvs.length) titleParts.push("확인필요 " + overdueEvs.length + "건");
  const title = "📅 " + todayLabel + " · " + titleParts.join(" · ");

  const lines = [];
  if (todayEvs.length) {
    todayEvs.forEach((r) => {
      const time = r["시간"] ? String(r["시간"]).slice(0, 5) + " " : "종일 ";
      const site = r["현장명"] || "";
      const desc = r["내용"] ? " · " + r["내용"] : "";
      const tag = r["구분"] ? " [" + r["구분"] + "]" : "";
      lines.push(time + site + desc + tag);
    });
  } else {
    lines.push("(오늘 일정 없음)");
  }

  if (overdueEvs.length) {
    lines.push("");
    lines.push("⚠️ 미완료 지난 일정 " + overdueEvs.length + "건");
    overdueEvs.slice(0, 3).forEach((r) => {
      const date = String(r["날짜"]).slice(5, 10).replace("-", "/");
      lines.push(date + " " + (r["현장명"] || ""));
    });
    if (overdueEvs.length > 3) lines.push("... 외 " + (overdueEvs.length - 3) + "건");
  }

  const body = lines.join("\n");

  // ntfy 발송
  const ntfyRes = await post("https://ntfy.sh/" + NTFY_TOPIC, body, {
    Title: title,
    Priority: "3",
    Tags: "calendar",
    "Content-Type": "text/plain; charset=utf-8",
  });
  console.log("ntfy 응답:", ntfyRes.status, ntfyRes.body.slice(0, 100));

  // 발송 로그 기록 (중복 방지용)
  await post(
    SHEET_API,
    { action: "appendNotificationLog", log: { key: morningKey, type: "morning", date: today, title, body } },
    { "Content-Type": "application/json" }
  );
  console.log("완료:", title);
}

main().catch((e) => { console.error(e); process.exit(1); });
