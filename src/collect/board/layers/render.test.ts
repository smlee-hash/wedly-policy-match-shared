import { describe, it, expect } from "vitest";
import { renderAndFetch } from "./render";

describe("renderAndFetch", () => {
  it("아직 미구현이라 명시적으로 throw 한다", async () => {
    await expect(renderAndFetch("https://e.kr/list")).rejects.toThrow(/headless 렌더 미지원/);
  });
});
