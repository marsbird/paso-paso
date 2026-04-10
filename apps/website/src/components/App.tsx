import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import { createTrace } from "engine";
import type { Trace } from "engine";
import EditorPanel from "./EditorPanel.tsx";
import VisualizationPanel from "./VisualizationPanel.tsx";

const EXAMPLE_CODE = ``;

const App: Component = () => {
  const [code, setCode] = createSignal(EXAMPLE_CODE);
  const [trace, setTrace] = createSignal<Trace | null>(null);
  const [stepIndex, setStepIndex] = createSignal(-1);
  const [traceError, setTraceError] = createSignal<string | null>(null);
  const [readOnly, setReadOnly] = createSignal(false);

  // Derived state
  const currentStep = () => {
    const t = trace();
    const idx = stepIndex();
    if (!t || idx < 0 || idx >= t.steps.length) return null;
    return t.steps[idx];
  };

  const total = () => trace()?.steps.length ?? 0;
  const isFirst = () => stepIndex() <= 0;
  const isLast = () => stepIndex() >= total() - 1;

  const runDisabled = () => readOnly();
  const backDisabled = () => !trace() || total() === 0 || isFirst();
  const stepDisabled = () => !trace() || total() === 0 || isLast();
  const runAllDisabled = () => !trace() || total() === 0 || isLast();
  const resetDisabled = () => !trace();
  const stepLabel = () => (trace() && isLast() ? "Done" : "Step");
  const stepCounter = () => {
    if (!trace() || total() === 0 || stepIndex() < 0) return "";
    return `Step ${stepIndex() + 1} of ${total()}`;
  };

  // Derive the highlighted line from the current step
  const highlightLine = (): number | null => {
    const step = currentStep();
    return step?.currentNode?.loc?.start.line ?? null;
  };

  // --- Actions ---
  function handleRun(): void {
    const src = code().trim();
    if (!src) return;

    const result = createTrace(src);

    if (result.error && result.steps.length === 0) {
      setTraceError(result.error);
      return;
    }

    setTraceError(result.error);
    setTrace(result);
    setReadOnly(true);
    setStepIndex(0);
  }

  function handleBack(): void {
    if (!trace() || stepIndex() <= 0) return;
    setStepIndex((i) => i - 1);
  }

  function handleStep(): void {
    if (!trace() || stepIndex() >= total() - 1) return;
    setStepIndex((i) => i + 1);
  }

  function handleRunAll(): void {
    if (!trace()) return;
    setStepIndex(total() - 1);
  }

  function handleReset(): void {
    setTrace(null);
    setStepIndex(-1);
    setTraceError(null);
    setReadOnly(false);
  }

  return (
    <>
      <header>
        <h1>Paso Paso</h1>
        <p class="subtitle">Paste a JavaScript snippet and step through its execution</p>
      </header>
      <main>
        <EditorPanel
          code={code()}
          onCodeChange={setCode}
          readOnly={readOnly()}
          highlightLine={highlightLine()}
          onRun={handleRun}
          onBack={handleBack}
          onStep={handleStep}
          onRunAll={handleRunAll}
          onReset={handleReset}
          runDisabled={runDisabled()}
          backDisabled={backDisabled()}
          stepDisabled={stepDisabled()}
          runAllDisabled={runAllDisabled()}
          resetDisabled={resetDisabled()}
          stepLabel={stepLabel()}
        />
        <VisualizationPanel
          step={currentStep()}
          stepCounter={stepCounter()}
          traceError={traceError()}
        />
      </main>
    </>
  );
};

export default App;
