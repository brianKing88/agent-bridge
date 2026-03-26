/**
 * Simple readline prompt — zero dependencies
 */

import { createInterface } from "node:readline";

export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer || defaultValue || "");
    });
  });
}
