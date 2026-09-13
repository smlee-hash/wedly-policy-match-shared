import { parseApplyPeriod } from "../../engine/types";
import { normalizeDateText, parseHtml, type HTMLElement } from "./html";
import { gtpConfig, isGtpDropTitle } from "./sources/gtp";
import type { BoardConfig, BoardFetchInit } from "./types";

/** ERP 출처 해시용. GTP 지난 공고만 1쪽부터 다시 읽게 하는 고정값. */
export const GTP_ARCHIVE_COLLECTION_REVISION = "gtp-archive-detail-dates-v1";

const VIEW = "https://pms.gtp.or.kr/web/business/webBusinessView.do";
const B_IDX = /fn_goView\(\s*'(\d+)'\s*\)/;
const CLOSED_LABEL = "마감";
const PERIOD_LABEL = "접수 기간";

function failArchivePage(): never {
  throw new Error("경기테크노파크 지난 공고의 접수 기간을 확인하지 못했습니다");
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function gtpDetailUrl(id: string): string {
  return `${VIEW}?b_idx=${id}`;
}

/** 상세에서 「접수 기간」 바로 옆 dd 한 칸만 기간으로 인정한다. */
function officialClosedPeriodText(detailHtml: string): string {
  const labelled: string[] = [];
  for (const dt of parseHtml(detailHtml).querySelectorAll("dt")) {
    if (compactText(dt.text) !== PERIOD_LABEL) continue;
    const dd = dt.nextElementSibling;
    if (!dd || dd.tagName !== "DD") failArchivePage();
    labelled.push(compactText(dd.text));
  }
  if (labelled.length !== 1) failArchivePage();
  return labelled[0]!;
}

/** 목록 「마감」 줄은 이미 끝난 기간만 살린다. 날짜를 지어내지 않는다. */
function validatedClosedPeriod(detailHtml: string, now: number): string {
  const raw = officialClosedPeriodText(detailHtml);
  if (!raw) failArchivePage();
  const days = normalizeDateText(raw).match(/20\d{2}-\d{2}-\d{2}/g) ?? [];
  if (days.length !== 2) failArchivePage();
  const text = `${days[0]} ~ ${days[1]}`;
  const { start, end } = parseApplyPeriod(text);
  if (!start || !end || start.getTime() > end.getTime() || end.getTime() >= now) failArchivePage();
  return text;
}

function closedPolicyPeriodCells(root: HTMLElement): { id: string; cell: HTMLElement }[] {
  const closed: { id: string; cell: HTMLElement }[] = [];
  for (const tr of root.querySelectorAll("table.t01 tbody tr")) {
    if (tr.querySelectorAll("td").length < 6) continue;
    const periodCell = tr.querySelector("td.last");
    if (compactText(periodCell?.text ?? "") !== CLOSED_LABEL) continue;
    const a = tr.querySelector("td.subject a");
    const title = compactText(a?.getAttribute("title") || a?.text || "");
    if (!title) failArchivePage();
    if (isGtpDropTitle(title)) continue;
    const id = (a?.getAttribute("onclick") ?? "").match(B_IDX)?.[1] ?? "";
    if (!id || !periodCell) failArchivePage();
    closed.push({ id, cell: periodCell });
  }
  return closed;
}

async function hydrateGtpClosedPeriodCells(
  html: string,
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
): Promise<string> {
  const root = parseHtml(html);
  const closed = closedPolicyPeriodCells(root);
  if (closed.length === 0) return html;

  const now = Date.now();
  const periods = new Map<string, string>();
  for (const { id } of closed) {
    if (periods.has(id)) continue;
    periods.set(id, validatedClosedPeriod(await fetchText(gtpDetailUrl(id)), now));
  }
  for (const { id, cell } of closed) {
    cell.textContent = periods.get(id)!;
  }
  return root.toString();
}

/** 목록 HTML 만 읽고, 「마감」 정책 줄의 기간 칸만 상세 날짜로 채운다. */
export function createGtpArchiveListSession(
  fetchText: (url: string, init?: BoardFetchInit) => Promise<string>,
  cfg: BoardConfig = gtpConfig,
): (page: number) => Promise<string> {
  return async (page) => {
    const html = await fetchText(cfg.list.url(page), cfg.list.init?.(page));
    return hydrateGtpClosedPeriodCells(html, fetchText);
  };
}

/** 원본 설정은 그대로 두고 창 수집에만 지난 공고 세션을 붙인다. */
export function gtpArchiveWindowConfig(cfg: BoardConfig): BoardConfig {
  if (cfg.id !== "gtp") return cfg;
  const prior = cfg.createListSession;
  if (!prior) return { ...cfg, createListSession: (fetchText) => createGtpArchiveListSession(fetchText, cfg) };
  return {
    ...cfg,
    createListSession: (fetchText) => {
      const readList = prior(fetchText);
      return async (page) => hydrateGtpClosedPeriodCells(await readList(page), fetchText);
    },
  };
}
