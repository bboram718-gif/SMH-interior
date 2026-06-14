// SMH 아침 요약 알림 — GitHub Actions에서 실행
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
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(d);

    let hh = "";
    let mm = "";

    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") hh = parts[i].value;
      if (parts[i].type === "minute") mm = parts[i].value;
    }

    if (hh && mm) return hh + ":" + mm;
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
  const rows = data["일정"] || [];
  const logs = data["알림로그"] || [];

  const now = kstNow();
  const today = ymd(now);

  const morningKey = "morning_" + today;

  const sentKeys = new Set(
    logs
      .map(function (l) {
        return String(l.key || l["key"] || "").trim();
      })
      .filter(Boolean)
  );

  if (sentKeys.has(morningKey)) {
    console.log("이미 발송됨: " + morningKey);
    return;
  }

  const todayEvents = rows
    .filter(function (r) {
      const date = normalizeDate(r["날짜"]);
      const status = String(r["상태"] || "").trim();
      return date === today && status !== "완료";
    })
    .sort(function (a, b) {
      const ta = normalizeTime(a["시간"]) || "99:99";
      const tb = normalizeTime(b["시간"]) || "99:99";
      if (ta > tb) return 1;
      if (ta < tb) return -1;
      return 0;
    });

  const overdueEvents = rows.filter(function (r) {
    const date = normalizeDate(r["날짜"]);
    const status = String(r["상태"] || "").trim();
    return date && date < today && status !== "완료";
  });

  if (!todayEvents.length && !overdueEvents.length) {
    console.log("오늘 일정 없음 / 확인 필요 없음 — 알림 생략");
    return;
  }

  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const shortDateLabel =
    now.getMonth() + 1 + "/" + now.getDate() + "(" + dayNames[now.getDay()] + ")";

  const title = "• " + shortDateLabel + " 일정 · 오늘 " + todayEvents.length + "건";

  const lines = [];

  if (todayEvents.length) {
    todayEvents.forEach(function (r, index) {
      const time = normalizeTime(r["시간"]);
      const timeLabel = time ? time + " " : "종일 ";
      const site = String(r["현장명"] || "").trim();

      const category = String(r["구분"] || "").trim();
      const content = String(r["내용"] || "").trim();
      const memoText = String(r["메모"] || "").trim();

      let detailLine = "";
      if (category && content) {
        detailLine = category + " - " + content;
      } else if (category) {
        detailLine = category;
      } else if (content) {
        detailLine = content;
      }

      lines.push(timeLabel + site);

      if (detailLine) {
        lines.push("  " + detailLine);
      }

      if (memoText) {
        lines.push("  ✓ " + memoText);
      }

      if (index < todayEvents.length - 1) {
        lines.push("");
      }
    });
  } else {
    lines.push("오늘 일정 없음");
  }

  if (overdueEvents.length) {
    lines.push("");
    lines.push("⚠️ 미완료 지난 일정 " + overdueEvents.length + "건");
    lines.push("");

    overdueEvents.slice(0, 5).forEach(function (r, index) {
      const date = normalizeDate(r["날짜"]).slice(5).replace("-", "/");
      const site = String(r["현장명"] || "").trim();
      const content = String(r["내용"] || "").trim();

      lines.push(date + " " + site);

      if (content) {
        lines.push("  " + content);
      }

      if (index < Math.min(overdueEvents.length, 5) - 1) {
        lines.push("");
      }
    });

    if (overdueEvents.length > 5) {
      lines.push("");
      lines.push("... 외 " + (overdueEvents.length - 5) + "건");
    }
  }

  if (SMH_APP_URL) {
    lines.push("");
    lines.push("열기: " + SMH_APP_URL);
  }

  const body = lines.join("\n");

  const ntfyHeaders = {
    Title: encodeNtfyHeader(title),
    Priority: "3",
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
      key: morningKey,
      type: "morning",
      date: today,
      title: title,
      body: body
    }
  });

  console.log("로그 기록: " + morningKey + " / " + JSON.stringify(logRes));
  console.log("아침 요약 알림 완료: " + title);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
