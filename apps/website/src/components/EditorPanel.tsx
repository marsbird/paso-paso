import type { Component } from "solid-js";
import ControlBar from "./ControlBar.tsx";
import CodeEditor from "./CodeEditor.tsx";
import type { CodeEditorAPI } from "./CodeEditor.tsx";

interface EditorPanelProps {
  code: string;
  onCodeChange: (code: string) => void;
  readOnly: boolean;
  highlightLine: number | null;
  editorRef?: (api: CodeEditorAPI) => void;
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

const EditorPanel: Component<EditorPanelProps> = (props) => {
  return (
    <section class="editor-panel">
      <div class="panel-header">
        <h2>Code</h2>
      </div>
      <CodeEditor
        code={props.code}
        onCodeChange={props.onCodeChange}
        readOnly={props.readOnly}
        highlightLine={props.highlightLine}
        editorRef={props.editorRef}
      />
      <ControlBar
        onRun={props.onRun}
        onBack={props.onBack}
        onStep={props.onStep}
        onRunAll={props.onRunAll}
        onReset={props.onReset}
        runDisabled={props.runDisabled}
        backDisabled={props.backDisabled}
        stepDisabled={props.stepDisabled}
        runAllDisabled={props.runAllDisabled}
        resetDisabled={props.resetDisabled}
        stepLabel={props.stepLabel}
      />
    </section>
  );
};

export default EditorPanel;
