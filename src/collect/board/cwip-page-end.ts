import { parseHtml, type HTMLElement } from "./html";
import type { BoardConfig } from "./types";

/** 실측: 한 쪽 25개, 312개 사업의 마지막은13쪽. 빈 표식 대신 현재14/13을 표시한다. */
export function isProvenCwipEnd(html: string, cfg: BoardConfig, page?: number): boolean {
  if (cfg.id !== "cwip" || !Number.isSafeInteger(page) || page! < 1) return false;
  try {
    const root = parseHtml(html);
    const counters = root.querySelectorAll(".btn_ov01 .ov_num strong");
    const totals = root.querySelectorAll(".btn_ov01 .ov_txt");
    if (counters.length !== 1 || totals.length !== 1) return false;
    const position = counters[0].text.trim().match(/^(\d+)\/(\d+)$/);
    const count = totals[0].text.trim().match(/^전체\s+(\d+)개\s+사업$/);
    if (!position || !count) return false;
    const [current, last, total] = [Number(position[1]), Number(position[2]), Number(count[1])];
    if (![current, last, total].every(n => Number.isSafeInteger(n) && n > 0) ||
        current !== page || current <= last || last !== Math.ceil(total / 25)) return false;
    const lists = root.querySelectorAll("#list_type");
    if (lists.length !== 1 || lists[0].childNodes.some(n => n.nodeType !== 1 && n.text.trim())) return false;
    const children = lists[0].childNodes.filter(n => n.nodeType === 1) as HTMLElement[];
    if (children.length !== 1) return false;
    const header = children[0];
    if (!header.classList.contains("card_wrap") || !header.classList.contains("card_list_head") ||
        header.querySelector("a, [onclick]") || header.querySelector(".card_link_a")?.text.trim() !== "사업공고명" ||
        header.querySelector(".card_date")?.text.trim() !== "신청기간") return false;
    const urls = root.querySelectorAll(".page_num .pg_wrap a.pg_page")
      .map(a => new URL(a.getAttribute("href") ?? "", cfg.baseUrl));
    return urls.some(url => url.searchParams.get("page") === String(last)) && urls.every(url => {
      const linkedPage = Number(url.searchParams.get("page"));
      return Number.isSafeInteger(linkedPage) && linkedPage >= 1 && linkedPage <= last &&
        url.toString() === new URL(cfg.list.url(linkedPage)).toString();
    });
  } catch { return false; }
}
