import { createEffect, onCleanup, onMount } from "solid-js";
import type { Component } from "solid-js";
import { EditorView, minimalSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  lineNumbers,
} from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface CodeEditorProps {
  code: string;
  onCodeChange: (code: string) => void;
  readOnly: boolean;
  highlightLine: number | null;
  editorRef?: (api: CodeEditorAPI) => void;
}

export interface CodeEditorAPI {
  getView: () => EditorView | undefined;
}

// --- Syntax highlight style matching the app's color scheme ---
// Light mode: --bg-panel is #f9fafb, --text-h is #111827, --accent is #6366f1
// Dark mode: --bg-panel is #1f2937, --text-h is #f3f4f6, --accent is #818cf8
const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#8b5cf6" },
  { tag: tags.controlKeyword, color: "#8b5cf6", fontWeight: "600" },
  { tag: tags.operatorKeyword, color: "#8b5cf6" },
  { tag: tags.definitionKeyword, color: "#8b5cf6" },
  { tag: tags.operator, color: "#6b7280" },
  { tag: tags.punctuation, color: "#6b7280" },
  { tag: tags.bracket, color: "#6b7280" },
  { tag: tags.separator, color: "#6b7280" },
  { tag: tags.string, color: "#059669" },
  { tag: tags.number, color: "#d97706" },
  { tag: tags.bool, color: "#d97706" },
  { tag: tags.null, color: "#d97706" },
  { tag: tags.comment, color: "#9ca3af", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#9ca3af", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#9ca3af", fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: "#6366f1" },
  { tag: tags.definition(tags.variableName), color: "#1e40af" },
  { tag: tags.variableName, color: "#111827" },
  { tag: tags.propertyName, color: "#0891b2" },
  { tag: tags.definition(tags.propertyName), color: "#0891b2" },
  { tag: tags.typeName, color: "#6366f1" },
]);

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#a78bfa" },
  { tag: tags.controlKeyword, color: "#a78bfa", fontWeight: "600" },
  { tag: tags.operatorKeyword, color: "#a78bfa" },
  { tag: tags.definitionKeyword, color: "#a78bfa" },
  { tag: tags.operator, color: "#9ca3af" },
  { tag: tags.punctuation, color: "#9ca3af" },
  { tag: tags.bracket, color: "#9ca3af" },
  { tag: tags.separator, color: "#9ca3af" },
  { tag: tags.string, color: "#34d399" },
  { tag: tags.number, color: "#fbbf24" },
  { tag: tags.bool, color: "#fbbf24" },
  { tag: tags.null, color: "#fbbf24" },
  { tag: tags.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: "#818cf8" },
  { tag: tags.definition(tags.variableName), color: "#93c5fd" },
  { tag: tags.variableName, color: "#f3f4f6" },
  { tag: tags.propertyName, color: "#22d3ee" },
  { tag: tags.definition(tags.propertyName), color: "#22d3ee" },
  { tag: tags.typeName, color: "#818cf8" },
]);

// --- Custom theme to match the app design ---
const appTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    minHeight: "300px",
    backgroundColor: "var(--bg-panel)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "14px 14px 14px 0",
    caretColor: "var(--text-h)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-panel)",
    borderRight: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: "12px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-h)",
  },
  ".cm-selectionBackground": {
    backgroundColor: "var(--accent-bg) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(99, 102, 241, 0.2) !important",
  },
  // Every line gets a transparent 3px left border so the layout never shifts
  ".cm-line": {
    borderLeft: "3px solid transparent",
    paddingLeft: "11px",
  },
  ".cm-highlighted-line": {
    backgroundColor: "var(--accent-bg)",
    borderLeftColor: "var(--accent)",
  },
});

// --- Line highlight decoration ---
const highlightLineDeco = Decoration.line({ class: "cm-highlighted-line" });

function createHighlightPlugin(getLine: () => number | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(_update: ViewUpdate) {
        this.decorations = this.buildDecorations(_update.view);
      }

      buildDecorations(view: EditorView): DecorationSet {
        const line = getLine();
        if (line === null || line < 1 || line > view.state.doc.lines) {
          return Decoration.none;
        }
        const docLine = view.state.doc.line(line);
        return Decoration.set([highlightLineDeco.range(docLine.from)]);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// Helper: build the read-only extension set
function readOnlyExtensions(ro: boolean): Extension {
  return ro ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : [];
}

// Detect dark mode for syntax highlighting
function isDarkMode(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  // eslint-disable-next-line no-unassigned-vars -- assigned by Solid's ref
  let containerEl: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let currentHighlightLine: number | null = null;

  // Compartments for dynamic reconfiguration
  const readOnlyCompartment = new Compartment();
  const highlightCompartment = new Compartment();

  function currentHighlightExt(): Extension {
    const style = isDarkMode() ? darkHighlightStyle : lightHighlightStyle;
    return syntaxHighlighting(style);
  }

  const api: CodeEditorAPI = {
    getView: () => view,
  };

  onMount(() => {
    if (!containerEl) return;

    view = new EditorView({
      state: EditorState.create({
        doc: props.code,
        extensions: [
          minimalSetup,
          lineNumbers(),
          javascript(),
          highlightCompartment.of(currentHighlightExt()),
          appTheme,
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          readOnlyCompartment.of(readOnlyExtensions(props.readOnly)),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              props.onCodeChange(update.state.doc.toString());
            }
          }),
          createHighlightPlugin(() => currentHighlightLine),
        ],
      }),
      parent: containerEl,
    });

    // Listen for color scheme changes and swap highlight style
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => {
      if (!view) return;
      view.dispatch({
        effects: highlightCompartment.reconfigure(currentHighlightExt()),
      });
    };
    mediaQuery.addEventListener("change", onSchemeChange);

    props.editorRef?.(api);
  });

  onCleanup(() => {
    view?.destroy();
  });

  // Sync readOnly state via compartment reconfiguration
  createEffect(() => {
    const ro = props.readOnly;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(readOnlyExtensions(ro)),
    });
  });

  // Sync highlight line
  createEffect(() => {
    currentHighlightLine = props.highlightLine;
    if (view) {
      view.dispatch({});
    }
  });

  // Sync external code changes (e.g. reset)
  createEffect(() => {
    const externalCode = props.code;
    if (!view) return;
    const currentCode = view.state.doc.toString();
    if (externalCode !== currentCode) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: externalCode },
      });
    }
  });

  return <div ref={containerEl} class="code-editor-container" />;
};

export default CodeEditor;
