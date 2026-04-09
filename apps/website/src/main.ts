import "./style.css";
import { createTrace } from "engine";
import type { ExecutionContext, HeapEntry, HeapRef, Trace, TraceStep } from "engine";

// --- Default example code ---
const EXAMPLE_CODE = `
  const myDog = {name: 'Chico', age: 5};
  let myString = 'original';
  
  function update(dog, string) {
   dog.age++;
   string = 'updated!';
  }
  
  update(myDog, myString);
  console.log(myDog); // ???
  console.log(myString); // ???  
  
function add(a, b) {
  return a + b;
}

function multiply(x, y) {
  return x * y;
}

function square(c) {
  return multiply(c, c);
}

function sumNumsBelow(n, sum = 0) {
  if (n === 0) {
    return sum;
  }
  return sumNumsBelow(n - 1, sum + n);
}

sumNumsBelow(5);
const sum = add(2, 3);
const squared = square(sum);
const result = multiply(squared, 4);
console.log(result);`;

// --- State ---
let trace: Trace | null = null;
let stepIndex = -1;

// --- DOM setup ---
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header>
    <h1>Paso Paso</h1>
    <p class="subtitle">Paste a JavaScript snippet and step through its execution</p>
  </header>
  <main>
    <section class="editor-panel">
      <div class="panel-header">
        <h2>Code</h2>
      </div>
      <textarea id="code-input" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off">${EXAMPLE_CODE}</textarea>
      <div class="controls">
        <button id="btn-run" type="button">Run</button>
        <button id="btn-back" type="button" disabled>Back</button>
        <button id="btn-step" type="button" disabled>Step</button>
        <button id="btn-run-all" type="button" disabled>Run All</button>
        <button id="btn-reset" type="button" disabled>Reset</button>
      </div>
    </section>
    <section class="viz-panel">
      <div class="panel-header">
        <h2>Execution Context</h2>
        <span id="step-counter" class="step-counter"></span>
      </div>
      <div id="contexts" class="contexts">
        <div class="placeholder">Press <strong>Run</strong> then <strong>Step</strong> to begin</div>
      </div>
      <div class="panel-header">
        <h2>Heap</h2>
      </div>
      <div id="heap" class="heap">
        <div class="placeholder">No heap objects</div>
      </div>
      <div class="panel-header">
        <h2>Output</h2>
      </div>
      <pre id="output" class="output"></pre>
      <div id="error-display" class="error-display" hidden></div>
    </section>
  </main>
