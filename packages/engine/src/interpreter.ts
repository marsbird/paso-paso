import type { Node, Program } from "acorn";
import type {
  ExecutionContext,
  HeapEntry,
  HeapRef,
  ScopeSnapshot,
  StackFrame,
  TraceStep,
} from "./types.ts";

const MAX_STEPS = 10_000;
const RETURN_SIGNAL = Symbol("return");

// ---------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------

interface ReturnSignal {
  __signal: typeof RETURN_SIGNAL;
  value: unknown;
}

interface ParamDef {
  name: string;
  defaultNode: Node | null;
}

interface FunctionValue {
  __kind: "function";
  name: string;
  params: ParamDef[];
  body: Node;
  closure: Environment;
}

/**
 * Extract parameter definitions from acorn's param nodes.
 * Handles plain Identifiers and AssignmentPatterns (default values).
 */
function extractParams(params: any[]): ParamDef[] {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  return params.map((p) => {
    if (p.type === "AssignmentPattern") {
      return { name: p.left.name as string, defaultNode: p.right as Node };
    }
    return { name: p.name as string, defaultNode: null };
  });
}

interface Environment {
  name: string;
  bindings: Map<string, unknown>;
  parent: Environment | null;
}

// ---------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------

function createEnv(name: string, parent: Environment | null = null): Environment {
  return { name, bindings: new Map(), parent };
}

function envGet(env: Environment, name: string): unknown {
  if (env.bindings.has(name)) return env.bindings.get(name);
  if (env.parent) return envGet(env.parent, name);
  throw new Error(`ReferenceError: ${name} is not defined`);
}

function envSet(env: Environment, name: string, value: unknown): void {
  if (env.bindings.has(name)) {
    env.bindings.set(name, value);
    return;
  }
  if (env.parent) {
    envSet(env.parent, name, value);
    return;
  }
  throw new Error(`ReferenceError: ${name} is not defined`);
}

function envDeclare(env: Environment, name: string, value: unknown): void {
  env.bindings.set(name, value);
}

function isFunctionValue(v: unknown): v is FunctionValue {
  return typeof v === "object" && v !== null && (v as FunctionValue).__kind === "function";
}

function isReturn(v: unknown): v is ReturnSignal {
  return typeof v === "object" && v !== null && (v as ReturnSignal).__signal === RETURN_SIGNAL;
}

/**
 * Format a value for console.log output, matching real JS console behavior:
 * - strings are printed without quotes
 * - objects and arrays are JSON-formatted
 * - primitives use String()
 */
function formatConsoleArg(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "function")
    return `[Function: ${(val as { name?: string }).name || "anonymous"}]`;
  if (isFunctionValue(val)) return `[Function: ${val.name}]`;
  if (Array.isArray(val)) return formatArray(val);
  if (typeof val === "object") return formatObject(val as Record<string, unknown>);
  return JSON.stringify(val);
}

function formatObject(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj)
    .map(([k, v]) => `${k}: ${formatInspectValue(v)}`)
    .join(", ");
  return `{ ${entries} }`;
}

function formatArray(arr: unknown[]): string {
  return `[${arr.map(formatInspectValue).join(", ")}]`;
}

/** Format a value as it would appear inside an object/array (strings get quotes). */
function formatInspectValue(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) return formatArray(val);
  if (typeof val === "object") return formatObject(val as Record<string, unknown>);
  return JSON.stringify(val);
}

// ---------------------------------------------------------------
// Heap tracking and scope snapshot capture
// ---------------------------------------------------------------

/**
 * Tracks object identity across the entire trace execution.
 * Each unique object/array gets a stable numeric ID the first
 * time it's encountered, so multiple references to the same
 * object show the same ID.
 */
class HeapTracker {
  private objectIds = new WeakMap<object, number>();
  private nextId = 1;

  /** Get or assign a stable ID for a live object/array. */
  getId(obj: object): number {
    let id = this.objectIds.get(obj);
    if (id === undefined) {
      id = this.nextId++;
      this.objectIds.set(obj, id);
    }
    return id;
  }

