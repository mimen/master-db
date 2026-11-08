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

describe("ContactBook.lookup", () => {
  test("names a phone address, a loosely formatted phone and an email, and nothing unknown", async () => {
    const book = await makeBook();
    expect(book.lookup("+17605050666")).toBe("Meghan Kennedy");
    expect(book.lookup("(760) 505-0666")).toBe("Meghan Kennedy");
    expect(book.lookup("meghan@example.com")).toBe("Meghan Kennedy");
    expect(book.lookup("+10000000000")).toBeNull();
  });
});
