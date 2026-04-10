import { For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { TraceStep } from "engine";
import ContextFrame from "./ContextFrame.tsx";

interface ExecutionContextListProps {
  step: TraceStep | null;
}

const ExecutionContextList: Component<ExecutionContextListProps> = (props) => {
  const reversedContexts = () => {
    const step = props.step;
    if (!step) return [];
    return step.contexts.slice().reverse();
  };

  return (
    <div class="contexts">
      <Show
        when={props.step && props.step.contexts.length > 0}
        fallback={
          <div class="placeholder">
            {props.step ? (
              "Empty"
            ) : (
              <>
                Press <strong>Run</strong> then <strong>Step</strong> to begin
              </>
            )}
          </div>
        }
      >
        <For each={reversedContexts()}>
          {(ctx, reversedIndex) => {
            const originalIndex = () => (props.step?.contexts.length ?? 0) - 1 - reversedIndex();
            return (
              <ContextFrame
                ctx={ctx}
                originalIndex={originalIndex()}
                isActive={reversedIndex() === 0}
                allContexts={props.step!.contexts}
                heap={props.step!.heap}
              />
            );
          }}
        </For>
      </Show>
    </div>
  );
};

export default ExecutionContextList;
