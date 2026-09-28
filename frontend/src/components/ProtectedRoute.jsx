import { Navigate } from "react-router-dom";
import { clearSession, hasSession } from "../services/auth.js";

export default function ProtectedRoute({ children }) {
  if (hasSession()) return children;
  clearSession();
  return <Navigate to="/admin/login" replace />;
}
