import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 서류 올리기 상자·사업자 정보 칸의 흰 글자 배지·파랑 글자가 WCAG AA(4.5)를 넘는 토큰만 쓰는지 잰다.
 * 2026-10-05 ERP 디자인 관문 axe 가 XLS(초록 4.36)·IMG(주황 3.58)·고른 단추(파랑 on 옅은 파랑 3.64)를 잡았다.
 * 색값은 세 앱 globals.css 의 WEDLY 토큰과 같다.
 */
const TOKEN: Record<string, string> = {
  "wedly-red": "#E03131", "wedly-green": "#2B8A3E", "wedly-green-ink": "#247434", "wedly-orange": "#E8590C",
  "wedly-gold-ink": "#8C5B00", "wedly-accent": "#006AFF", "wedly-accent-ink": "#005DDF", "wedly-t1": "#000000",
  "wedly-muted": "#70767D", "wedly-bg-blue": "#D3E5FE",
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("서류 올리기·사업자 정보 글자 대비", () => {
  it("형식 배지(흰 글자) 바탕은 모두 4.5 이상", () => {
    const table = src("./DocumentUploadBox.tsx").match(/const KIND_BG[^{]*\{([^}]*)\}/)?.[1] ?? "";
    const bgs = [...table.matchAll(/bg-(wedly-[a-z0-9-]+)/g)].map((m) => m[1]);
    expect(bgs.length).toBe(6);
    for (const bg of bgs) {
      expect(TOKEN[bg], `${bg} 값 표`).toBeDefined();
      expect(ratio(TOKEN[bg], "#FFFFFF"), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("옅은 파랑 바탕 위 글자는 accent-ink(4.5 이상)", () => {
    expect(ratio(TOKEN["wedly-accent-ink"], TOKEN["wedly-bg-blue"])).toBeGreaterThanOrEqual(4.5);
    const form = src("./ProfileForm.tsx");
    for (const m of form.matchAll(/bg-wedly-bg-blue[^"`]*/g)) expect(m[0], m[0]).not.toMatch(/text-wedly-accent(?!-ink)/);
  });

  it("「모름」 칸은 투명도로 흐리지 않는다", () => {
    const form = src("./ProfileForm.tsx");
    expect(form).not.toMatch(/opacity-70/);
  });
});
