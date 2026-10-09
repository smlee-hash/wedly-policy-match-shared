import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import ProfileForm from "./ProfileForm";
import DocumentUploadBox from "./DocumentUploadBox";
import PolicyMatchScreen from "./PolicyMatchScreen";
import { DOCUMENT_UPLOAD_LIMITS } from "../../documents/types";
import { ERP_POLICY_MATCH_ENDPOINTS } from "./endpoints";

// 승인 v5 항목 목록. 구조는 HTML로, 크기·반응형 계약은 실제 배포 CSS로 검사한다.
// 계산된 크기와 sticky의 ERP 스크롤 기준은 총괄의 데스크톱·모바일 브라우저 대조가 맡는다.
const sections = [
  ["basic", ["name", "bizno", "corp", "industry", "address", "founded"]],
  ["scale", ["revenue", "employees", "scale"]],
  ["credit", ["loan", "nice", "kcb"]],
  ["cert", ["tax", "cert", "patent"]],
] as const;
const css = readFileSync(new URL("./ProfileForm.css", import.meta.url), "utf8");
const wide = (props: Partial<Parameters<typeof ProfileForm>[0]> = {}) => parse(renderToStaticMarkup(
  <ProfileForm
    layout="wide"
    onDiagnose={async () => true}
    diagnosing={false}
    prefillEndpoint="/api/prefill"
    documentPrefillEndpoint="/api/documents"
    {...props}
  />,
));

describe("승인 v5 — 넓은 폼의 구조·항목 목록", () => {
  it("앱 공통 제목 단계와 글자 역할이 일치한다", () => {
    // ERP·일루아의 text-tiers 계약: 시각 크기와 접근 가능한 제목 단계가 함께 맞아야 한다.
    const role = { H1: "page", H2: "section", H3: "sub", H4: "sub" } as const;
    for (const layout of ["wide", "side"] as const) {
      for (const heading of wide({ layout }).querySelectorAll("h1,h2,h3,h4")) {
        const classes = heading.classNames.split(/\s+/);
        expect(classes.filter((name) => /^text-wedly-(page|section|sub)$/.test(name)))
          .toEqual([`text-wedly-${role[heading.tagName as keyof typeof role]}`]);
      }
    }
  });

  it("행동줄을 자르지 않는 뿌리의 첫 자식으로 두고 가져오기와 구역을 다음 카드에 둔다", () => {
    const tree = wide();
    const root = tree.querySelector('[data-layout="wide"]')!;
    expect(root.childNodes.filter((node) => node.nodeType === 1)).toHaveLength(2);
    expect(root.querySelector('[data-panel="footer"]')?.parentNode).toBe(root);
    expect(root.querySelector('[data-panel="body"]')?.parentNode).toBe(root);
    expect(root.innerHTML.indexOf('data-panel="footer"')).toBeLessThan(root.innerHTML.indexOf('data-panel="body"'));
    expect(root.querySelector('.policy-profile-card .policy-profile-action')).toBeNull();
    expect(root.querySelectorAll('.policy-profile-match')).toHaveLength(1);
    expect(tree.querySelectorAll('[data-meter-segment]')).toHaveLength(15);
    const meter = tree.querySelector('[role="progressbar"]')!;
    expect(meter.getAttribute("aria-valuemax")).toBe("15");
    expect(meter.getAttribute("aria-valuenow")).toBe("0");
    const rootClasses = (root.getAttribute("class") ?? "").split(/\s+/);
    expect(rootClasses.some((name) => /overflow/.test(name))).toBe(false);
  });

  it("네 구역은 승인된 6·3·3·3개 필드를 한 번씩만 가진다", () => {
    const tree = wide();
    expect(tree.querySelectorAll('[data-section]')).toHaveLength(4);
    for (const [key, fields] of sections) {
      const section = tree.querySelector(`[data-section="${key}"]`)!;
      expect(section.querySelectorAll('[data-k]').map((node) => node.getAttribute("data-k"))).toEqual([...fields]);
      expect(section.querySelector('[data-section-count]')?.getAttribute("aria-label")).toBe(`${fields.length}개 중 0개 입력`);
      expect(section.querySelectorAll('.policy-profile-fields')).toHaveLength(1);
    }
    expect(tree.querySelectorAll('.policy-profile-field')).toHaveLength(15);
    expect(tree.querySelectorAll('[data-filled="false"]')).toHaveLength(15);
    expect(tree.querySelectorAll('.policy-profile-field[data-unk="true"]')).toHaveLength(15);
  });

  it("실제 통로가 있는 가져오기 모듈만 그려 빈 자리를 만들지 않는다", () => {
    expect(wide().querySelectorAll('.policy-profile-import')).toHaveLength(2);
    for (const absent of ["prefillEndpoint", "documentPrefillEndpoint"] as const) {
      const tree = wide({ [absent]: undefined });
      expect(tree.querySelectorAll('.policy-profile-import')).toHaveLength(1);
      expect(tree.querySelectorAll('.policy-profile-field')).toHaveLength(15);
    }
    const tree = wide({ prefillEndpoint: undefined, documentPrefillEndpoint: undefined });
    expect(tree.querySelector('.policy-profile-imports')).toBeNull();
    expect(tree.querySelector('[data-k="documents"]')).toBeNull();
    expect(tree.querySelector('[aria-label="고객 상호 또는 사업자번호"]')).toBeNull();
  });

  it("진단 중에는 같은 주 행동만 남고 비활성화된다", () => {
    const tree = wide({ diagnosing: true });
    const actions = tree.querySelectorAll('.policy-profile-match');
    expect(actions).toHaveLength(1);
    expect(actions[0].hasAttribute("disabled")).toBe(true);
    expect(actions[0].text).toBe("진단 중…");
  });

  it("화면 제목·회사 폼·수집원은 하나의 전체 폭 안에 있고 기존 최대 폭을 두지 않는다", () => {
    const tree = parse(renderToStaticMarkup(<PolicyMatchScreen endpoints={ERP_POLICY_MATCH_ENDPOINTS} />));
    const root = tree.querySelector('.policy-match-screen')!;
    const company = root.querySelector('[data-area="company-panel"]')!;
    expect(company.parentNode).toBe(root);
    expect(company.classNames).toContain("w-full");
    expect(company.querySelector('[data-area="company-intro"] [data-area="step-bar"]')).not.toBeNull();
    expect(root.toString()).not.toContain("max-w-[880px]");
    expect(root.querySelectorAll('.policy-profile-match')).toHaveLength(1);
    expect(root.toString()).not.toMatch(/preview-bar|sample-btn|result-demo|시안용 예시/);
  });
});

