import type { Component } from "solid-js";
import { Show } from "solid-js";

interface ErrorDisplayProps {
  error: string | null | undefined;
}

const ErrorDisplay: Component<ErrorDisplayProps> = (props) => {
  return (
    <Show when={props.error}>
      <div class="error-display">{props.error}</div>
    </Show>
  );
};

export default ErrorDisplay;
