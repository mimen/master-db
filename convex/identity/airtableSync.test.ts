import { describe, expect, test } from "vitest";

import { toContactCard } from "./airtableSync";

describe("toContactCard (Airtable Humans row -> pre-grouped card)", () => {
  test("collects phone + both email fields into one card", () => {
    const record = {
      id: "rec001picl9dLbRFy",
      fields: {
        Name: "Chase Petersen",
        "Phone Number": "+16195551234",
        "Email Address": "chase@example.com",
        "Email Address 2": "chase@auf.co",
      },
    };
    expect(toContactCard(record)).toEqual({
      display_name: "Chase Petersen",
      phones: ["+16195551234"],
      emails: ["chase@example.com", "chase@auf.co"],
      airtable_record_id: "rec001picl9dLbRFy",
    });
  });

  test("a record with only one email field omits the missing one, not a hole in the array", () => {
    const record = { id: "rec1", fields: { Name: "Gabrielly Azevedo", "Email Address": "g@example.com" } };
    expect(toContactCard(record)?.emails).toEqual(["g@example.com"]);
  });

  test("a record with no phone or email at all returns null (nothing to link)", () => {
    const record = { id: "rec2", fields: { Name: "No Contact Info" } };
    expect(toContactCard(record)).toBeNull();
  });

  test("carries the Airtable record id through for the person-view deep link", () => {
    const record = { id: "recXYZ", fields: { "Phone Number": "+16195551234" } };
    expect(toContactCard(record)?.airtable_record_id).toBe("recXYZ");
  });

  test("display_name is undefined, not empty string, when Name is missing", () => {
    const record = { id: "rec3", fields: { "Phone Number": "+16195551234" } };
    expect(toContactCard(record)?.display_name).toBeUndefined();
  });
});
