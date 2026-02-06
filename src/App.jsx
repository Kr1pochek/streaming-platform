import { Routes, Route } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import HomePage from "./pages/HomePage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<HomePage />} />
        <Route path="library" element={<HomePage />} />
        <Route path="liked" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
