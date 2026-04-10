import { createSignal, Show } from "solid-js";
import type { Component } from "solid-js";
import type { ExecutionContext, HeapEntry } from "engine";
import { collectBindings, collectInheritedBindings } from "../utils.ts";
import { BindingsList, InheritedBindings } from "./Bindings.tsx";

interface ContextFrameProps {
  ctx: ExecutionContext;
  /** The original index in the contexts array (0 = global). */
  originalIndex: number;
  /** Whether this is the top-of-stack (active) frame. */
  isActive: boolean;
  /** All contexts in the current step (for inherited binding lookup). */
  allContexts: ExecutionContext[];
  /** The heap at this step. */
  heap: Record<number, HeapEntry>;
}

const ContextFrame: Component<ContextFrameProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal(!props.isActive);

  const localBindings = () => collectBindings(props.ctx, props.heap);

  const inheritedBindings = () =>
    collectInheritedBindings(props.allContexts, props.originalIndex, localBindings(), props.heap);

  const hasAny = () => localBindings().length > 0 || inheritedBindings().length > 0;

  return (
    <div class={`ctx-frame ${props.isActive ? "active" : ""} ${collapsed() ? "collapsed" : ""}`}>
      <div class="ctx-header" onClick={() => setCollapsed((c) => !c)}>
        <span class="ctx-header-label">
          {props.ctx.frame.name} <span class="frame-location">line {props.ctx.frame.line}</span>
        </span>
        <span class="ctx-header-right">
          <Show when={props.ctx.frame.returnLine !== null}>
            <span class="frame-return">returns to line {props.ctx.frame.returnLine}</span>
          </Show>
          <span class="ctx-chevron" />
        </span>
      </div>
      <div class="ctx-body">
        <Show when={hasAny()} fallback={<div class="ctx-empty">No variables</div>}>
          <BindingsList bindings={localBindings()} dimmed={false} />
          <InheritedBindings groups={inheritedBindings()} />
        </Show>
      </div>
    </div>
  );
};

export default ContextFrame;
