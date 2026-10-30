import { describe, expect, test } from "bun:test";
import { HANDLE_RE, isReservedHandle } from "../../src/lib/mintdex/constants";
import { cleanHandle } from "../../src/lib/mintdex/format";

// The demo's handle field (session.tsx EnterDialog): what it keeps of what was typed, and when it says so.
describe("the demo handle field", () => {
  test("a dash, dot or space becomes an underscore, with no note", () => {
    expect(cleanHandle("walk-phone-1")).toEqual({ handle: "walk_phone_1", removed: false });
    expect(cleanHandle("Ana.Lee")).toEqual({ handle: "ana_lee", removed: false });
    expect(cleanHandle("big fan")).toEqual({ handle: "big_fan", removed: false });
    expect(HANDLE_RE.test(cleanHandle("walk-phone-1").handle)).toBe(true);
  });
  test("anything else outside letters, numbers and _ is removed, and the field says so", () => {
    expect(cleanHandle("ab!c")).toEqual({ handle: "abc", removed: true });
    expect(cleanHandle("zoë")).toEqual({ handle: "zo", removed: true });
    expect(cleanHandle("@ana")).toEqual({ handle: "ana", removed: true });
  });
  test("a clean handle passes through unchanged and quietly", () => {
    expect(cleanHandle("glorb_fan_7")).toEqual({ handle: "glorb_fan_7", removed: false });
    expect(cleanHandle("")).toEqual({ handle: "", removed: false });
  });
  test("the rules themselves do not move: length and reserved handles are still checked as before", () => {
    expect(HANDLE_RE.test(cleanHandle("ab").handle)).toBe(false);
    expect(HANDLE_RE.test("a".repeat(17))).toBe(false);
    expect(isReservedHandle(cleanHandle("Official-Team").handle)).toBe(true);
  });
});
