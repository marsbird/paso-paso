import type { Component } from "solid-js";

interface OutputViewProps {
  output: string[];
}

const OutputView: Component<OutputViewProps> = (props) => {
  return <pre class="output">{props.output.join("\n")}</pre>;
};

export default OutputView;
