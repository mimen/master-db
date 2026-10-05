import { expect, test } from "bun:test";
import { formatReceiptTime, formatThreadTime } from "./format";

const NOW = new Date(2026, 9, 9, 11, 0).getTime(); // Friday, October 9
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

test("thread separators name the day and the time", () => {
  expect(formatThreadTime(at(9, 10, 41), NOW)).toBe("Today 10:41 AM");
  expect(formatThreadTime(at(8, 20, 12), NOW)).toBe("Yesterday 8:12 PM");
  expect(formatThreadTime(at(7, 18, 3), NOW)).toBe("Wednesday 6:03 PM");
  expect(formatThreadTime(at(1, 9, 0), NOW)).toBe("Thu, Oct 1 at 9:00 AM");
});

test("read receipts shorten to a weekday or a date past today", () => {
  expect(formatReceiptTime(at(9, 10, 42), NOW)).toBe("10:42 AM");
  expect(formatReceiptTime(at(8, 10, 42), NOW)).toBe("Yesterday");
  expect(formatReceiptTime(at(5, 10, 42), NOW)).toBe("Monday");
  expect(formatReceiptTime(at(1, 10, 42), NOW)).toBe("Oct 1");
});
