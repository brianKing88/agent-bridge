/**
 * Terminal UI helpers — zero dependencies
 */

const isColorSupported =
  process.env.FORCE_COLOR !== "0" &&
  (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY);

const fmt =
  (open: string, close: string) =>
  (text: string) =>
    isColorSupported ? `\x1b[${open}m${text}\x1b[${close}m` : text;

export const bold = fmt("1", "22");
export const dim = fmt("2", "22");
export const red = fmt("31", "39");
export const green = fmt("32", "39");
export const yellow = fmt("33", "39");
export const cyan = fmt("36", "39");
export const magenta = fmt("35", "39");

export function box(lines: string[], { title, color = cyan }: { title?: string; color?: (s: string) => string } = {}) {
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), title ? stripAnsi(title).length + 2 : 0);
  const w = maxLen + 2;

  const top = title
    ? `  ${color("┌─")} ${bold(title)} ${color("─".repeat(Math.max(0, w - stripAnsi(title).length - 3)) + "┐")}`
    : `  ${color("┌" + "─".repeat(w) + "┐")}`;
  const bot = `  ${color("└" + "─".repeat(w) + "┘")}`;

  const body = lines.map((l) => {
    const pad = " ".repeat(Math.max(0, maxLen - stripAnsi(l).length));
    return `  ${color("│")} ${l}${pad} ${color("│")}`;
  });

  return [top, ...body, bot].join("\n");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
