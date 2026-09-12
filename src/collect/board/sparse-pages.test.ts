import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchBoardAll } from "./engine";
import { parseHtml } from "./html";
import type { BoardConfig, BoardRow } from "./types";

function html(ids: number[], policy = false): string {
  return `<table><tbody>${ids.map(id => `<tr><td class="title"><a href="https://example.org/view?id=${id}">${policy ? "지원사업 모집" : "선정결과 안내"} ${id}</a></td><td class="date">2026-09-01</td></tr>`).join("")}</tbody></table>`;
}
function raw(text: string): BoardRow[] {
  return parseHtml(text).querySelectorAll("tbody tr").map(tr => ({
    title: tr.querySelector("a")?.text ?? "", detailUrl: tr.querySelector("a")?.getAttribute("href") ?? "",
    dateText: tr.querySelector(".date")?.text ?? "", category: "", agency: "기관",
  }));
}
const config: BoardConfig = {
  id: "sparse-test", label: "기관", agency: "기관", region: "전국", baseUrl: "https://example.org/",
  list: { url: p => `https://example.org/list?page=${p}`, maxPages: 4, rowSelector: "tbody tr",
    fields: { title: { selector: ".title a" }, detailUrl: { selector: ".title a", attr: "href" }, date: { selector: ".date" } } },
  customParse: text => raw(text).filter(r => r.title.includes("지원사업")), validationParse: raw,
  expectMinRows: 2, skipHeuristic: true,
};
function dependencies(pages: Record<number, string>) {
  return { fetchText: vi.fn(async (url: string) => pages[Number(new URL(url).searchParams.get("page"))] ?? html([])),
    prevOpenCount: 100, askModel: vi.fn(async () => "{}"), onAllFailed: vi.fn(), onPageCap: vi.fn() };
}

describe("업무 거르개 전 원본을 기준으로 목록 상태를 검증한다", () => {
  it("정책 0건인 첫 쪽과 중간 두 쪽 뒤의 정책을 읽는다", async () => {
    const d = dependencies({ 1: html([1, 2]), 2: html([3, 4]), 3: html([5, 6]), 4: html([7], true) });
    const list = await fetchBoardAll(config, d);
    expect(list.map(a => a.title)).toEqual(["지원사업 모집 7"]);
    expect(d.onPageCap).toHaveBeenCalledWith({ hitCap: true, lastPageNew: 1 });
  });
  it("건강한 첫 쪽에 정책 1건만 있어도 이전 정책 수의 절반 검사를 적용하지 않는다", async () => {
    const d = dependencies({ 1: html([1, 2]).replace("선정결과 안내 1", "지원사업 모집 1"), 2: html([3, 4]) });
    const list = await fetchBoardAll({ ...config, list: { ...config.list, maxPages: 2 } }, d);
    expect(list).toHaveLength(1);
    expect(d.onPageCap).toHaveBeenCalledWith({ hitCap: true, lastPageNew: 2 });
  });
  it("전체가 비정책 글인 정상 목록도 신규 원본이 있으면 상한을 표시한다", async () => {
    const d = dependencies({ 1: html([1, 2]), 2: html([3, 4]) });
    expect(await fetchBoardAll({ ...config, list: { ...config.list, maxPages: 2 } }, d)).toEqual([]);
    expect(d.onPageCap).toHaveBeenCalledWith({ hitCap: true, lastPageNew: 2 });
  });
  it("같은 실제 원본이 두 쪽 연속 반복되면 멈춘다", async () => {
    const d = dependencies({ 1: html([1, 2]), 2: html([1, 2]), 3: html([1, 2]), 4: html([4], true) });
    expect(await fetchBoardAll(config, d)).toEqual([]);
    expect(d.fetchText).toHaveBeenCalledTimes(3);
  });
  it("원본이 사라진 연속 빈 쪽을 완료로 기록하지 않는다", async () => {
    const d = dependencies({ 1: html([1, 2], true), 2: "<h1>Service unavailable</h1>", 3: "<h1>Service unavailable</h1>" });
    expect(await fetchBoardAll(config, d)).toHaveLength(2);
    expect(d.onPageCap).not.toHaveBeenCalled();
  });
  it.each(["title", "date", "href"])("실제 %s 정보가 소실되면 정상 목록으로 보지 않는다", async field => {
    let text = html([1, 2]);
    if (field === "title") text = text.replace(/선정결과 안내 \d/g, "");
    if (field === "date") text = text.replace(/2026-09-01/g, "");
    if (field === "href") text = text.replace(/href="[^"]+"/g, "");
    await expect(fetchBoardAll(config, dependencies({ 1: text }))).rejects.toThrow();
  });
  it("custom/validation 함수의 가짜 행이 실제 목록 구조 검사를 대신하지 못한다", async () => {
    const c = { ...config, customParse: () => raw(html([1, 2], true)), validationParse: () => raw(html([1, 2], true)) };
    await expect(fetchBoardAll(c, dependencies({ 1: "<h1>접근할 수 없습니다</h1>" }))).rejects.toThrow();
  });
  it("검증 행과 업무 행 모두 허용 호스트 경계를 지킨다", async () => {
    const text = html([1, 2], true).replaceAll("example.org/view", "evil.example/view");
    await expect(fetchBoardAll(config, dependencies({ 1: text }))).rejects.toThrow();
  });
});

it("서울신보의 정책 1건이 붙박이 공지인 쪽도 다음 쪽으로 이어간다", async () => {
  const { fetchBoardWindow } = await import("./page-window");
  const { seoulsinboConfig } = await import("./sources/seoulsinbo");
  const html = readFileSync(join(__dirname, "__fixtures__/seoulsinbo-page8.html"), "utf-8");
  const result = await fetchBoardWindow(seoulsinboConfig, { prevOpenCount: 0, fetchText: async () => html, askModel: async () => "{}", onAllFailed: () => {} }, { startPage: 8, pageBudget: 1 });
  expect(result).toMatchObject({ nextPage: 9, complete: false });
  expect(result.announcements[0]?.title).toContain("골목형상점가");
});
it("익산의 마지막 쪽이 제외 대상 교육 한 건이어도 정상 원본으로 인정한다", async () => {
  const { fetchBoardWindow } = await import("./page-window");
  const { ikseConfig } = await import("./sources/ikse");
  const html = readFileSync(join(__dirname, "__fixtures__/ikse-page101.html"), "utf-8");
  const result = await fetchBoardWindow(ikseConfig, { prevOpenCount: 0, fetchText: async () => html, askModel: async () => "{}", onAllFailed: () => {} }, { startPage: 101, pageBudget: 1 });
  expect(result).toMatchObject({ nextPage: 102, complete: false, announcements: [] });
});
