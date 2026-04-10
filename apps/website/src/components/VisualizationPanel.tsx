import { Show } from "solid-js";
import type { Component } from "solid-js";
import type { TraceStep } from "engine";
import ExecutionContextList from "./ExecutionContextList.tsx";
import HeapView from "./HeapView.tsx";
import OutputView from "./OutputView.tsx";
import ErrorDisplay from "./ErrorDisplay.tsx";

interface VisualizationPanelProps {
  step: TraceStep | null;
  stepCounter: string;
  traceError: string | null;
}

const VisualizationPanel: Component<VisualizationPanelProps> = (props) => {
  return (
    <section class="viz-panel">
      <div class="panel-header">
        <h2>Execution Context</h2>
        <span class="step-counter">{props.stepCounter}</span>
      </div>
      <ExecutionContextList step={props.step} />

      <div class="panel-header">
        <h2>Heap</h2>
      </div>
      <Show
        when={props.step}
        fallback={
          <div class="heap">
            <div class="placeholder">No heap objects</div>
          </div>
        }
      >
        {(step) => <HeapView heap={step().heap} />}
      </Show>

      <div class="panel-header">
        <h2>Output</h2>
      </div>
      <Show when={props.step} fallback={<pre class="output" />}>
        {(step) => <OutputView output={step().output} />}
      </Show>

      <ErrorDisplay error={props.step?.error ?? props.traceError} />
    </section>
  );
};

export default VisualizationPanel;
