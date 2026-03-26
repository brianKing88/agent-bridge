/**
 * Minimal argument parser — zero dependencies
 */

type ArgType = "string" | "number" | "boolean";

export function parseArgs<T extends Record<string, ArgType>>(
  argv: string[],
  schema: T
): { [K in keyof T]?: T[K] extends "number" ? number : T[K] extends "boolean" ? boolean : string } & { _: string[] } {
  const result: any = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key in schema) {
        if (schema[key] === "boolean") {
          result[key] = true;
        } else {
          const val = argv[++i];
          result[key] = schema[key] === "number" ? parseInt(val, 10) : val;
        }
      }
    } else {
      result._.push(arg);
    }
  }

  return result;
}
