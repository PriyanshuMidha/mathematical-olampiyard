import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import PublicLayout from "./components/PublicLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import ScrollManager from "./components/ScrollManager.jsx";
import Home from "./pages/public/Home.jsx";
import NewsList from "./pages/public/NewsList.jsx";
import NewsDetail from "./pages/public/NewsDetail.jsx";
import Results from "./pages/public/Results.jsx";
import Resources from "./pages/public/Resources.jsx";
import { About, Contact } from "./pages/public/StaticPages.jsx";
import Profile from "./pages/public/Profile.jsx";

// Admin screens are loaded on demand, so public visitors never download the CMS code.
const AdminLayout = lazy(() => import("./components/AdminLayout.jsx"));
const AdminLogin = lazy(() => import("./pages/admin/AdminLogin.jsx"));
const Dashboard = lazy(() => import("./pages/admin/Dashboard.jsx"));
const NewsForm = lazy(() => import("./pages/admin/NewsForm.jsx"));
const ManageNews = lazy(() => import("./pages/admin/ManageNews.jsx"));
const adminPage = (name) => lazy(() => import("./pages/admin/SimpleAdminPages.jsx").then((m) => ({ default: m[name] })));
const CategoriesAdmin = adminPage("CategoriesAdmin");
const ResourcesAdmin = adminPage("ResourcesAdmin");
const ResultsAdmin = adminPage("ResultsAdmin");
const UsersAdmin = adminPage("UsersAdmin");
const AdminsPage = lazy(() => import("./pages/admin/AdminsPage.jsx"));
import "./styles/main.css";

// "Add news" and "Edit news" share one component; a key per item gives each a fresh form
// (otherwise switching from Edit to Add would keep the previous article's fields).
function NewsFormRoute() {
  const { id } = useParams();
  return <NewsForm key={id || "new"} />;
}

function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <Suspense fallback={<p className="empty">Loading...</p>}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/news" element={<NewsList />} />
          <Route path="/news/:slug" element={<NewsDetail />} />
          <Route path="/results" element={<Results />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}
        >
          <Route index element={<Dashboard />} />
          <Route path="news" element={<ManageNews />} />
          <Route path="news/new" element={<NewsFormRoute />} />
          <Route path="news/:id/edit" element={<NewsFormRoute />} />
          <Route path="results" element={<ResultsAdmin />} />
          <Route path="resources" element={<ResourcesAdmin />} />
          <Route path="users" element={<UsersAdmin />} />
          <Route path="subscribers" element={<Navigate to="/admin/users" replace />} />
          <Route path="categories" element={<CategoriesAdmin />} />
          <Route path="admins" element={<AdminsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