  /**
   * Serialize a value for scope bindings.
   * - Primitives are returned as-is.
   * - Native builtins are returned as descriptor strings (not on heap).
   * - User-defined functions, objects, and arrays are replaced with
   *   a HeapRef and their data is recorded in the heapSnapshot.
   */
  serializeValue(
    v: unknown,
    heapSnapshot: Record<number, HeapEntry>,
    isBuiltinObj = false,
  ): unknown {
    if (v === null || v === undefined) return v;

    // Native JS functions (builtins like console.log) — not on the heap
    if (typeof v === "function") return `[Builtin: ${v.name || "anonymous"}]`;

    // User-defined functions — stored on the heap
    if (isFunctionValue(v)) {
      const id = this.getId(v);
      if (!(id in heapSnapshot)) {
        heapSnapshot[id] = {
          type: "function",
          name: v.name,
          params: v.params.map((p) => p.name),
        };
      }
      return { __heapRef: id } satisfies HeapRef;
    }

    if (Array.isArray(v)) {
      const id = this.getId(v);
      if (!(id in heapSnapshot)) {
        heapSnapshot[id] = { type: "array", elements: [] };
        (heapSnapshot[id] as { type: "array"; elements: unknown[] }).elements = v.map((el) =>
          this.serializeValue(el, heapSnapshot),
        );
      }
      return { __heapRef: id } satisfies HeapRef;
    }

    if (typeof v === "object") {
      // Skip builtin objects (like console) — don't put them on the heap
      if (isBuiltinObj) return `[Builtin: object]`;

      const id = this.getId(v);
      if (!(id in heapSnapshot)) {
        heapSnapshot[id] = { type: "object", properties: {} };
        const props: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
          props[key] = this.serializeValue(val, heapSnapshot);
        }
        (heapSnapshot[id] as { type: "object"; properties: Record<string, unknown> }).properties =
          props;
      }
      return { __heapRef: id } satisfies HeapRef;
    }

    return v;
  }
}

/** Keys for builtin objects that should not be placed on the heap. */
const BUILTIN_KEYS = new Set(["console"]);

function snapshotEnv(
  env: Environment,
  heap: HeapTracker,
  heapSnapshot: Record<number, HeapEntry>,
): ScopeSnapshot {
  const bindings: Record<string, unknown> = {};
  for (const [key, val] of env.bindings) {
    bindings[key] = heap.serializeValue(val, heapSnapshot, BUILTIN_KEYS.has(key));
  }
  return { name: env.name, bindings };
}

/**
 * Build the execution context stack by pairing each call stack frame
 * with its associated scopes (function scope + any block scopes within it).
 *
 * For each frame, we collect:
 * - The frame's own environment (from frameEnvs[i])
 * - Any block scopes between the current env and that frame env
 *   (only for the topmost frame, since block scopes are children of it)
 *
 * We do NOT walk the closure/parent chain beyond the frame's own env,
 * because for recursive calls the closure parent points to an outer scope
 * (e.g., global), not to the previous recursive frame. The UI handles
 * inherited variable display separately.
 */
function captureContexts(
  ctx: ExecContext,
  env: Environment,
  heapSnapshot: Record<number, HeapEntry>,
): ExecutionContext[] {
  const contexts: ExecutionContext[] = [];

  for (let i = ctx.frameEnvs.length - 1; i >= 0; i--) {
    const frameEnv = ctx.frameEnvs[i];

    if (i === ctx.frameEnvs.length - 1) {
      const scopes: ScopeSnapshot[] = [];
      let current: Environment | null = env;
      while (current) {
        scopes.push(snapshotEnv(current, ctx.heap, heapSnapshot));
        if (current === frameEnv) break;
        current = current.parent;
      }
      contexts.push({ frame: { ...ctx.callStack[i] }, scopes });
    } else {
      contexts.push({
        frame: { ...ctx.callStack[i] },
        scopes: [snapshotEnv(frameEnv, ctx.heap, heapSnapshot)],
      });
    }
  }

  contexts.reverse();
  return contexts;
}

// ---------------------------------------------------------------
// Trace execution context
// ---------------------------------------------------------------

