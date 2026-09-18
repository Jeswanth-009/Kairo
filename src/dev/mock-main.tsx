/**
 * Dev-only entry (mock.html): installs the Tauri IPC mock before the app
 * boots, then renders the same App tree. Run with `npm run dev` and open
 * /mock.html — backend calls resolve to fixtures from ./fixtures.ts.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "../app/App";
import "../styles/global.css";
import { installMockIpc } from "./mockIpc";

installMockIpc();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
