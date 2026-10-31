/**
 * Route search validation without zod, which would otherwise ship ~50KB minified in the shared client chunk only to
 * read a handful of query params. Same rules as the zod schemas it replaces (`z.x().optional().catch(undefined)`):
 * a value of the wrong type or outside the allowed set is dropped, never an error.
 */
type Field<T> = (value: unknown) => T | undefined;

export const text =
  (max = Infinity): Field<string> =>
  (v) =>
    typeof v === "string" && v.length <= max ? v : undefined;

/**
 * A key that may look like a number: the router parses `?quote=67` as the number 67, so a hand-typed or shared link to
 * the 67 pair would be dropped by text(). A whole, non-negative number comes back as its decimal string.
 */
export const key =
  (max = Infinity): Field<string> =>
  (v) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? text(max)(String(v)) : text(max)(v);

/** A finite number (zod's z.number()); `int` also requires a whole number. */
export const num =
  (int = false): Field<number> =>
  (v) =>
    typeof v === "number" && Number.isFinite(v) && (!int || Number.isInteger(v)) ? v : undefined;

export const oneOf =
  <const T extends readonly string[]>(values: T): Field<T[number]> =>
  (v) =>
    typeof v === "string" && (values as readonly string[]).includes(v)
      ? (v as T[number])
      : undefined;

type Parsed<S extends Record<string, Field<unknown>>> = {
  [K in keyof S]?: Exclude<ReturnType<S[K]>, undefined>;
};

export function searchSchema<S extends Record<string, Field<unknown>>>(fields: S) {
  return (input: Record<string, unknown>): Parsed<S> => {
    const out: Record<string, unknown> = {};
    for (const key in fields) {
      const value = fields[key](input[key]);
      if (value !== undefined) out[key] = value;
    }
    return out as Parsed<S>;
  };
}
