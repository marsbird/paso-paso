import type { Component } from "solid-js";

interface ControlBarProps {
  onRun: () => void;
  onBack: () => void;
  onStep: () => void;
  onRunAll: () => void;
  onReset: () => void;
  runDisabled: boolean;
  backDisabled: boolean;
  stepDisabled: boolean;
  runAllDisabled: boolean;
  resetDisabled: boolean;
  stepLabel: string;
}

const ControlBar: Component<ControlBarProps> = (props) => {
  return (
    <div class="controls">
      <button id="btn-run" type="button" disabled={props.runDisabled} onClick={props.onRun}>
        Run
      </button>
      <button type="button" disabled={props.backDisabled} onClick={props.onBack}>
        Back
      </button>
      <button type="button" disabled={props.stepDisabled} onClick={props.onStep}>
        {props.stepLabel}
      </button>
      <button type="button" disabled={props.runAllDisabled} onClick={props.onRunAll}>
        Run All
      </button>
      <button type="button" disabled={props.resetDisabled} onClick={props.onReset}>
        Reset
      </button>
    </div>
  );
};

export default ControlBar;
