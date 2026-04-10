import { For } from "solid-js";
import type { Component } from "solid-js";
import type { BindingEntry, InheritedGroup } from "../utils.ts";
import { formatValue, isHeapRef } from "../utils.ts";

function bindingTag(b: BindingEntry) {
  if (b.isFunction) return <span class="binding-tag fn">f</span>;
  if (b.isRef) return <span class="binding-tag ref">ref</span>;
  return null;
}

function renderBindingValue(b: BindingEntry) {
  if (b.heapId !== null) return <span class="binding-ref">&rarr; #{b.heapId}</span>;
  return <>{isHeapRef(b.val) ? `\u2192 #${b.val.__heapRef}` : formatValue(b.val)}</>;
}

interface BindingsListProps {
  bindings: BindingEntry[];
  dimmed: boolean;
}

export const BindingsList: Component<BindingsListProps> = (props) => {
  return (
    <For each={props.bindings}>
      {(b) => (
        <div class={`ctx-binding ${props.dimmed ? "inherited" : ""}`}>
          <span class="binding-name">
            {bindingTag(b)} {b.key}
          </span>
          <span class="binding-value">{renderBindingValue(b)}</span>
        </div>
      )}
    </For>
  );
};

interface InheritedBindingsProps {
  groups: InheritedGroup[];
}

export const InheritedBindings: Component<InheritedBindingsProps> = (props) => {
  return (
    <For each={props.groups}>
      {(group) => (
        <>
          <div class="ctx-inherited-label">
            from <strong>{group.source}</strong>
          </div>
          <BindingsList bindings={group.bindings} dimmed={true} />
        </>
      )}
    </For>
  );
};
