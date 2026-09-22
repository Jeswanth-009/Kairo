import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

// Renderer-side crash containment (v4): uncaught errors and rejections are
// logged with full detail for the devtools console; the ErrorBoundary below
// keeps the window usable instead of collapsing to a white screen.
window.addEventListener("error", (event) => {
  console.error("Kairo uncaught error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Kairo unhandled rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
