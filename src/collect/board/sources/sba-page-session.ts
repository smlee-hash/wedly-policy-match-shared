import { decodeHtmlEntities, parseHtml } from "../html";
import type { BoardFetchInit } from "../types";

/**
 * 서울경제진흥원(SBA) `Posting.aspx` 쪽넘김 세션.
 *
 * ASP.NET WebForms 는 쪽 주소가 없고 `__doPostBack` / `input.next` 포스트백이다.
 * 쪽 목록 창은 10개 단위라 11쪽 이상은 `input.next` 를 눌러야 한다.
 * 실측(고정본 sba-group1/11/21): 다음 창 1→11→21 은 숨은 `$PageNum` 을 같이 보낼 때만
 * 실제로 넘어간다. 모듈 전역에 상태를 두면 회차가 섞이고, 상태가 없을 때 1쪽 GET 으로
 * 물러서면 엔진이 같은 1쪽을 성공으로 저장한다 — 회차 클로저에만 두고 조용히 1쪽으로
 * 돌아가지 않는다.
 */

const LIST_URL = "https://www.sba.seoul.kr/Pages/BusinessApply/Posting.aspx";
const MAX_GROUP_JUMPS = 100;
/** 이 게시판 제어 이름만 POST 키·`__EVENTTARGET` 으로 쓴다. HTML 의 다른 이름은 버린다. */
const CONTROL_NAME = /^ctl00\$ctl00\$ContentPlaceHolder1\$MainContents(?:\$[A-Za-z0-9_]+)+$/;
const IMAGE_COORD = /^ctl00\$ctl00\$ContentPlaceHolder1\$MainContents(?:\$[A-Za-z0-9_]+)+\.[xy]$/;
const ASP_FIELD = /^(?:__EVENTTARGET|__EVENTARGUMENT|__VIEWSTATE|__VIEWSTATEGENERATOR|__EVENTVALIDATION)$/;
const DOPOSTBACK = /__doPostBack\(\s*['"]([^'"]+)['"]/;

export class SbaPageEndError extends Error {
  readonly lastPage: number;
  constructor(lastPage: number) {
    super(`서울경제진흥원 목록은 ${lastPage}쪽이 마지막입니다.`);
    this.name = "SbaPageEndError";
    this.lastPage = lastPage;
  }
}

function incomplete(detail: string): never {
  throw new Error(`서울경제진흥원 목록을 요청한 쪽까지 읽지 못했습니다. ${detail}`);
}

function allowedFormName(name: string): boolean {
  return ASP_FIELD.test(name) || CONTROL_NAME.test(name) || IMAGE_COORD.test(name);
}

type Parsed = {
  html: string;
  active: number;
  groupMin: number;
  groupMax: number;
  pages: Set<number>;
  targets: Map<number, string>;
  nextName: string | null;
  viewState: string;
  generator: string;
  eventValidation: string | null;
  pageNumName: string;
  pageNumValue: string;
};

function hiddenInputValue(root: ReturnType<typeof parseHtml>, name: string): string | null {
  const el = root.querySelector(`input[name="${name}"]`) ?? root.querySelector(`#${name}`);
  if (!el) return null;
  return el.getAttribute("value") ?? "";
}

function doPostBackTarget(href: string): string | null {
  const decoded = decodeHtmlEntities(href);
  const token = decoded.match(DOPOSTBACK)?.[1] ?? "";
  if (!token || !CONTROL_NAME.test(token)) return null;
  return token;
}

function parseSbaPage(html: string): Parsed | null {
  if (!html) return null;
  const root = parseHtml(html);
  if (!root.querySelector("tr.grid_list.tbody")) return null;

  const viewState = hiddenInputValue(root, "__VIEWSTATE");
  const generator = hiddenInputValue(root, "__VIEWSTATEGENERATOR");
  if (!viewState || !generator) return null;

  let pageNumName = "";
  let pageNumValue = "";
  for (const input of root.querySelectorAll("input")) {
    const type = (input.getAttribute("type") ?? "text").toLowerCase();
    if (type !== "hidden") continue;
    const name = input.getAttribute("name") ?? "";
    if (!name.endsWith("$PageNum") || !CONTROL_NAME.test(name)) continue;
    if (name.includes("PagingRepeater")) continue;
    pageNumName = name;
    pageNumValue = input.getAttribute("value") ?? "";
    break;
  }
  if (!pageNumName || !pageNumValue) return null;

  const eventValidation = hiddenInputValue(root, "__EVENTVALIDATION");

  const pages = new Set<number>();
  const targets = new Map<number, string>();
  const activeEl = root.querySelector("a[id*='PagingRepeater_PageNum_'].on");
  let active = Number((activeEl?.text ?? "").trim());
  if (!Number.isInteger(active) || active < 1) active = 0;
  for (const a of root.querySelectorAll("a[id*='PagingRepeater_PageNum_']")) {
    const n = Number((a.text ?? "").trim());
    if (!Number.isInteger(n) || n < 1 || pages.has(n)) continue;
    pages.add(n);
    const token = doPostBackTarget(a.getAttribute("href") ?? "");
    if (token) targets.set(n, token);
    if (active === 0 && (a.getAttribute("class") ?? "").split(/\s+/).includes("on")) active = n;
  }
  if (pages.size === 0) return null;
  if (!Number.isInteger(active) || active < 1 || !pages.has(active)) return null;

  let nextName: string | null = null;
  let nextEl = root.querySelector("input.next");
  if (!nextEl) {
    for (const el of root.querySelectorAll("input")) {
      if ((el.getAttribute("class") ?? "").split(/\s+/).includes("next")) {
        nextEl = el;
        break;
      }
    }
  }
  const rawNext = nextEl?.getAttribute("name") ?? "";
  if (rawNext && CONTROL_NAME.test(rawNext)) nextName = rawNext;

  const pageList = [...pages];
  return {
    html,
    active,
    groupMin: Math.min(...pageList),
    groupMax: Math.max(...pageList),
    pages,
    targets,
    nextName,
    viewState,
    generator,
    eventValidation,
    pageNumName,
    pageNumValue,
  };
}

function buildBody(parsed: Parsed, extra: Array<[string, string]>): string {
  const fields: Array<[string, string]> = [
    ["__VIEWSTATE", parsed.viewState],
    ["__VIEWSTATEGENERATOR", parsed.generator],
  ];
  if (parsed.eventValidation != null) {
    fields.push(["__EVENTVALIDATION", parsed.eventValidation]);
  }
  fields.push([parsed.pageNumName, parsed.pageNumValue]);
  fields.push(...extra);
  const sp = new URLSearchParams();
  for (const [name, value] of fields) {
    if (!allowedFormName(name)) incomplete("제어 이름이 허용 범위가 아닙니다.");
    sp.set(name, value);
  }
  return sp.toString();
}

function postInit(parsed: Parsed, extra: Array<[string, string]>): BoardFetchInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildBody(parsed, extra),
  };
}

