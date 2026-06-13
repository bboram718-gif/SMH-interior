// SMH 30분 전 알림 — GitHub Actions에서 5분마다 실행
// 환경변수: SHEET_API, NTFY_TOPIC
// 선택 환경변수: SMH_APP_URL

function pad(n) {
return String(n).padStart(2, "0");
}

function kstDate() {
return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function ymd(d) {
return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function addMode(url) {
var u = new URL(url);
u.searchParams.set("mode", "notificationData");
return u.toString();
}

function normDate(v) {
if (!v) return "";
var s = String(v).trim();

if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

var d = new Date(s);
if (!isNaN(d.getTime())) {
var k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
return k.getUTCFullYear() + "-" + pad(k.getUTCMonth() + 1) + "-" + pad(k.getUTCDate());
}

return s.slice(0, 10);
}

function normTime(v) {
if (!v) return "";
var s = String(v).trim();

var m = s.match(/^(\d{1,2}):(\d{2})/);
if (m) return pad(m[1]) + ":" + pad(m[2]);

var d = new Date(s);
if (!isNaN(d.getTime())) {
var k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
return pad(k.getUTCHours()) + ":" + pad(k.getUTCMinutes());
}

return "";
}

function ntfyHeader(v) {
var s = String(v || "");
if (/^[\x00-\x7F]*$/.test(s)) return s;
return "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

async function getJson(url) {
var res = await fetch(addMode(url), {
method: "GET",
redirect: "follow",
headers: {
"Accept": "application/json",
"User-Agent": "SMH-ntfy-actions"
}
});

var text = await res.text();

if (!res.ok) {
throw new Error("API 요청 실패: " + res.status + "\n" + text.slice(0, 400));
}

try {
return JSON.parse(text);
} catch (e) {
throw new Error("JSON parse 실패: " + text.slice(0, 400));
}
}

async function postText(url, body, headers) {
var res = await fetch(url, {
method: "POST",
redirect: "follow",
body: String(body),
headers: headers || {}
});

var text = await res.text();

if (!res.ok) {
throw new Error("ntfy POST 실패: " + res.status + "\n" + text.slice(0, 400));
}

return res.status;
}

async function postLog(url, log) {
var res = await fetch(url, {
method: "POST",
redirect: "follow",
body: JSON.stringify({
action: "appendNotificationLog",
log: log
}),
headers: {
"Content-Type": "application/json; charset=utf-8",
"Accept": "application/json",
"User-Agent": "SMH-ntfy-actions"
}
});

var text = await res.text();

if (!res.ok) {
throw new Error("로그 기록 실패: " + res.status + "\n" + text.slice(0, 400));
}

return text;
}

async function main() {
var SHEET_API = String(process.env.SHEET_API || "").trim();
var NTFY_TOPIC = String(process.env.NTFY_TOPIC || "").trim();
var SMH_APP_URL = String(process.env.SMH_APP_URL || "").trim();

if (!SHEET_API) throw new Error("SHEET_API 없음");
if (!NTFY_TOPIC) throw new Error("NTFY_TOPIC 없음");

var data = await getJson(SHEET_API);
var rows = Array.isArray(data["일정"]) ? data["일정"] : [];
var logs = Array.isArray(data["알림로그"]) ? data["알림로그"] : [];

var sent = {};
for (var a = 0; a < logs.length; a++) {
var oldKey = String(logs[a]["key"] || "").trim();
if (oldKey) sent[oldKey] = true;
}

var now = kstDate();
var today = ymd(now);
var sentCount = 0;
var checkedCount = 0;

for (var i = 0; i < rows.length; i++) {
var r = rows[i] || {};


var date = normDate(r["날짜"]);
var time = normTime(r["시간"]);
var status = String(r["상태"] || "").trim();

if (date !== today) continue;
if (status === "완료") continue;
if (!time) continue;

checkedCount++;

var hm = time.split(":");
var hh = Number(hm[0]);
var mm = Number(hm[1]);
if (isNaN(hh) || isNaN(mm)) continue;

var eventTime = new Date(now);
eventTime.setHours(hh, mm, 0, 0);

var diffMin = (eventTime.getTime() - now.getTime()) / 60000;

if (diffMin < 25 || diffMin > 35) continue;

var site = String(r["현장명"] || "일정").trim();
var eventId = String(r["일정ID"] || date + "_" + time + "_" + site).trim();
var key = "upcoming:" + eventId + ":" + date + ":" + time;

if (sent[key]) {
  console.log("이미 발송됨: " + key);
  continue;
}

var desc = r["내용"] ? " · " + String(r["내용"]).trim() : "";
var kind = r["구분"] ? "[" + String(r["구분"]).trim() + "] " : "";
var memo = r["메모"] ? "\n메모: " + String(r["메모"]).trim() : "";

var title = "곧 일정: " + time + " " + site;
var body = "⏰ " + Math.round(diffMin) + "분 후\n" + kind + site + desc + memo;

if (SMH_APP_URL) body += "\n\n열기: " + SMH_APP_URL;

var headers = {
  "Title": ntfyHeader(title),
  "Priority": "4",
  "Tags": "bell",
  "Content-Type": "text/plain; charset=utf-8"
};

if (SMH_APP_URL) headers["Click"] = SMH_APP_URL;

var ntfyStatus = await postText(
  "https://ntfy.sh/" + encodeURIComponent(NTFY_TOPIC),
  body,
  headers
);

console.log("ntfy 응답: " + ntfyStatus + " / " + title);

await postLog(SHEET_API, {
  key: key,
  type: "upcoming",
  eventId: eventId,
  date: date,
  time: time,
  title: title,
  body: body
});

console.log("로그 기록: " + key);

sent[key] = true;
sentCount++;


}

console.log("30분 전 알림 체크 완료. 시간 있는 오늘 일정 " + checkedCount + "건 / 발송 " + sentCount + "건.");
}

main().catch(function (e) {
console.error(e);
process.exit(1);
});
