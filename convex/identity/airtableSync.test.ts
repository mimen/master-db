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

  test("maps First Name / Last Name into the card alongside Name", () => {
    const record = {
      id: "rec4",
      fields: {
        Name: "Chase Petersen",
        "First Name": "Chase",
        "Last Name": "Petersen",
        "Phone Number": "+16195551234",
      },
    };
    const card = toContactCard(record);
    expect(card?.first_name).toBe("Chase");
    expect(card?.last_name).toBe("Petersen");
  });

  test("first_name/last_name are undefined (not empty strings) for a freeform row like a venue name", () => {
    // Airtable Humans has rows like "The Brooklyn Mirage" with no real
    // First/Last Name columns filled in — see identities.ts's docstring.
    const record = { id: "rec5", fields: { Name: "The Brooklyn Mirage", "Phone Number": "+16195551234" } };
    const card = toContactCard(record);
    expect(card?.first_name).toBeUndefined();
    expect(card?.last_name).toBeUndefined();
    expect(card?.display_name).toBe("The Brooklyn Mirage");
  });

  test("collects all 3 phone columns and all 4 email columns — these are join keys, not just enrichment", () => {
    const record = {
      id: "rec6",
      fields: {
        Name: "Chase Petersen",
        "Phone Number": "+16195551234",
        "Phone Number 2": "+16195555678",
        "Phone Number 3": "+16195559999",
        "Email Address": "chase@example.com",
        "Email Address 2": "chase@auf.co",
        "Email Address 3": "chase@work.co",
        "Email Address 4": "chase@old.com",
      },
    };
    const card = toContactCard(record);
    expect(card?.phones).toEqual(["+16195551234", "+16195555678", "+16195559999"]);
    expect(card?.emails).toEqual(["chase@example.com", "chase@auf.co", "chase@work.co", "chase@old.com"]);
  });

  test("a hole in the middle (Phone Number 2 missing) doesn't leave a hole in the array", () => {
    const record = {
      id: "rec7",
      fields: { "Phone Number": "+16195551234", "Phone Number 3": "+16195559999" },
    };
    expect(toContactCard(record)?.phones).toEqual(["+16195551234", "+16195559999"]);
  });
});
