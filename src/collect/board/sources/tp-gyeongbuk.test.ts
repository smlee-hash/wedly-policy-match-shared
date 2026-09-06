import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tpGyeongbukConfig, parseGyeongbukList } from "./tp-gyeongbuk";

const list = readFileSync(join(__dirname, "../__fixtures__/gbtp-list.html"), "utf-8");

describe("tp-gyeongbuk 경북테크노파크 — 목록 파싱", () => {
  it("onclick fn_detail 에서 nttNo 를 뽑아 GET 상세 URL 을 만든다", () => {
    const rows = parseGyeongbukList(list, tpGyeongbukConfig);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const ceo = rows.find((r) => r.title.includes("청년CEO"));
    expect(ceo).toBeTruthy();
    expect(ceo!.detailUrl).toBe(
      "https://www.gbtp.or.kr/user/boardDetail.do?bbsId=BBSMSTR_000000000021&nttNo=11630",
    );
    expect(ceo!.dateText).toContain("2026-08-26");
    expect(ceo!.dateText).toContain("2026-09-09");
  });
});