interface ExecContext {
  callStack: StackFrame[];
  /** Parallel to callStack: the function-level environment for each frame. */
  frameEnvs: Environment[];
  /** Heap tracker for stable object identity across the trace. */
  heap: HeapTracker;
  output: string[];
  steps: TraceStep[];
  stepCount: number;
  globalEnv: Environment;
}

function recordStep(ctx: ExecContext, node: Node | null, env: Environment): void {
  if (ctx.stepCount >= MAX_STEPS) {
    throw new StepLimitError();
  }
  const heapSnapshot: Record<number, HeapEntry> = {};
  ctx.steps.push({
    contexts: captureContexts(ctx, env, heapSnapshot),
    heap: heapSnapshot,
    currentNode: node,
    output: [...ctx.output],
    error: null,
  });
  ctx.stepCount++;
}

class StepLimitError extends Error {
  constructor() {
    super(`Execution limit reached (${MAX_STEPS} steps). Possible infinite loop.`);
    this.name = "StepLimitError";
  }
}

// ---------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------

/**
 * Execute a parsed AST and return the full execution trace.
 */
export function execute(program: Program): TraceStep[] {
  const globalEnv = createEnv("(global)");

  // Setup builtins
  const ctx: ExecContext = {
    callStack: [{ name: "(global)", line: 1, column: 0, returnLine: null }],
    frameEnvs: [globalEnv],
    heap: new HeapTracker(),
    output: [],
    steps: [],
    stepCount: 0,
    globalEnv,
  };

  const consoleObj = {
    log: (...args: unknown[]) => {
      ctx.output.push(args.map((a) => formatConsoleArg(a)).join(" "));
    },
  };
  envDeclare(globalEnv, "console", consoleObj);

  for (const stmt of program.body) {
    execStatement(ctx, stmt, globalEnv);
  }

  return ctx.steps;
}

// ---------------------------------------------------------------
// Statement execution
// ---------------------------------------------------------------

function execStatement(ctx: ExecContext, node: Node, env: Environment): unknown {
  const n = node as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  switch (n.type) {
    case "EmptyStatement":
      return undefined;

    case "ExpressionStatement": {
      updateStackLine(ctx, node);
      const value = execExpression(ctx, n.expression, env);
      recordStep(ctx, node, env);
      return value;
    }

    case "VariableDeclaration": {
      for (const decl of n.declarations) {
        updateStackLine(ctx, decl);
        const value = decl.init ? execExpression(ctx, decl.init, env) : undefined;
        envDeclare(env, decl.id.name, value);
        recordStep(ctx, decl, env);
      }
      return undefined;
    }

    case "FunctionDeclaration": {
      updateStackLine(ctx, node);
      const fn: FunctionValue = {
        __kind: "function",
        name: n.id.name,
        params: extractParams(n.params),
        body: n.body,
        closure: env,
      };
      envDeclare(env, n.id.name, fn);
      recordStep(ctx, node, env);
      return undefined;
    }

    case "IfStatement": {
      updateStackLine(ctx, node);
      const test = execExpression(ctx, n.test, env);
      recordStep(ctx, node, env);
      if (test) {
        const result = execStatement(ctx, n.consequent, env);
        if (isReturn(result)) return result;
      } else if (n.alternate) {
        const result = execStatement(ctx, n.alternate, env);
        if (isReturn(result)) return result;
      }
      return undefined;
    }

    case "ReturnStatement": {
      updateStackLine(ctx, node);
      const value = n.argument ? execExpression(ctx, n.argument, env) : undefined;
      recordStep(ctx, node, env);
      return { __signal: RETURN_SIGNAL, value } satisfies ReturnSignal;
    }

    case "BlockStatement": {
      const blockEnv = createEnv("(block)", env);
      for (const stmt of n.body) {
        const result = execStatement(ctx, stmt, blockEnv);
        if (isReturn(result)) return result;
      }
      return undefined;
    }

    default:
      // Fallback: treat as expression
      updateStackLine(ctx, node);
      const val = evalSync(node, env);
      recordStep(ctx, node, env);
      return val;
  }
}

// ---------------------------------------------------------------
// Expression execution (may record steps for function calls)
// ---------------------------------------------------------------

/**
 * Evaluate an expression. Most expressions are evaluated synchronously
 * via evalSync, but function calls to user-defined functions record
 * trace steps for entry, body, and exit.
 */
