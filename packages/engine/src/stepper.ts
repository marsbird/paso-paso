import { parse } from "acorn";
import { execute } from "./interpreter.ts";
import type { Trace } from "./types.ts";

/**
 * Parse and execute a JavaScript code snippet, returning the full
 * execution trace. The trace contains a snapshot of the interpreter
 * state at each step — call stack, current node, output, scope chain.
 *
 * The UI can index freely into `trace.steps` to navigate forward,
 * backward, or jump to any step.
 */
export function createTrace(code: string): Trace {
  try {
    const ast = parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    });

    const steps = execute(ast);

    return {
      steps,
      code,
      error: null,
    };
  } catch (err) {
    return {
      steps: [],
      code,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
