// SMH 30분 전 알림 — GitHub Actions에서 5분마다 실행
// 환경변수: SHEET_API, NTFY_TOPIC
// 선택 환경변수: SMH_APP_URL

function pad(n) {
return String(n).padStart(2, "0");
}

function kstNow() {
return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function ymd(date) {
return (
date.getFullYear() +
"-" +
pad(date.getMonth() + 1) +
"-" +
pad(date.getDate())
);
}

function addQuery(url, key, value) {
const u = new URL(url);
u.searchParams.set(key, value);
return u.toString();
}

function normalizeDate(value) {
if (!value) return "";

const s = String(value).trim();

if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

const d = new Date(s);
if (!Number.isNaN(d.getTime())) {
const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
return (
k.getUTCFullYear() +
"-" +
pad(k.getUTCMonth() + 1) +
"-" +
pad(k.getUTCDate())
);
}

const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
if (m) return m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);

return s.slice(0, 10);
}

function normalizeTime(value) {
if (!value) return "";

const s = String(value).trim();

const m = s.match(/^(\d{1,2}):(\d{2})/);
if (m) return pad(m[1]) + ":" + pad(m[2]);

const d = new Date(s);
if (!Number.isNaN(d.getTime())) {
const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
return pad(k.getUTCHours()) + ":" + pad(k.getUTCMinutes());
}

return "";
}

function encodeNtfyHeader(value) {
const s = String(value || "");
return /^[\x00-\x7F]*$/.test(s)
? s
: "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

async function fetchJson(url) {
const target = addQuery(url, "mode", "notificationData");

const res = await fetch(target, {
method: "GET",
redirect: "follow",
headers: {
Accept: "application/json",
"User-Agent": "SMH-ntfy-actions"
}
});

const text = await res.text();

if (!res.ok) {
throw new Error(
"API 요청 실패: " +
res.status +
" " +
res.statusText +
"\n" +
text.slice(0, 500)
);
}

try {
return JSON.parse(text);
} catch (err) {
throw new Error("JSON parse 실패: " + text.slice(0, 500));
}
}

async function postText(url, body, headers) {
const res = await fetch(url, {
method: "POST",
redirect: "follow",
body: String(body),
headers: headers || {}
});

const text = await res.text();

if (!res.ok) {
throw new Error(
"ntfy POST 실패: " +
res.status +
" " +
res.statusText +
"\n" +
text.slice(0, 500)
);
}

return { status: res.status, body: text };
}

async function postJson(url, obj) {
const res = await fetch(url, {
method: "POST",
redirect: "follow",
body: JSON.stringify(obj),
headers: {
"Content-Type": "application/json; charset=utf-8",
Accept: "application/json",
"User-Agent": "SMH-ntfy-actions"
}
});

const text = await res.text();

if (!res.ok) {
throw new Error(
"로그 기록 POST 실패: " +
res.status +
" " +
res.statusText +
"\n" +
text.slice(0, 500)
);
}

try {
return JSON.parse(text);
} catch (err) {
return { ok: true, raw: text };
}
}

async function main() {
const SHEET_API = String(process.env.SHEET_API || "").trim();
const NTFY_TOPIC = String(process.env.NTFY_TOPIC || "").trim();
const SMH_APP_URL = String(process.env.SMH_APP_URL || "").trim();

if (!SHEET_API || !NTFY_TOPIC) {
throw new Error("SHEET_API / NTFY_TOPIC 환경변수 없음");
}

const data = await fetchJson(SHEET_API);
const rows = Array.isArray(data["일정"]) ? data["일정"] : [];
const logs = Array.isArray(data["알림로그"]) ? data["알림로그"] : [];

const now = kstNow();
const today = ymd(now);

const sentKeys = new Set();

for (let i = 0; i < logs.length; i++) {
const key = String(logs[i].key || logs[i]["key"] || "").trim();
if (key) sentKeys.add(key);
}

let sentCount = 0;
let checkedCount = 0;

for (let i = 0; i < rows.length; i++) {
const r = rows[i] || {};

```
const date = normalizeDate(r["날짜"]);
const timeStr = normalizeTime(r["시간"]);
const status = String(r["상태"] || "").trim();

if (date !== today) continue;
if (status === "완료") continue;
if (!timeStr) continue;

checkedCount++;

const parts = timeStr.split(":");
const hh = Number(parts[0]);
const mm = Number(parts[1]);

if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

const eventTime = new Date(now);
eventTime.setHours(hh, mm, 0, 0);

const diffMin = (eventTime.getTime() - now.getTime()) / 60000;

// 현재 기준 25~35분 뒤 일정만 알림
if (diffMin < 25 || diffMin > 35) continue;

const eventId = String(
  r["일정ID"] || (date + "_" + timeStr + "_" + (r["현장명"] || ""))
).trim();

const upcomingKey = "upcoming:" + eventId + ":" + date + ":" + timeStr;

if (sentKeys.has(upcomingKey)) {
  console.log("이미 발송됨: " + upcomingKey);
  continue;
}

const site = String(r["현장명"] || "일정").trim();
const desc = r["내용"] ? " · " + String(r["내용"]).trim() : "";
const kind = r["구분"] ? "[" + String(r["구분"]).trim() + "] " : "";
const memo = r["메모"] ? "\n메모: " + String(r["메모"]).trim() : "";

const title = "곧 일정: " + timeStr + " " + site;

let body =
  "⏰ " +
  Math.round(diffMin) +
  "분 후\n" +
  kind +
  site +
  desc +
  memo;

if (SMH_APP_URL) {
  body += "\n\n열기: " + SMH_APP_URL;
}

const ntfyHeaders = {
  Title: encodeNtfyHeader(title),
  Priority: "4",
  Tags: "bell",
  "Content-Type": "text/plain; charset=utf-8"
};

if (SMH_APP_URL) {
  ntfyHeaders.Click = SMH_APP_URL;
}

const ntfyRes = await postText(
  "https://ntfy.sh/" + encodeURIComponent(NTFY_TOPIC),
  body,
  ntfyHeaders
);

console.log("ntfy 응답: " + ntfyRes.status + " / " + title);

const logRes = await postJson(SHEET_API, {
  action: "appendNotificationLog",
  log: {
    key: upcomingKey,
    type: "upcoming",
    eventId: eventId,
    date: date,
    time: timeStr,
    title: title,
    body: body
  }
});

console.log("로그 기록: " + upcomingKey + " / " + JSON.stringify(logRes));

sentKeys.add(upcomingKey);
sentCount++;
```

}

console.log("30분 전 알림 체크 완료. 시간 있는 오늘 일정 " + checkedCount + "건 / 발송 " + sentCount + "건.");
}

main().catch(function (e) {
console.error(e);
process.exit(1);
});
