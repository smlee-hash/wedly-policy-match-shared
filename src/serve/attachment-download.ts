// 공고 첨부 한 건을 **서버가 대신 받아** 브라우저로 흘려보내는 통로의 코어.
//
// 왜 필요한가(2026-09-06): 산업인력공단·영화진흥위·여성기업센터 세 곳은 첨부가 **POST 전용**이라
// 내려받기 창구 주소가 파일마다 같고(`downloadFile2.hrd` 하나), 여는 열쇠는 본문(`attachSeq2` 등)에 있다.
// 상세 화면의 `<a href>` 는 GET 이라 그 주소를 눌러도 파일이 안 나오고, 파일 N개가 같은 링크로 보인다.
// 그래서 화면은 그대로 두고 **주소만** 이 통로로 바꿔 준다(`announcement-detail.ts` 의 `readAttachments`).
//
// ── 안전장치 7개(앱 라우트가 아니라 **여기서** 건다) ──
// ① 주소는 저장 배열의 `idx` 칸에서만 나온다(요청이 준 주소는 안 받는다 — SSRF 차단의 핵심)
// ② 사람당 분당 6회  ③ 공고당 동시 1건  ④ 30MB 상한(흘려보내며 끊는다)
// ⑤ 머리글 30초 / 본문 10분  ⑥ 리다이렉트 3홉 + **홉마다** `safeAttachmentUrl` 재검문
// ⑦ 매직바이트 검사(200 처럼 생긴 HTML 안내 화면을 파일인 척 내려보내지 않는다)
//
// 로그인 확인(①의 앞)은 앱 라우트 몫이다 — 앱마다 로그인 방식이 다르다.
// 다만 **속도 제한 열쇠**(`userKey`)를 받아 DB 를 보기 전에 여기서 먼저 막는다.
import {
  asPolicyAttachments,
  safeAttachmentUrl,
  sniffAttachmentKind,
  FORM_CONTENT_TYPE,
} from "../collect/attachment-text";
import { wrapAttachmentFetch } from "../collect/board/attachment-fetch";
import { boardConfigById, proxyOnlySourceIds } from "../collect/board/source-list";
import { attachmentProxyAvailable, proxiedAttachmentFetch, proxyDispatcher } from "../collect/board/proxy";
import type { ServeQuery } from "./types";

/** 첨부를 잇달아 받을 때의 최소 간격 — 수집 회차와 **같은 값**이어야 상대 서버가 우리를 안 막는다. */
export const ATTACHMENT_GAP_MS = 250;

/** 흘려보내는 파일 크기 상한. */
export const ATTACHMENT_DOWNLOAD_MAX_BYTES = 30 * 1024 * 1024;
export const ATTACHMENT_HEADERS_TIMEOUT_MS = 30_000;
export const ATTACHMENT_BODY_TIMEOUT_MS = 10 * 60_000;
export const ATTACHMENT_RATE_PER_MIN = 6;

/** 리다이렉트 홉 수. `downloadBytes` 와 **같이** `hop <= 3`(요청 네 번)이다. */
const MAX_HOPS = 3;

const RATE_WINDOW_MS = 60_000;
type Bucket = { tokens: number; refilledAt: number };
const buckets = new Map<string, Bucket>();

/** 공고당 동시에 한 첨부만 내려받게 하는 실행 장부(프로세스당 하나). */
export const attachmentInflight = new Set<string>();

/** 시험이 속도 제한과 실행 장부 상태를 지우는 자리. */
export function resetAttachmentRateLimitForTest(): void {
  buckets.clear();
  attachmentInflight.clear();
}

/** 남은 토큰이 있으면 하나 쓰고, 없으면 다음 채움까지 남은 초를 돌려준다. */
export function takeAttachmentToken(
  key: string,
  now: number,
): { ok: boolean; retryAfterSec: number } {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.refilledAt >= RATE_WINDOW_MS) {
    buckets.set(key, { tokens: ATTACHMENT_RATE_PER_MIN - 1, refilledAt: now });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.tokens > 0) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterSec: 0 };
  }
  return {
    ok: false,
    retryAfterSec: Math.max(
      1,
      Math.ceil((RATE_WINDOW_MS - (now - bucket.refilledAt)) / 1000),
    ),
  };
}

