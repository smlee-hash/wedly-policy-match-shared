import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import CustomSelect from "./CustomSelect";

it("forwards editor autofocus and contextual title to the real trigger", () => {
  const html = renderToStaticMarkup(<CustomSelect value="a" onChange={() => {}}
    options={[{value:"a",label:"Alpha"}]} autoFocus title="Move field" />);
  const trigger = html.match(/<button\b[^>]*>/)?.[0] ?? "";
  expect(trigger).toContain('autofocus=""');
  expect(trigger).toContain('title="Move field"');
});
