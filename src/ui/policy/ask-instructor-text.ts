export interface InstructorQuestionInput {
  policyTitle: string;
  company?: { name?: string; industry?: string; region?: string };
  condition: string;
  tried?: string;
}

/** 카카오톡에 바로 붙여넣을 평문 질문. 서식 기호(#,*,<,>)를 쓰지 않는다. */
export function buildInstructorQuestion(i: InstructorQuestionInput): string {
  const lines: string[] = [];
  lines.push(`[정책자금 돌파구 문의]`);
  lines.push(`대상 사업: ${i.policyTitle}`);
  const co = i.company;
  if (co && (co.name || co.industry || co.region)) {
    const parts = [co.name, co.industry, co.region].filter(Boolean).join(" · ");
    lines.push(`고객: ${parts}`);
  }
  lines.push(`막힌 조건: ${i.condition}`);
  if (i.tried && i.tried.trim()) lines.push(`현재 상황: ${i.tried.trim()}`);
  lines.push(``);
  lines.push(`이 조건을 넘길 수 있는 방법이 있을까요? 실무 사례나 우회 경로가 있으면 알려주세요.`);
  return lines.join("\n");
}