function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** 안전한 Content-Disposition 첨부 머리글을 만든다. */
export function contentDispositionOf(name: string): string {
  const clean =
    (name || "첨부파일").replace(/[\r\n"\\]/g, " ").replace(/\s+/g, " ").trim() ||
    "첨부파일";
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(clean)}`;
}

/** 상류가 준 형식. 없거나 이상하면 「그냥 파일」로 — 브라우저가 화면에 그리지 않게 한다. */
function contentTypeOf(res: Response): string {
  const t = (res.headers.get("content-type") ?? "").trim();
  return t && t.length < 200 && !/^text\/html/i.test(t) ? t : "application/octet-stream";
}

/** 매직바이트를 볼 수 있을 만큼 모을 최소 바이트(OLE 시그니처가 8바이트로 가장 길다). */
const SNIFF_MIN_BYTES = 8;

/**
 * 상류 본문을 **통째로 올리지 않고** 흘려보내며 상한을 넘는 순간 끊는다.
 * content-length 는 믿지 않는다 — 거짓으로 적어 보내면 그대로 속는다(`downloadBytes` 와 같은 규칙).
 *
 * `head` 는 이미 읽어 둔 앞부분(매직바이트 검사에 쓴 조각)이다 — 먼저 내보낸다.
 */
function cappedStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  head: Uint8Array,
  maxBytes: number,
  onDone: () => void,
): ReadableStream<Uint8Array> {
  let total = head.byteLength;
  let sentHead = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentHead) {
        sentHead = true;
        if (head.byteLength > 0) {
          controller.enqueue(head);
          return;
        }
      }
      const { done, value } = await reader.read();
      if (done) {
        onDone();
        controller.close();
        return;
      }
      if (!value || value.byteLength === 0) return;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        onDone();
        controller.error(new Error("첨부 크기 상한 초과"));
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      onDone();
      await reader.cancel(reason).catch(() => {});
    },
  });
}

/** 매직바이트를 볼 수 있을 만큼(최소 8바이트) 앞부분을 모은다. 본문이 그보다 짧으면 있는 만큼. */
async function readHead(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < SNIFF_MIN_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    chunks.push(value);
    total += value.byteLength;
  }
  const head = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    head.set(c, at);
    at += c.byteLength;
  }
  return head;
}

export type AttachmentDownloadResult =
  | { kind: "redirect"; status: 302; url: string }
  | {
      kind: "stream";
      status: 200;
      body: ReadableStream<Uint8Array>;
      headers: Record<string, string>;
    }
  | {
      kind: "error";
      status: number;
      code: string;
      /** 손님에게 보여 줄 한 줄(사람 말). */
      message: string;
      headers?: Record<string, string>;
      /** 앱 일지에만 남길 한 줄 — 응답에 싣지 마라. */
      logMessage?: string;
    };

export type AttachmentDownloadInput = {
  id: string;
  /** 자리번호 — 화면이 준 **글자 그대로** 넘긴다(`/^\d{1,4}$/` 검사를 여기서 한다). */
  idx: string;
  /** 속도 제한 열쇠 — 사람 한 명. ERP 는 `user.id`. */
  userKey: string;
  now: number;
  /** 손님이 창을 닫았을 때의 신호 — 있으면 상류 연결도 함께 끊는다. */
  signal?: AbortSignal | null;
};

type AttachmentRow = { id: string; source: string; url: string; attachments: unknown };

const ATTACHMENT_ROW_SELECT = { id: true, source: true, url: true, attachments: true } as const;

function fail(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): AttachmentDownloadResult {
  return { kind: "error", status, code, message, headers };
}

export async function downloadAttachment(
  q: Pick<ServeQuery, "findAnnouncement">,
  input: AttachmentDownloadInput,
): Promise<AttachmentDownloadResult> {
  let lockKey = "";
  try {
    const announcementId = (input.id ?? "").trim();
    // 자리번호는 0 이상 정수만 — 「01x」·「1e2」·음수·소수는 전부 거절한다.
    if (!announcementId || !/^\d{1,4}$/.test(input.idx ?? "")) {
      return fail(404, "NOT_FOUND", "첨부를 찾을 수 없습니다.");
    }
    const index = Number(input.idx);

    // ★속도 제한은 **DB 를 보기 전에**. 여기서 막아야 연타가 DB 조회까지 끌고 가지 않는다.
    const gate = takeAttachmentToken(input.userKey, input.now);
    if (!gate.ok) {
      return fail(429, "TOO_MANY_REQUESTS", "잠시 후 다시 시도해 주세요.", {
        "Retry-After": String(gate.retryAfterSec),
      });
    }
    if (attachmentInflight.has(announcementId)) {
      return fail(429, "TOO_MANY_REQUESTS", "같은 공고의 첨부를 받는 중입니다. 잠시 후 다시 시도해 주세요.", {
        "Retry-After": "5",
      });
    }

    const row = await q.findAnnouncement<AttachmentRow>(announcementId, ATTACHMENT_ROW_SELECT);
    if (!row) return fail(404, "NOT_FOUND", "공고를 찾을 수 없습니다.");

    // ★주소는 **저장된 목록에서만** 나온다 — 요청이 준 주소는 받지 않는다(SSRF 차단의 핵심).
    // ★자리번호는 **저장 배열의 자리 그대로**다. 걸러 낸 목록에서 세면(`asPolicyAttachments(all)[i]`)
    //  모양이 깨진 항목 하나 때문에 번호가 한 칸씩 밀려 **다른 파일**이 내려간다 — 그래서 저장
    //  배열의 그 칸 하나만 꺼내 같은 규칙으로 검사한다(화면에 준 번호와 글자 단위로 같아진다).
    const stored = Array.isArray(row.attachments) ? (row.attachments as unknown[]) : [];
    const att = asPolicyAttachments([stored[index]])[0];
    if (!att) return fail(404, "NOT_FOUND", "첨부를 찾을 수 없습니다.");

    const first = safeAttachmentUrl(att.url);
    if (!first) return fail(400, "BAD_ATTACHMENT", "허용되지 않은 첨부 주소입니다.");

    // GET 첨부는 예전 그대로다 — 원 주소로 보낸다(서버가 대신 받을 이유가 없다).
    if (att.method !== "POST") return { kind: "redirect", status: 302, url: first };

    const cfg = boardConfigById(row.source);
    // 국내 IP 로만 열리는 게시판은 목록·상세와 **같은 경유**로 받는다. 통로 만들기 실패가
    // 이 통로를 통째로 죽이지 않도록 try 안에서만 만든다(`sync.fillBodiesFromAttachments` 와 같은 규칙).
    let proxied: ((u: string, init?: RequestInit) => Promise<Response>) | undefined;
    if (proxyOnlySourceIds().includes(row.source) && attachmentProxyAvailable()) {
      try {
        proxied = proxiedAttachmentFetch(proxyDispatcher()!);
      } catch {
        proxied = undefined;
      }
    }
    // 첨부를 여는 열쇠(상세 세션 쿠키·Referer·1회용 토큰)는 **수집 쪽과 같은 한 줄 훅**이 겹쳐 준다 —
    // 여기서 다시 배선하면 한쪽만 새 열쇠를 타는 일이 생긴다. 간격도 수집 쪽과 같은 값이다.
    const send =
      wrapAttachmentFetch(cfg, row.url, proxied, { gapMs: ATTACHMENT_GAP_MS }) ??
      ((u: string, init?: RequestInit) => fetch(u, init));

    /**
     * ★시간 상한을 손으로 나눈다: 머리글까지 30초 → 도착하면 본문 10분으로 갈아 끼운다.
     * 손님이 창을 닫으면(`signal`) 상류 연결도 함께 끊는다 — 안 끊으면 남의 서버로 나간
     * 큰 내려받기가 아무도 안 보는 채로 끝까지 흐른다.
     */
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> = setTimeout(() => ac.abort(), ATTACHMENT_HEADERS_TIMEOUT_MS);
    const onClientGone = () => ac.abort();
    input.signal?.addEventListener?.("abort", onClientGone);
    const release = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener?.("abort", onClientGone);
      attachmentInflight.delete(announcementId);
    };

    attachmentInflight.add(announcementId);
    lockKey = announcementId;

    const headers: Record<string, string> = { ...(att.headers ?? {}) };
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = FORM_CONTENT_TYPE;
    }

    /**
     * ★리다이렉트는 **손으로** 따라간다(`downloadBytes` 와 같은 규칙). 자동 추적은 허용 호스트
     * 검사를 통과한 「뒤에」 내부망 주소로 302 시켜 검사를 우회하는 길이 된다.
     * 첫 홉만 POST 다 — 302 뒤에 본문을 다시 보내면 같은 내려받기가 두 번 일어난다(브라우저도 GET 이다).
     */
    let target: string | null = first;
    let upstream: Response | null = null;
    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        if (!target) break;
        const init: RequestInit =
          hop === 0
            ? { method: "POST", body: att.body ?? "", headers, redirect: "manual", signal: ac.signal }
            : { redirect: "manual", signal: ac.signal };
        const r: Response = await send(target, init);
        if (r.status >= 300 && r.status < 400) {
          const loc = r.headers.get("location");
          await r.body?.cancel().catch(() => {});
          if (!loc || hop === MAX_HOPS) {
            target = null;
            break;
          }
          let next: string;
          try {
            next = new URL(loc, target).toString();
          } catch {
            target = null;
            break;
          }
          // ★홉마다 다시 검문한다 — 이 한 줄이 「검사 통과 뒤 내부망으로 302」를 막는다.
          target = safeAttachmentUrl(next);
          continue;
        }
        upstream = r;
        break;
      }
    } catch {
      release();
      return fail(502, "UPSTREAM_FAILED", "첨부를 받아오지 못했습니다. 원문에서 확인해 주세요.");
    }
    if (!upstream || !upstream.ok || !upstream.body) {
      await upstream?.body?.cancel().catch(() => {});
      release();
      return fail(502, "UPSTREAM_FAILED", "첨부를 받아오지 못했습니다. 원문에서 확인해 주세요.");
    }

    // 머리글이 왔다 — 이제부터는 본문 상한(10분)이다.
    clearTimeout(timer);
    timer = setTimeout(() => ac.abort(), ATTACHMENT_BODY_TIMEOUT_MS);

    const reader = upstream.body.getReader();
    const head = await readHead(reader);
    /**
     * ★**매직바이트로 진짜 파일인지 본다**(2026-09-06 보안 리뷰 5번).
     * 세 곳 모두 실패를 **200 처럼 생긴 HTML** 로 준다(여성기업센터는 404+95바이트, 세종TP 계열은
     * 200+안내 화면). 그걸 그대로 흘리면 사람이 `.hwp` 이름의 깨진 파일을 받아 열지 못한 채
     * 「우리 시스템이 이상하다」로 남는다. 수집 경로와 **같은 판정기**(`sniffAttachmentKind`)를 쓴다 —
     * 두 갈래가 갈리면 한쪽만 쓰레기를 통과시킨다.
     */
    const rawType = (upstream.headers.get("content-type") ?? "").trim();
    if (/^text\/html/i.test(rawType) || !sniffAttachmentKind(head)) {
      await reader.cancel().catch(() => {});
      release();
      return fail(502, "NOT_A_FILE", "첨부가 아닌 응답이 왔습니다. 원문에서 확인해 주세요.");
    }

    return {
      kind: "stream",
      status: 200,
      body: cappedStream(reader, head, ATTACHMENT_DOWNLOAD_MAX_BYTES, release),
      headers: {
        "Content-Type": contentTypeOf(upstream),
        "Content-Disposition": contentDispositionOf(att.name),
        // 우리 서버 주소로 남의 파일을 내려보내므로 브라우저가 내용을 짐작해 실행하지 않게 막는다.
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    };
  } catch (err) {
    if (lockKey) attachmentInflight.delete(lockKey);
    // 오류를 **객체째** 밖으로 내보내지 않는다 — 어떤 오류는 `input` 에 경유 주소(비밀번호 포함)를 달고 온다.
    // 앱 일지에 남길 것은 `logMessage`(글자 한 줄)뿐이고, 손님에게는 `message` 만 간다.
    return {
      kind: "error",
      status: 500,
      code: "SERVER_ERROR",
      message: "첨부를 내려받지 못했습니다.",
      logMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
