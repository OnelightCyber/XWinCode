import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { resolveLanguage, setLanguage } from "./i18n";
import { setupMonaco } from "./lib/monaco";
import "./styles.css";

setLanguage(resolveLanguage("system"));
setupMonaco();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
