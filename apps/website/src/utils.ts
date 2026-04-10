import type { ExecutionContext, HeapEntry, HeapRef } from "engine";

// --- Heap helpers ---

export function isHeapRef(val: unknown): val is HeapRef {
  return typeof val === "object" && val !== null && "__heapRef" in val;
}

export function formatValue(val: unknown): string {
  if (val === undefined) return "undefined";
  if (val === null) return "null";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (isHeapRef(val)) return `\u2192 #${val.__heapRef}`;
  if (Array.isArray(val)) return `[${val.map(formatValue).join(", ")}]`;
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(", ")} }`;
  }
  return JSON.stringify(val);
}

export function formatHeapValue(val: unknown, heap: Record<number, HeapEntry>): string {
  if (isHeapRef(val)) {
    const entry = heap[val.__heapRef];
    if (entry) return `\u2192 #${val.__heapRef}`;
    return `\u2192 #${val.__heapRef}`;
  }
  return formatValue(val);
}

// --- Binding helpers ---

export interface BindingEntry {
  key: string;
  val: unknown;
  isFunction: boolean;
  /** True if this value is a heap reference (object or array). */
  isRef: boolean;
  /** Heap ID if isRef is true. */
  heapId: number | null;
}

export interface InheritedGroup {
  source: string;
  bindings: BindingEntry[];
}

/** Filter out the console builtin -- the only thing we truly hide. */
function shouldHide(key: string, val: unknown): boolean {
  if (key === "console") return true;
  if (typeof val === "string" && val.startsWith("[Builtin:")) return true;
  return false;
}

/** Collect bindings from a context's scopes. */
export function collectBindings(
  ctx: ExecutionContext,
  heap: Record<number, HeapEntry>,
): BindingEntry[] {
  return ctx.scopes.flatMap((scope) =>
    Object.entries(scope.bindings)
      .filter(([key, val]) => !shouldHide(key, val))
      .map(([key, val]) => {
        const ref = isHeapRef(val);
        const heapEntry = ref ? heap[val.__heapRef] : null;
        const isFn = heapEntry?.type === "function";
        return {
          key,
          val,
          isFunction: isFn,
          isRef: ref && !isFn,
          heapId: ref ? val.__heapRef : null,
        };
      }),
  );
}

/**
 * Collect bindings inherited from contexts below the given index.
 * Excludes any names already declared locally (shadowed).
 */
export function collectInheritedBindings(
  contexts: ExecutionContext[],
  currentIndex: number,
  localBindings: BindingEntry[],
  heap: Record<number, HeapEntry>,
): InheritedGroup[] {
  const localNames = new Set(localBindings.map((b) => b.key));
  const groups: InheritedGroup[] = [];

  for (let i = currentIndex - 1; i >= 0; i--) {
    const parentCtx = contexts[i];
    const bindings = collectBindings(parentCtx, heap).filter((b) => !localNames.has(b.key));
    if (bindings.length > 0) {
      groups.push({ source: parentCtx.frame.name, bindings });
      for (const b of bindings) localNames.add(b.key);
    }
  }

  return groups;
}