`;

// --- Element refs ---
const codeInput = document.querySelector<HTMLTextAreaElement>("#code-input")!;
const btnRun = document.querySelector<HTMLButtonElement>("#btn-run")!;
const btnBack = document.querySelector<HTMLButtonElement>("#btn-back")!;
const btnStep = document.querySelector<HTMLButtonElement>("#btn-step")!;
const btnRunAll = document.querySelector<HTMLButtonElement>("#btn-run-all")!;
const btnReset = document.querySelector<HTMLButtonElement>("#btn-reset")!;
const contextsEl = document.querySelector<HTMLDivElement>("#contexts")!;
const heapEl = document.querySelector<HTMLDivElement>("#heap")!;
const outputEl = document.querySelector<HTMLPreElement>("#output")!;
const errorEl = document.querySelector<HTMLDivElement>("#error-display")!;
const stepCounterEl = document.querySelector<HTMLSpanElement>("#step-counter")!;

// --- Rendering ---
function renderStep(step: TraceStep): void {
  // Execution contexts — rendered top-of-stack first (active frame at top)
  if (step.contexts.length === 0) {
    contextsEl.innerHTML = `<div class="placeholder">Empty</div>`;
  } else {
    contextsEl.innerHTML = step.contexts
      .slice()
      .reverse()
      .map((ctx, reversedIndex) => {
        // reversedIndex 0 = top of stack (active), last = global
        const isActive = reversedIndex === 0;
        // Original index in the contexts array (0 = global)
        const originalIndex = step.contexts.length - 1 - reversedIndex;
        const frameLabel = `${escapeHtml(ctx.frame.name)} <span class="frame-location">line ${ctx.frame.line}</span>`;
        const returnInfo =
          ctx.frame.returnLine !== null
            ? `<span class="frame-return">returns to line ${ctx.frame.returnLine}</span>`
            : "";

        // Collect local bindings (from this context's own scopes)
        const localBindings = collectBindings(ctx, step.heap);

        // Collect inherited bindings from all contexts below this one
        const inheritedBindings = collectInheritedBindings(
          step.contexts,
          originalIndex,
          localBindings,
          step.heap,
        );

        const localHtml = renderBindings(localBindings, false);
        const inheritedHtml = renderInheritedBindings(inheritedBindings);

        const hasAny = localBindings.length > 0 || inheritedBindings.length > 0;
        const bodyHtml = hasAny
          ? localHtml + inheritedHtml
          : `<div class="ctx-empty">No variables</div>`;

        const collapsed = !isActive;
        return `<div class="ctx-frame ${isActive ? "active" : ""} ${collapsed ? "collapsed" : ""}" data-ctx-index="${reversedIndex}">
          <div class="ctx-header">
            <span class="ctx-header-label">${frameLabel}</span>
            <span class="ctx-header-right">${returnInfo}<span class="ctx-chevron"></span></span>
          </div>
          <div class="ctx-body">${bodyHtml}</div>
        </div>`;
      })
      .join("");

    // Attach toggle listeners
    contextsEl.querySelectorAll<HTMLDivElement>(".ctx-frame").forEach((el) => {
      el.querySelector(".ctx-header")!.addEventListener("click", () => {
        el.classList.toggle("collapsed");
      });
    });
  }

  // Heap
  renderHeap(step);

  // Highlight current line in textarea
  if (step.currentNode?.loc) {
    highlightLine(step.currentNode.loc.start.line);
  }

  // Output
  outputEl.textContent = step.output.join("\n");

  // Error on this step
  if (step.error) {
    errorEl.textContent = step.error;
    errorEl.hidden = false;
  } else {
    errorEl.hidden = true;
  }

  updateControls();
}

function updateControls(): void {
  if (!trace || trace.steps.length === 0) return;

  const total = trace.steps.length;
  const isFirst = stepIndex <= 0;
  const isLast = stepIndex >= total - 1;

  btnBack.disabled = isFirst;
  btnStep.disabled = isLast;
  btnRunAll.disabled = isLast;
  btnReset.disabled = false;

  btnStep.textContent = isLast ? "Done" : "Step";
  stepCounterEl.textContent = `Step ${stepIndex + 1} of ${total}`;
}

function highlightLine(lineNumber: number): void {
  const lines = codeInput.value.split("\n");
  let startPos = 0;
  for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) {
    startPos += lines[i].length + 1;
  }
  const endPos = startPos + (lines[lineNumber - 1]?.length ?? 0);

  codeInput.focus();
  codeInput.setSelectionRange(startPos, endPos);
}

// --- Heap helpers ---

function isHeapRef(val: unknown): val is HeapRef {
  return typeof val === "object" && val !== null && "__heapRef" in val;
}

function renderHeap(step: TraceStep): void {
  const entries = Object.entries(step.heap);
  if (entries.length === 0) {
    heapEl.innerHTML = `<div class="placeholder">No heap objects</div>`;
    return;
  }

  heapEl.innerHTML = entries
    .map(([idStr, entry]) => {
      const id = Number(idStr);
      const content = renderHeapEntry(entry, step.heap);
      return `<div class="heap-entry" id="heap-${id}">
        <span class="heap-id">#${id}</span>
        <span class="heap-content">${content}</span>
      </div>`;
    })
    .join("");
}

function renderHeapEntry(entry: HeapEntry, heap: Record<number, HeapEntry>): string {
  if (entry.type === "function") {
    return `<span class="heap-fn">f ${escapeHtml(entry.name)}(${entry.params.map(escapeHtml).join(", ")})</span>`;
  }
  if (entry.type === "array") {
    const items = entry.elements.map((el) => escapeHtml(formatHeapValue(el, heap))).join(", ");
    return `[${items}]`;
  }
  const props = Object.entries(entry.properties)
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(formatHeapValue(v, heap))}`)
    .join(", ");
  return `{ ${props} }`;
}

function formatHeapValue(val: unknown, heap: Record<number, HeapEntry>): string {
  if (isHeapRef(val)) {
    const entry = heap[val.__heapRef];
    if (entry) return entry.type === "array" ? `→ #${val.__heapRef}` : `→ #${val.__heapRef}`;
    return `→ #${val.__heapRef}`;
  }
  return formatValue(val);
}

// --- Binding helpers ---

interface BindingEntry {
  key: string;
  val: unknown;
  isFunction: boolean;
  /** True if this value is a heap reference (object or array). */
  isRef: boolean;
  /** Heap ID if isRef is true. */
  heapId: number | null;
}

interface InheritedGroup {
  source: string;
  bindings: BindingEntry[];
}

