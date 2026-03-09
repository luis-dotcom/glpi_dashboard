import "./dashboard.css";
import "./login.css";

import { mountDashboardApp } from "./dashboardApp";
import { mountLoginApp } from "./loginApp";

const page = document.body.getAttribute("data-page") || "";

if (page === "login") {
  mountLoginApp();
} else {
  mountDashboardApp();
}
