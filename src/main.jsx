import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles-v011.css";
import "./gentle.css";
if (window.location.hash === "#floating" || window.location.hash.startsWith("#guest:"))
  document.documentElement.classList.add("is-floating");

if (["#workmini","#worknote","#petcontrols","#clientsetup"].includes(window.location.hash)) document.documentElement.classList.add("is-work-satellite");
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
