import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Platform } from "./platform";
import { onDemoPage } from "./api";
import "./styles.css";
import "./platform.css";
createRoot(document.getElementById("root")!).render(
  /^\/administracion\/?$/.test(location.pathname) ? (
    <Platform />
  ) : (
    <App demo={onDemoPage()} />
  ),
);
