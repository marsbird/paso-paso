import { For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { HeapEntry } from "engine";
import { formatHeapValue } from "../utils.ts";

interface HeapViewProps {
  heap: Record<number, HeapEntry>;
}

function renderHeapEntry(entry: HeapEntry, heap: Record<number, HeapEntry>) {
  if (entry.type === "function") {
    return (
      <span class="heap-fn">
        f {entry.name}({entry.params.join(", ")})
      </span>
    );
  }
  if (entry.type === "array") {
    const items = entry.elements.map((el) => formatHeapValue(el, heap)).join(", ");
    return <>[{items}]</>;
  }
  const props = Object.entries(entry.properties)
    .map(([k, v]) => `${k}: ${formatHeapValue(v, heap)}`)
    .join(", ");
  return (
    <>
      {"{ "}
      {props}
      {" }"}
    </>
  );
}

const HeapView: Component<HeapViewProps> = (props) => {
  const entries = () => Object.entries(props.heap);

  return (
    <div class="heap">
      <Show when={entries().length > 0} fallback={<div class="placeholder">No heap objects</div>}>
        <For each={entries()}>
          {([idStr, entry]) => {
            const id = Number(idStr);
            return (
              <div class="heap-entry" id={`heap-${id}`}>
                <span class="heap-id">#{id}</span>
                <span class="heap-content">{renderHeapEntry(entry, props.heap)}</span>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
};

export default HeapView;