describe("승인 v5 — 배포 스타일의 반응형 계약", () => {
  it("제목 레일 136px과 동일한 세 필드 열을 쓰고 충돌 선택은 현재 그리드 전체에 걸친다", () => {
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-section\s*\{[^}]*grid-template-columns:\s*136px minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-fields\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-field\s*\{[^}]*grid-column:\s*auto/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-conflict\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).not.toMatch(/grid-template-rows|grid-auto-rows/);
  });

  it("1000px에서는 레일을 위로, 760px에서는 필드·가져오기를 한 열로 바꾼다", () => {
    const tablet = css.slice(css.indexOf("@media (max-width: 1000px)"), css.indexOf("@media (max-width: 760px)"));
    const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(tablet).toMatch(/\.policy-match-intro\s*\{\s*display: block/);
    expect(tablet).toMatch(/\.policy-profile-wide \.policy-profile-section\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    for (const selector of ["fields", "imports"]) {
      expect(mobile).toMatch(new RegExp(`\\.policy-profile-wide \\.policy-profile-${selector}\\s*\\{[^}]*grid-template-columns:\\s*minmax\\(0, 1fr\\)`));
    }
  });

  it("ERP 틀이 바깥 여백을 맡도록 화면 자체의 패딩은 모든 너비에서 0이다", () => {
    const screenRules = [...css.matchAll(/\.policy-match-screen\s*\{([^}]*)\}/g)];
    expect(screenRules).toHaveLength(1);
    expect(screenRules[0][1]).toMatch(/padding:\s*0\s*;/);
  });

  it("빈 입력·제목 레일·검색·서류 칸은 기존 페이지 배경 토큰을 쓴다", () => {
    for (const selector of [
      "policy-profile-field input", "policy-profile-section-head", "policy-profile-search-input",
      "policy-profile-dropzone", "policy-profile-file-action",
    ]) {
      expect(css).toMatch(new RegExp(`\\.policy-profile-wide \\.${selector}\\s*\\{[^}]*background-color:\\s*var\\(--wedly-bg-page\\)`));
    }
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-field\[data-filled="true"\] input\s*\{[^}]*background-color:\s*var\(--color-white\)/);
    expect(css).not.toContain("--wedly-bg-sidebar");
    expect(css).not.toContain("@apply");
    const globalCss = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(globalCss).not.toMatch(/\.policy-profile-|\.policy-match-/);
  });

  it("고정 행동줄·20px 수·52/48px 주 행동·40px 입력·테두리 있는 막대를 유지한다", () => {
    expect(css).toMatch(/\.policy-profile-wide\s*\{[^}]*overflow:\s*visible/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-action\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-count\s*\{[^}]*font-size:\s*20px/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-match\s*\{[^}]*min-height:\s*52px/);
    expect(css.slice(css.indexOf("@media (max-width: 760px)"))).toMatch(/\.policy-profile-wide \.policy-profile-match\s*\{[^}]*min-height:\s*48px/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-field input\s*\{[^}]*height:\s*40px/);
    expect(css).toMatch(/\.policy-profile-wide \.policy-profile-meter\s*\{[^}]*border-width:\s*1px/);
    expect(css).toMatch(/scroll-margin-top:\s*calc\(var\(--policy-match-sticky-top/);
    expect(css).toContain('.policy-profile-certs button[aria-pressed="true"]::before');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

describe("서류 compact — 실제 처리와 안내 보존", () => {
  it("파일 목록·오류·진행·지원 형식·한도·저장·붙이기 안내를 남긴다", () => {
    const html = renderToStaticMarkup(<DocumentUploadBox
      compact busy error="서류 읽기 오류" attached attachNote="일부 파일만 붙였습니다"
      files={[{ id: 1, result: { name: "등록증.pdf", status: "read", docType: "biz-registration", fields: ["bizno"] } }]}
      onPick={() => {}} onRemove={() => {}}
    />);
    const tree = parse(html);
    expect(tree.querySelector('input[type="file"]')?.getAttribute("accept")).toBe(DOCUMENT_UPLOAD_LIMITS.acceptExtensions.join(","));
    expect(tree.querySelector('input[type="file"]')?.hasAttribute("disabled")).toBe(true);
    expect(tree.querySelector('[data-file="등록증.pdf"]')).not.toBeNull();
    expect(tree.querySelector('[aria-label="등록증.pdf 빼기"]')).not.toBeNull();
    expect(tree.querySelector('[role="alert"]')?.text).toBe("서류 읽기 오류");
    for (const text of ["서류를 읽는 중", "합계 50MB", "지원 서류·저장 안내", "옛 한글(.hwp)", "올린 서류를 고객 자료에 붙여 두었습니다", "일부 파일만 붙였습니다"]) {
      expect(tree.text).toContain(text);
    }
    expect(tree.querySelectorAll('[data-fmt]')).toHaveLength(5);
    expect(tree.querySelector('details [data-doc-note="attach"]')).not.toBeNull();
  });

  it("랩의 저장 안 함과 사진 안내를 compact에서도 보존한다", () => {
    const html = renderToStaticMarkup(<DocumentUploadBox compact mode="lab" files={[]} busy={false} error="" attached onPick={() => {}} onRemove={() => {}} />);
    expect(html).toContain("서류를 저장하지 않아요");
    expect(html).toContain("사진·스캔본은 글자 있는 PDF로");
    expect(html).not.toContain("올린 서류를 고객 자료에 붙여 두었습니다");
  });
});
