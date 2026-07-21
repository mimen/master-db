import { describe, expect, test } from "vitest";

import { airtableNameSearchFormula } from "./airtableSearch";

describe("airtableNameSearchFormula", () => {
  test("wraps a plain name in a case-insensitive SEARCH", () => {
    expect(airtableNameSearchFormula("chase")).toBe("SEARCH(LOWER('chase'), LOWER({Name}))");
  });

  test("escapes a single quote so it can't break out of the formula string", () => {
    const formula = airtableNameSearchFormula("O'Brien");
    expect(formula).toBe("SEARCH(LOWER('O\\'Brien'), LOWER({Name}))");
    // The quote count inside the string literal must stay balanced.
    expect((formula.match(/(?<!\\)'/g) ?? []).length).toBe(2);
  });

  test("escapes a backslash before escaping quotes, so a trailing backslash can't eat the closing quote", () => {
    const formula = airtableNameSearchFormula("weird\\name");
    expect(formula).toContain("weird\\\\name");
  });

  test("a name containing formula-like syntax is treated as literal text, not executed", () => {
    const formula = airtableNameSearchFormula("x'), {Phone Number}='+1'");
    // The injected quote is escaped, so everything after it stays inside the string literal.
    expect(formula).toBe("SEARCH(LOWER('x\\'), {Phone Number}=\\'+1\\''), LOWER({Name}))");
  });
});
