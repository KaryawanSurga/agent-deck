#!/usr/bin/env node
import { main, type CliIo } from "./cli.js";

const argv = process.argv.slice(2);
const color = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const withNewline = (write: (text: string) => void) => (text: string) => {
  write(text.endsWith("\n") ? text : `${text}\n`);
};

const io: CliIo = {
  stdout: withNewline((text) => process.stdout.write(text)),
  stderr: withNewline((text) => process.stderr.write(text)),
  color,
};

main(argv, io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`agent-deck: fatal: ${message}\n`);
    process.exitCode = 1;
  });
