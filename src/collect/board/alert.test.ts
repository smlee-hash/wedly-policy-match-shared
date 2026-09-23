import { describe, it, expect, vi } from "vitest";
import { buildBoardFailureAlert, noteFailureAndMaybeAlert, noteSuccess } from "./alert";

describe("noteFailureAndMaybeAlert", () => {
  it("연속 3회째에만 알린다", async () => {
    const send = vi.fn(async (_text: string) => true);
    let count = 0;
    const store = { get: async () => count, set: async (n: number) => { count = n; } };
    for (let i = 0; i < 2; i++) await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(send).not.toHaveBeenCalled();
    await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(buildBoardFailureAlert("tp-x", 3, "실패")); // 보내는 글은 빌더 한 곳에서 만든다
    expect(count).toBe(0); // 알림 뒤 리셋
  });
  it("send 가 false 이면 카운터를 THRESHOLD 로 유지한다", async () => {
    const send = vi.fn(async () => false);
    let count = 2;
    const store = { get: async () => count, set: async (n: number) => { count = n; } };
    await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(send).toHaveBeenCalledOnce();
    expect(count).toBe(3);
  });
  it("send 가 throw 하면 카운터를 THRESHOLD 로 유지한다", async () => {
    const send = vi.fn(async () => { throw new Error("slack down"); });
    let count = 2;
    const store = { get: async () => count, set: async (n: number) => { count = n; } };
    await noteFailureAndMaybeAlert("tp-x", "실패", { send, store });
    expect(count).toBe(3);
  });
  it("성공하면 카운트를 0으로", async () => {
    let count = 2; const store = { get: async () => count, set: async (n: number) => { count = n; } };
    await noteSuccess("tp-x", { store });
    expect(count).toBe(0);
  });
});

// 눈에 안 보이는 글자는 시험 소스에도 그대로 쓰지 않고 글자 번호로 만든다.
const ITEM = "> " + String.fromCharCode(0x3000) + String.fromCharCode(0x25e6) + " ";
const WARNING = String.fromCharCode(0x26a0, 0xfe0f);
const TITLE = /^> \S+ \*\[[^\]]+\] /;
const HEADING = /^> \*▸ [^*▸]+\*$/;

/** 짝 없는 반쪽 그림 글자(서로게이트)가 있으면 true. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("buildBoardFailureAlert — WEDLY 슬랙 형식(2026-09-23)", () => {
  const text = buildBoardFailureAlert("tp-x", 3, "목록 쪽을 못 읽음");
  const lines = text.split("\n");

  it("모든 줄이 > 로 시작하고, 빈 줄은 정확히 > 한 글자다", () => {
    for (const line of lines) {
      expect(line.startsWith(">")).toBe(true);
      if (line.slice(1).trim() === "") expect(line).toBe(">");
    }
  });

  it("첫 줄은 그림 글자 + 굵은 [정책매칭] 제목이고 출처·횟수가 들어 있다", () => {
    expect(lines[0]).toMatch(TITLE);
    expect(lines[0]).toBe(`> ${WARNING} *[정책매칭] 수집 실패 — tp-x 연속 3회*`);
  });

  it("▸ 는 소제목 줄에만 있고, 소제목 바로 위 줄은 > 한 글자다", () => {
    const headingIdx = lines.flatMap((l, i) => (l.includes("▸") ? [i] : []));
    expect(headingIdx.map((i) => lines[i])).toEqual(["> *▸ 무슨 일*", "> *▸ 사람이 할 일*"]);
    for (const i of headingIdx) {
      expect(lines[i]).toMatch(HEADING);
      expect(lines[i - 1]).toBe(">");
    }
  });

  it("내용 줄은 `> ` + 전각 빈칸 + 속이 빈 동그라미로 시작하고 `라벨 · 값` 모양이다", () => {
    const items = lines.filter((l) => l.startsWith(ITEM));
    expect(items).toEqual([
      `${ITEM}출처 · tp-x`,
      `${ITEM}연속 실패 · 3회`,
      `${ITEM}마지막 오류 · 목록 쪽을 못 읽음`,
      `${ITEM}자가수리도 실패했습니다 — 이 출처의 수집 설정을 사람이 점검해 주세요`,
    ]);
    // 제목·빈 줄·소제목·꼬리를 뺀 나머지 줄은 전부 내용 줄이다
    const rest = lines.filter((l, i) => i !== 0 && i !== lines.length - 1 && l !== ">" && !HEADING.test(l));
    expect(rest).toEqual(items);
  });

  it("마지막 줄은 꼬리 한 줄이고 그 위는 > 한 글자 줄이다", () => {
    expect(lines[lines.length - 1]).toBe("> 실패가 3번 이어질 때 한 번 알립니다 · 한 번이라도 성공하면 다시 셉니다");
    expect(lines[lines.length - 2]).toBe(">");
  });

  it("출처·오류 속 &·<·> 는 escape 하고, 오류 속 줄바꿈은 한 줄로 합친다", () => {
    const t = buildBoardFailureAlert("a<b>&c", 3, "첫 줄 <script>&x\n> 둘째 줄\r\n\n셋째");
    const tl = t.split("\n");
    for (const line of tl) {
      expect(line.startsWith(">")).toBe(true);
      expect(line.slice(1)).not.toContain(">"); // 줄 머리 말고는 > 가 없다(값 속 > 가 인용구로 오인되지 않는다)
    }
    expect(t).not.toContain("<");
    expect(t.replace(/&(amp|lt|gt);/g, "")).not.toContain("&");
    expect(tl[0]).toBe(`> ${WARNING} *[정책매칭] 수집 실패 — a&lt;b&gt;&amp;c 연속 3회*`);
    expect(tl).toContain(`${ITEM}출처 · a&lt;b&gt;&amp;c`);
    expect(tl).toContain(`${ITEM}마지막 오류 · 첫 줄 &lt;script&gt;&amp;x &gt; 둘째 줄 셋째`);
    expect(tl).toHaveLength(lines.length); // 오류에 줄바꿈이 있어도 줄 수가 늘지 않는다
  });

  it("긴 오류는 300자에서 잘라 …를 붙이고, 그림 글자를 반으로 쪼개지 않는다", () => {
    const smile = String.fromCodePoint(0x1f600); // 두 칸(서로게이트 쌍)짜리 그림 글자
    // 299·300번째 글자가 그림 글자 — 칸(UTF-16) 수로 자르면 어느 쪽으로 한 칸 어긋나도 걸린다
    const t = buildBoardFailureAlert("tp-x", 3, "가".repeat(298) + smile + smile + "나".repeat(500));
    expect(t.split("\n")).toContain(`${ITEM}마지막 오류 · ${"가".repeat(298)}${smile}${smile}…`);
    expect(t).not.toContain("나");
    expect(hasLoneSurrogate(t)).toBe(false);
    // 딱 300자는 자르지 않는다
    const exact = buildBoardFailureAlert("tp-x", 3, "가".repeat(300));
    expect(exact.split("\n")).toContain(`${ITEM}마지막 오류 · ${"가".repeat(300)}`);
    expect(exact).not.toContain("…");
  });
});
