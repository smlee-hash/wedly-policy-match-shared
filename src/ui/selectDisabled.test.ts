import { describe, expect, it } from "vitest";
import { initialHighlight, nextIndex, typeAheadIndex } from "./selectKeyboard";

describe("disabled select options", () => {
  const disabled = (index: number) => index === 0 || index === 2;
  it("skips unavailable options in both directions and on wrap", () => {
    expect(nextIndex(-1, 4, 1, disabled)).toBe(1);
    expect(nextIndex(1, 4, 1, disabled)).toBe(3);
    expect(nextIndex(3, 4, 1, disabled)).toBe(1);
    expect(nextIndex(1, 4, -1, disabled)).toBe(3);
  });
  it("does not highlight anything when every option is unavailable", () => {
    expect(nextIndex(0, 3, 1, () => true)).toBe(-1);
    expect(nextIndex(-1, 0, -1, () => true)).toBe(-1);
    expect(initialHighlight("selected", 3, 0, () => true)).toBe(-1);
  });
  it("opens at an enabled boundary or selected option", () => {
    expect(initialHighlight("first", 4, 3, disabled)).toBe(1);
    expect(initialHighlight("last", 3, 1, disabled)).toBe(1);
    expect(initialHighlight("selected", 4, 3, disabled)).toBe(3);
    expect(initialHighlight("selected", 4, 2, disabled)).toBe(1);
  });
  it("never finds an unavailable item with typeahead", () => {
    const options = [{label: "Alpha", disabled: true}, {label: "Alpine"}, {label: "Beta", disabled: true}];
    const unavailable = (index: number) => !!options[index]?.disabled;
    expect(typeAheadIndex(options, "Al", 0, unavailable)).toBe(1);
    expect(typeAheadIndex(options, "Be", 0, unavailable)).toBe(-1);
  });
  it("preserves legacy three-argument matching when data has a disabled property", () => {
    const options = [{label: "Alpha", disabled: true}, {label: "Alpine"}];
    expect(typeAheadIndex(options, "Al", 0)).toBe(0);
  });
});
