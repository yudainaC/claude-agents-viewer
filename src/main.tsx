import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// Dans l'appli de bureau (Electron), on adapte la barre du haut
if (navigator.userAgent.includes("Electron")) {
  document.documentElement.classList.add("desktop");
  if (navigator.platform.toLowerCase().includes("mac")) document.documentElement.classList.add("mac");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