function execExpression(ctx: ExecContext, node: Node, env: Environment): unknown {
  const n = node as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  if (n.type === "CallExpression") {
    return execCall(ctx, n, env);
  }

  // For non-call expressions, evaluate synchronously.
  // But if sub-expressions contain calls, we need to recurse.
  return evalSyncOrCall(ctx, node, env);
}

/**
 * Evaluate an expression that might contain nested calls.
 * For most expression types we can evaluate synchronously,
 * but CallExpressions need to go through execCall.
 */
function evalSyncOrCall(ctx: ExecContext, node: Node, env: Environment): unknown {
  const n = node as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  switch (n.type) {
    case "CallExpression":
      return execCall(ctx, n, env);

    case "BinaryExpression":
      return evalBinary(
        n.operator,
        evalSyncOrCall(ctx, n.left, env),
        evalSyncOrCall(ctx, n.right, env),
      );

    case "UnaryExpression":
      return evalUnary(n.operator, evalSyncOrCall(ctx, n.argument, env));

    case "AssignmentExpression": {
      const value = evalSyncOrCall(ctx, n.right, env);
      if (n.left.type === "Identifier") {
        envSet(env, n.left.name, value);
      }
      return value;
    }

    case "ConditionalExpression": {
      const test = evalSyncOrCall(ctx, n.test, env);
      return test ? evalSyncOrCall(ctx, n.consequent, env) : evalSyncOrCall(ctx, n.alternate, env);
    }

    case "LogicalExpression": {
      const left = evalSyncOrCall(ctx, n.left, env);
      if (n.operator === "&&") return left ? evalSyncOrCall(ctx, n.right, env) : left;
      if (n.operator === "||") return left ? left : evalSyncOrCall(ctx, n.right, env);
      if (n.operator === "??") return left != null ? left : evalSyncOrCall(ctx, n.right, env);
      return left;
    }

    default:
      // Leaf expressions that can't contain calls
      return evalSync(node, env);
  }
}

/**
 * Execute a function call, recording trace steps.
 */