function anchorInit(parsed: Parsed, target: string): BoardFetchInit {
  return postInit(parsed, [
    ["__EVENTTARGET", target],
    ["__EVENTARGUMENT", ""],
  ]);
}

function nextInit(parsed: Parsed, nextName: string): BoardFetchInit {
  return postInit(parsed, [
    ["__EVENTTARGET", ""],
    ["__EVENTARGUMENT", ""],
    [`${nextName}.x`, "1"],
    [`${nextName}.y`, "1"],
  ]);
}

/**
 * 한 수집 회차용 쪽 읽기. 호출마다 새 클로저를 만들고, 받은 `fetchText` 로만
 * `Posting.aspx` 를 부른다. HTML 안의 주소는 쓰지 않는다.
 */
export function createSbaPageSession(
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
): (page: number) => Promise<string> {
  let current: Parsed | null = null;

  async function load(init?: BoardFetchInit): Promise<Parsed> {
    const html = await fetchText(LIST_URL, init);
    const parsed = parseSbaPage(html);
    if (!parsed) incomplete("화면 형식을 확인하지 못했습니다.");
    return parsed;
  }

  async function resetToFirst(): Promise<Parsed> {
    current = await load({ method: "GET" });
    return current;
  }

  async function walkTo(page: number): Promise<string> {
    let cur = current;
    if (!cur) incomplete("쪽넘김 상태가 없습니다.");
    let jumps = 0;
    while (cur.active !== page) {
      if (cur.targets.has(page)) {
        const token = cur.targets.get(page);
        if (!token) incomplete("쪽 번호 대상이 허용 범위가 아닙니다.");
        cur = await load(anchorInit(cur, token));
        current = cur;
        if (cur.active !== page) incomplete("응답의 현재 쪽이 요청한 쪽과 다릅니다.");
        return cur.html;
      }
      if (cur.pages.has(page)) incomplete("쪽 번호 대상이 허용 범위가 아닙니다.");
      if (page < cur.groupMin) incomplete("응답의 현재 쪽이 요청한 쪽과 다릅니다.");
      if (jumps >= MAX_GROUP_JUMPS) incomplete("쪽넘김이 100번을 넘어 중단했습니다.");
      const nextName = cur.nextName;
      if (!nextName) {
        if (cur.groupMax <= cur.active) throw new SbaPageEndError(cur.active);
        incomplete("다음 쪽 단추가 없습니다.");
      }
      const before = cur;
      const parsed = await load(nextInit(cur, nextName));
      jumps += 1;
      if (parsed.active === before.active && parsed.groupMin === before.groupMin) {
        if (parsed.groupMax <= parsed.active) throw new SbaPageEndError(parsed.active);
        // 재시작하면 마지막 창의 첫 쪽(예: 231)에서 시작한다. 보이는 마지막 번호
        // (233)로 실제 이동한 뒤 다음 버튼을 다시 확인해야 종료 근거가 생긴다.
        const lastTarget = parsed.targets.get(parsed.groupMax);
        if (!lastTarget) incomplete("마지막 쪽 번호의 대상을 확인하지 못했습니다.");
        const last = await load(anchorInit(parsed, lastTarget));
        if (last.active !== parsed.groupMax || last.groupMin !== parsed.groupMin) {
          incomplete("마지막 쪽 번호로 이동하지 못했습니다.");
        }
        cur = last;
        current = last;
        continue;
      }
      if (parsed.active <= before.active && parsed.groupMin <= before.groupMin) {
        incomplete("쪽 목록 창이 앞으로 넘어가지 않았습니다.");
      }
      cur = parsed;
      current = cur;
    }
    if (cur.active !== page) incomplete("응답의 현재 쪽이 요청한 쪽과 다릅니다.");
    return cur.html;
  }

  return async (page: number): Promise<string> => {
    if (!Number.isInteger(page) || page < 1) incomplete("쪽 번호가 올바르지 않습니다.");
    if (current?.active === page) return current.html;
    if (!current || page < current.active) {
      const first = await resetToFirst();
      if (page === 1) {
        if (first.active !== 1) incomplete("응답의 현재 쪽이 요청한 쪽과 다릅니다.");
        return first.html;
      }
    }
    return walkTo(page);
  };
}