/** Filter out the console builtin — the only thing we truly hide. */
function shouldHide(key: string, val: unknown): boolean {
  if (key === "console") return true;
  if (typeof val === "string" && val.startsWith("[Builtin:")) return true;
  return false;
}

/** Collect bindings from a context's scopes. */
function collectBindings(ctx: ExecutionContext, heap: Record<number, HeapEntry>): BindingEntry[] {
  return ctx.scopes.flatMap((scope) =>
    Object.entries(scope.bindings)
      .filter(([key, val]) => !shouldHide(key, val))
      .map(([key, val]) => {
        const ref = isHeapRef(val);
        const heapEntry = ref ? heap[val.__heapRef] : null;
        const isFunction = heapEntry?.type === "function";
        return {
          key,
          val,
          isFunction,
          isRef: ref && !isFunction,
          heapId: ref ? val.__heapRef : null,
        };
      }),
  );
}

/**
 * Collect bindings inherited from contexts below the given index.
 * Excludes any names already declared locally (shadowed).
 */
function collectInheritedBindings(
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

function bindingTag(b: BindingEntry): string {
  if (b.isFunction) return '<span class="binding-tag fn">f</span> ';
  if (b.isRef) return '<span class="binding-tag ref">ref</span> ';
  return "";
}

function renderBindingValue(b: BindingEntry): string {
  if (b.heapId !== null) return `<span class="binding-ref">→ #${b.heapId}</span>`;
  return escapeHtml(formatValue(b.val));
}

function renderBindings(bindings: BindingEntry[], dimmed: boolean): string {
  return bindings
    .map(
      (b) =>
        `<div class="ctx-binding ${dimmed ? "inherited" : ""}">
          <span class="binding-name">${bindingTag(b)}${escapeHtml(b.key)}</span>
          <span class="binding-value">${renderBindingValue(b)}</span>
        </div>`,
    )
    .join("");
}

function renderInheritedBindings(groups: InheritedGroup[]): string {
  if (groups.length === 0) return "";
  return groups
    .map(
      (group) =>
        `<div class="ctx-inherited-label">from <strong>${escapeHtml(group.source)}</strong></div>` +
        renderBindings(group.bindings, true),
    )
    .join("");
}

function formatValue(val: unknown): string {
  if (val === undefined) return "undefined";
  if (val === null) return "null";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (isHeapRef(val)) return `→ #${val.__heapRef}`;
  if (Array.isArray(val)) return `[${val.map(formatValue).join(", ")}]`;
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join(", ")} }`;
  }
  return JSON.stringify(val);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Actions ---
function handleRun(): void {
  const code = codeInput.value.trim();
  if (!code) return;

  trace = createTrace(code);

  if (trace.error && trace.steps.length === 0) {
    errorEl.textContent = trace.error;
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  btnRun.disabled = true;
  codeInput.readOnly = true;

  // Show trace-level error if execution hit a limit
  if (trace.error) {
    errorEl.textContent = trace.error;
    errorEl.hidden = false;
  }

  stepIndex = 0;
  renderStep(trace.steps[0]);
}

function handleBack(): void {
  if (!trace || stepIndex <= 0) return;
  stepIndex--;
  renderStep(trace.steps[stepIndex]);
}

function handleStep(): void {
  if (!trace || stepIndex >= trace.steps.length - 1) return;
  stepIndex++;
  renderStep(trace.steps[stepIndex]);
}

function handleRunAll(): void {
  if (!trace) return;
  stepIndex = trace.steps.length - 1;
  renderStep(trace.steps[stepIndex]);
}

function handleReset(): void {
  trace = null;
  stepIndex = -1;
  btnRun.disabled = false;
  btnBack.disabled = true;
  btnStep.disabled = true;
  btnStep.textContent = "Step";
  btnRunAll.disabled = true;
  btnReset.disabled = true;
  codeInput.readOnly = false;
  contextsEl.innerHTML = `<div class="placeholder">Press <strong>Run</strong> then <strong>Step</strong> to begin</div>`;
  heapEl.innerHTML = `<div class="placeholder">No heap objects</div>`;
  outputEl.textContent = "";
  errorEl.hidden = true;
  stepCounterEl.textContent = "";
}

// --- Event listeners ---
btnRun.addEventListener("click", handleRun);
btnBack.addEventListener("click", handleBack);
btnStep.addEventListener("click", handleStep);
btnRunAll.addEventListener("click", handleRunAll);
btnReset.addEventListener("click", handleReset);