function execCall(
  ctx: ExecContext,
  callExpr: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  env: Environment,
): unknown {
  const callee = evalCallTarget(callExpr.callee, env);

  // Evaluate arguments (which may themselves contain calls)
  const args = callExpr.arguments.map((a: Node) => evalSyncOrCall(ctx, a, env));

  // Built-in function: call directly, no trace steps for internals
  if (typeof callee === "function") {
    return callee(...args);
  }

  if (!isFunctionValue(callee)) {
    throw new Error(`TypeError: ${String(callee)} is not a function`);
  }

  // User-defined function: record entry, execute body, record exit
  const fnEnv = createEnv(callee.name, callee.closure);
  for (let i = 0; i < callee.params.length; i++) {
    const param = callee.params[i];
    const argVal = i < args.length ? args[i] : undefined;
    const value =
      argVal === undefined && param.defaultNode
        ? evalSyncOrCall(ctx, param.defaultNode, env)
        : argVal;
    envDeclare(fnEnv, param.name, value);
  }

  // Push call stack frame and its environment.
  // The returnLine is where the caller will resume — the call site line.
  ctx.callStack.push({
    name: callee.name,
    line: loc(callExpr),
    column: callExpr.start,
    returnLine: loc(callExpr),
  });
  ctx.frameEnvs.push(fnEnv);

  // Record the "entering function" step
  recordStep(ctx, callExpr, fnEnv);

  // Expression-bodied arrow functions
  if (callee.body.type !== "BlockStatement") {
    const result = evalSyncOrCall(ctx, callee.body, fnEnv);
    ctx.callStack.pop();
    ctx.frameEnvs.pop();
    return result;
  }

  // Block-bodied function: execute each statement
  const body = (callee.body as any).body as Node[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  let returnValue: unknown = undefined;

  for (const stmt of body) {
    const result = execStatement(ctx, stmt, fnEnv);
    if (isReturn(result)) {
      returnValue = result.value;
      break;
    }
  }

  // Pop call stack frame and its environment
  ctx.callStack.pop();
  ctx.frameEnvs.pop();

  return returnValue;
}

// ---------------------------------------------------------------
// Synchronous expression evaluator (no trace recording)
// Used for leaf expressions that cannot contain function calls.
// ---------------------------------------------------------------

function evalSync(node: Node, env: Environment): unknown {
  const n = node as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  switch (n.type) {
    case "Literal":
      return n.value;

    case "Identifier":
      return envGet(env, n.name);

    case "BinaryExpression":
      return evalBinary(n.operator, evalSync(n.left, env), evalSync(n.right, env));

    case "UnaryExpression":
      return evalUnary(n.operator, evalSync(n.argument, env));

    case "AssignmentExpression": {
      const value = evalSync(n.right, env);
      if (n.left.type === "Identifier") {
        envSet(env, n.left.name, value);
      }
      return value;
    }

    case "MemberExpression": {
      const obj = evalSync(n.object, env) as Record<string, unknown>;
      const prop = n.computed ? (evalSync(n.property, env) as string) : (n.property.name as string);
      const val = obj[prop];
      return typeof val === "function" ? val.bind(obj) : val;
    }

    case "TemplateLiteral": {
      let result = n.quasis[0].value.cooked as string;
      for (let i = 0; i < n.expressions.length; i++) {
        result += String(evalSync(n.expressions[i], env));
        result += n.quasis[i + 1].value.cooked as string;
      }
      return result;
    }

    case "ArrowFunctionExpression":
    case "FunctionExpression": {
      const fn: FunctionValue = {
        __kind: "function",
        name: n.id?.name ?? "(anonymous)",
        params: extractParams(n.params),
        body: n.body,
        closure: env,
      };
      return fn;
    }

    case "ConditionalExpression": {
      const test = evalSync(n.test, env);
      return test ? evalSync(n.consequent, env) : evalSync(n.alternate, env);
    }

    case "LogicalExpression": {
      const left = evalSync(n.left, env);
      if (n.operator === "&&") return left ? evalSync(n.right, env) : left;
      if (n.operator === "||") return left ? left : evalSync(n.right, env);
      if (n.operator === "??") return left != null ? left : evalSync(n.right, env);
      return left;
    }

    case "UpdateExpression": {
      if (n.argument.type === "Identifier") {
        const current = envGet(env, n.argument.name) as number;
        const updated = n.operator === "++" ? current + 1 : current - 1;
        envSet(env, n.argument.name, updated);
        return n.prefix ? updated : current;
      }
      if (n.argument.type === "MemberExpression") {
        const obj = evalSync(n.argument.object, env) as Record<string, unknown>;
        const prop = n.argument.computed
          ? (evalSync(n.argument.property, env) as string)
          : (n.argument.property.name as string);
        const current = obj[prop] as number;
        const updated = n.operator === "++" ? current + 1 : current - 1;
        obj[prop] = updated;
        return n.prefix ? updated : current;
      }
      throw new Error(`Unsupported update target: ${n.argument.type}`);
    }

    case "ArrayExpression":
      return n.elements.map((el: Node | null) => (el ? evalSync(el, env) : undefined));

    case "ObjectExpression": {
      const obj: Record<string, unknown> = {};
      for (const prop of n.properties) {
        const key = prop.key.name ?? prop.key.value;
        obj[key] = evalSync(prop.value, env);
      }
      return obj;
    }

    case "CallExpression": {
      // This path is reached when evalSync is called on a call expression
      // that doesn't go through evalSyncOrCall (shouldn't normally happen,
      // but kept as a safety fallback).
      const callee = evalCallTarget(n.callee, env);
      const args = n.arguments.map((a: Node) => evalSync(a, env));
      if (typeof callee === "function") return callee(...args);
      if (isFunctionValue(callee)) return callFunctionSync(callee, args);
      throw new Error(`TypeError: ${String(callee)} is not a function`);
    }

    default:
      throw new Error(`Unsupported expression: ${n.type}`);
  }
}

function evalCallTarget(
  node: Node,
  env: Environment,
): ((...args: unknown[]) => unknown) | FunctionValue {
  const n = node as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (n.type === "MemberExpression") {
    const obj = evalSync(n.object, env) as Record<string, unknown>;
    const prop = n.computed ? (evalSync(n.property, env) as string) : (n.property.name as string);
    const val = obj[prop];
    if (typeof val === "function") return val.bind(obj);
    return val as FunctionValue;
  }
  return evalSync(node, env) as FunctionValue;
}

/**
 * Synchronous function call without trace recording.
 * Only used as a fallback within evalSync.
 */
function callFunctionSync(fn: FunctionValue, args: unknown[]): unknown {
  const fnEnv = createEnv(fn.name, fn.closure);
  for (let i = 0; i < fn.params.length; i++) {
    const param = fn.params[i];
    const argVal = i < args.length ? args[i] : undefined;
    const value =
      argVal === undefined && param.defaultNode ? evalSync(param.defaultNode, fnEnv) : argVal;
    envDeclare(fnEnv, param.name, value);
  }

  if (fn.body.type !== "BlockStatement") {
    return evalSync(fn.body, fnEnv);
  }

  const body = (fn.body as any).body as Node[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const stmt of body) {
    const result = evalStatementSync(stmt, fnEnv);
    if (isReturn(result)) return result.value;
  }
  return undefined;
}

function evalStatementSync(node: Node, env: Environment): unknown {
  const n = node as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  switch (n.type) {
    case "EmptyStatement":
      return undefined;

    case "ExpressionStatement":
      return evalSync(n.expression, env);

    case "VariableDeclaration":
      for (const decl of n.declarations) {
        const value = decl.init ? evalSync(decl.init, env) : undefined;
        envDeclare(env, decl.id.name, value);
      }
      return undefined;

    case "FunctionDeclaration": {
      const fn: FunctionValue = {
        __kind: "function",
        name: n.id.name,
        params: extractParams(n.params),
        body: n.body,
        closure: env,
      };
      envDeclare(env, n.id.name, fn);
      return undefined;
    }

    case "ReturnStatement": {
      const value = n.argument ? evalSync(n.argument, env) : undefined;
      return { __signal: RETURN_SIGNAL, value } satisfies ReturnSignal;
    }

    case "IfStatement": {
      const test = evalSync(n.test, env);
      if (test) {
        const result = evalStatementSync(n.consequent, env);
        if (isReturn(result)) return result;
      } else if (n.alternate) {
        const result = evalStatementSync(n.alternate, env);
        if (isReturn(result)) return result;
      }
      return undefined;
    }

    case "BlockStatement": {
      const blockEnv = createEnv("(block)", env);
      for (const stmt of n.body) {
        const res = evalStatementSync(stmt, blockEnv);
        if (isReturn(res)) return res;
      }
      return undefined;
    }

    default:
      return evalSync(node, env);
  }
}

// ---------------------------------------------------------------
// Operator helpers
// ---------------------------------------------------------------

function evalBinary(op: string, left: unknown, right: unknown): unknown {
  const l = left as number;
  const r = right as number;
  switch (op) {
    case "+":
      return typeof left === "string" || typeof right === "string"
        ? String(left) + String(right)
        : l + r;
    case "-":
      return l - r;
    case "*":
      return l * r;
    case "/":
      return l / r;
    case "%":
      return l % r;
    case "**":
      return l ** r;
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      return left == right; // eslint-disable-line eqeqeq
    case "!=":
      return left != right; // eslint-disable-line eqeqeq
    case "<":
      return l < r;
    case ">":
      return l > r;
    case "<=":
      return l <= r;
    case ">=":
      return l >= r;
    default:
      throw new Error(`Unsupported operator: ${op}`);
  }
}

function evalUnary(op: string, arg: unknown): unknown {
  switch (op) {
    case "-":
      return -(arg as number);
    case "+":
      return +(arg as number);
    case "!":
      return !arg;
    case "typeof":
      return typeof arg;
    default:
      throw new Error(`Unsupported unary operator: ${op}`);
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function updateStackLine(ctx: ExecContext, node: Node): void {
  const top = ctx.callStack[ctx.callStack.length - 1];
  if (top) {
    top.line = loc(node);
    top.column = node.start;
  }
}

function loc(node: Node): number {
  if (node.loc) return node.loc.start.line;
  return 1;
}
