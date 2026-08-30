import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { ContactBook } from "./contacts";

async function makeBook() {
  const bb = new FakeBlueBubbles({
    chats: [],
    contacts: [
      {
        firstName: "Meghan",
        lastName: "Kennedy",
        phoneNumbers: [{ address: "+17605050666" }],
        emails: [{ address: "Meghan@Example.com" }],
      },
      {
        firstName: "Kabo",
        phoneNumbers: [{ address: "+15559990000" }],
        emails: [],
      },
    ],
  });
  const book = new ContactBook(bb);
  await book.refresh(true);
  return book;
}

describe("ContactBook.emails", () => {
  test("resolves a phone address to the same contact's emails", async () => {
    const book = await makeBook();
    expect(book.emails("+17605050666")).toEqual(["Meghan@Example.com"]);
  });

  test("matches loose phone formatting through the digit-suffix key", async () => {
    const book = await makeBook();
    expect(book.emails("(760) 505-0666")).toEqual(["Meghan@Example.com"]);
  });

  test("an email address resolves to its own contact's emails", async () => {
    const book = await makeBook();
    expect(book.emails("meghan@example.com")).toEqual(["Meghan@Example.com"]);
  });

  test("contacts without emails and unknown addresses yield []", async () => {
    const book = await makeBook();
    expect(book.emails("+15559990000")).toEqual([]);
    expect(book.emails("+10000000000")).toEqual([]);
  });
});
