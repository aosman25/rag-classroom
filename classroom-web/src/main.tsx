import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import StudentView from "./views/StudentView";
import AdminView from "./views/AdminView";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<StudentView />} />
          <Route path="admin" element={<AdminView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
