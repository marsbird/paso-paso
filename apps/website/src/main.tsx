import "./style.css";
import { render } from "solid-js/web";
import App from "./components/App.tsx";

render(() => <App />, document.querySelector<HTMLDivElement>("#app")!);
