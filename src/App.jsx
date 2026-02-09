import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";

const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const SearchPage = lazy(() => import("./pages/SearchPage.jsx"));
const LibraryPage = lazy(() => import("./pages/LibraryPage.jsx"));
const LikedPage = lazy(() => import("./pages/LikedPage.jsx"));
const PlaylistPage = lazy(() => import("./pages/PlaylistPage.jsx"));
const TrackPage = lazy(() => import("./pages/TrackPage.jsx"));
const ArtistPage = lazy(() => import("./pages/ArtistPage.jsx"));
const ReleasePage = lazy(() => import("./pages/ReleasePage.jsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

function RouteFallback() {
  return (
    <div style={{ padding: "24px 0", color: "rgba(255, 255, 255, 0.72)", fontWeight: 700 }}>
      Загружаем страницу...
    </div>
  );
}

function withSuspense(element) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={withSuspense(<HomePage />)} />
        <Route path="search" element={withSuspense(<SearchPage />)} />
        <Route path="library" element={withSuspense(<LibraryPage />)} />
        <Route path="liked" element={withSuspense(<LikedPage />)} />
        <Route path="playlist/:playlistId" element={withSuspense(<PlaylistPage />)} />
        <Route path="track/:trackId" element={withSuspense(<TrackPage />)} />
        <Route path="artist/:artistId" element={withSuspense(<ArtistPage />)} />
        <Route path="release/:releaseId" element={withSuspense(<ReleasePage />)} />
        <Route path="profile" element={withSuspense(<ProfilePage />)} />
        <Route path="*" element={withSuspense(<NotFoundPage />)} />
      </Route>
    </Routes>
  );
}
