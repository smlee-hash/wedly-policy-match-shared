import { describe, it, expect } from "vitest";
import { extractFromRss, extractFromJson } from "./feed";

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>2026 지원사업 공고 A</title><link>https://c.kr/v/1</link><pubDate>2026-08-01</pubDate></item>
<item><title>지원사업 공고 B</title><link>https://c.kr/v/2</link><pubDate>2026-08-02</pubDate></item>
</channel></rss>`;

describe("feed", () => {
  it("RSS 항목을 행으로", () => {
    const rows = extractFromRss(RSS, { title: "title", link: "link", date: "pubDate" });
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("2026 지원사업 공고 A");
    expect(rows[0].detailUrl).toBe("https://c.kr/v/1");
    expect(rows[0].dateText).toBe("2026-08-01");
  });
  it("JSON 배열을 행으로", () => {
    const json = JSON.stringify({ data: [{ nm: "공고X", u: "https://c.kr/x", d: "2026-08-05" }] });
    const rows = extractFromJson(json, "data", { title: "nm", link: "u", date: "d" });
    expect(rows[0].title).toBe("공고X");
    expect(rows[0].detailUrl).toBe("https://c.kr/x");
  });
  it("Atom self-closing link 의 href 를 쓰고 엔티티를 복원한다", () => {
    const atom = `<?xml version="1.0"?><feed>
<entry><title>공고 Atom</title><link href="https://c.kr/v?a=1&amp;b=2"/><updated>2026-08-01</updated></entry>
<entry><title>공고 Atom2</title><link href="https://c.kr/v/2"></link><updated>2026-08-02</updated></entry>
</feed>`;
    const rows = extractFromRss(atom, { title: "title", link: "link", date: "updated" });
    expect(rows).toHaveLength(2);
    expect(rows[0].detailUrl).toBe("https://c.kr/v?a=1&b=2");
    expect(rows[1].detailUrl).toBe("https://c.kr/v/2");
  });
  it("dateText 의 점·빗금 날짜를 정규화한다", () => {
    const rss = `<?xml version="1.0"?><rss><channel>
<item><title>공고C</title><link>https://c.kr/v/3</link><pubDate>2026.08.01</pubDate></item>
</channel></rss>`;
    const fromRss = extractFromRss(rss, { title: "title", link: "link", date: "pubDate" });
    expect(fromRss[0].dateText).toBe("2026-08-01");
    const json = JSON.stringify({ data: [{ nm: "공고Y", u: "https://c.kr/y", d: "2026/08/14" }] });
    const fromJson = extractFromJson(json, "data", { title: "nm", link: "u", date: "d" });
    expect(fromJson[0].dateText).toBe("2026-08-14");
  });
});
