import type { Node } from "acorn";

export interface StackFrame {
  name: string;
  line: number;
  column: number;
  /**
   * The line in the caller where execution will resume after this
   * frame is popped. Null for the global frame (nowhere to return to).
   */
  returnLine: number | null;
}

/**
 * A reference to a heap-allocated object or array.
 * Used in scope bindings instead of inline object values.
 */
export interface HeapRef {
  __heapRef: number;
}

/** A heap-allocated value: object, array, or function. */
export type HeapEntry =
  | { type: "object"; properties: Record<string, unknown> }
  | { type: "array"; elements: unknown[] }
  | { type: "function"; name: string; params: string[] };

export interface ScopeSnapshot {
  /** Name of this scope: "(global)", a function name, or "(block)". */
  name: string;
  /**
   * Variable bindings in this scope at the time of the snapshot.
   * Primitive values are stored directly. Objects and arrays are
   * replaced with HeapRef values — look up the actual data in
   * TraceStep.heap using the ref ID.
   */
  bindings: Record<string, unknown>;
}

/**
 * A single execution context: a call stack frame paired with its
 * local variable bindings. The bindings are collected from the
 * function's own scope and any block scopes within it (e.g., if/else bodies).
 */
export interface ExecutionContext {
  /** The call stack frame (function name, line, column). */
  frame: StackFrame;
  /** Variable bindings local to this execution context, innermost block scope first. */
  scopes: ScopeSnapshot[];
}

export interface TraceStep {
  /**
   * The execution context stack at this point in execution.
   * Index 0 is the bottom (global), last element is the currently active context.
   * Each context carries its own local variable bindings.
   */
  contexts: ExecutionContext[];
  /**
   * The heap at this point in execution. Maps numeric IDs to heap entries.
   * Objects and arrays in scope bindings are replaced with HeapRef values
   * that point into this map.
   */
  heap: Record<number, HeapEntry>;
  /** The AST node currently being evaluated (carries .loc for line highlighting). */
  currentNode: Node | null;
  /** Accumulated console.log output up to this point. */
  output: string[];
  /** Error message if this step caused an error. */
  error: string | null;
}

export interface Trace {
  /** The full sequence of execution steps. */
  steps: TraceStep[];
  /** The original source code. */
  code: string;
  /** Top-level error (parse error or step-limit exceeded). Null if execution completed normally. */
  error: string | null;
}
