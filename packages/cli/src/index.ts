#!/usr/bin/env npx tsx
/**
 * Agent Bridge CLI
 *
 * Usage:
 *   npx agent-bridge hub                  — Start a hub
 *   npx agent-bridge join <hub-url>       — Join a hub as an agent
 *   npx agent-bridge                      — Interactive mode
 */

import { startHub } from "./hub.js";
import { joinHub } from "./join.js";
import { startWorker } from "./worker.js";
import { bold, cyan, dim, green, red, yellow, box } from "./ui.js";
import { prompt } from "./prompt.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  console.log();
  console.log(`  ${bold("Agent Bridge")} ${dim("v0.1.0")}`);
  console.log(`  ${dim("Multi-agent collaboration for Claude Code")}`);
  console.log();

  if (command === "hub") {
    await startHub(args.slice(1));
  } else if (command === "join") {
    await joinHub(args.slice(1));
  } else if (command === "worker") {
    await startWorker(args.slice(1));
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    // Interactive mode — ask what they want to do
    const choice = await prompt(
      `  What would you like to do?\n\n` +
        `    ${cyan("1)")} Start a Hub ${dim("(run once, others connect to you)")}\n` +
        `    ${cyan("2)")} Join a Hub  ${dim("(connect your Claude Code to an existing hub)")}\n\n` +
        `  Enter choice ${dim("[1/2]")}: `
    );

    console.log();

    if (choice.trim() === "1" || choice.trim().toLowerCase() === "hub") {
      await startHub([]);
    } else if (choice.trim() === "2" || choice.trim().toLowerCase() === "join") {
      await joinHub([]);
    } else {
      console.log(`  ${red("Unknown choice.")} Run ${cyan("npx agent-bridge --help")} for usage.`);
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log(`  ${bold("Commands:")}`);
  console.log();
  console.log(`    ${cyan("hub")}   ${dim("[--port 9900] [--token xxx]")}`);
  console.log(`          Start a relay hub. Other agents connect to this.`);
  console.log();
  console.log(`    ${cyan("join")}  ${dim("<hub-url> [--token xxx] [--id my-agent] [--role backend]")}`);
  console.log(`          Join an existing hub. Configures Claude Code MCP automatically.`);
  console.log();
  console.log(`    ${cyan("worker")} ${dim("<hub-url> --token xxx [--id my-worker] [--role backend]")}`);
  console.log(`          Start an autonomous worker. Receives messages, executes with Claude, replies.`);
  console.log();
  console.log(`  ${bold("Examples:")}`);
  console.log();
  console.log(`    ${dim("# Start a hub (auto-generates token)")}`);
  console.log(`    npx agent-bridge hub`);
  console.log();
  console.log(`    ${dim("# Join with the command printed by the hub")}`);
  console.log(`    npx agent-bridge join http://192.168.1.10:9900 --token abc123`);
  console.log();
}

main().catch((err) => {
  console.error(`\n  ${red("Error:")} ${err.message}`);
  process.exit(1);
});
