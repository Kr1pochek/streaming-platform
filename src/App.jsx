import { Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import RouteErrorBoundary from "./components/RouteErrorBoundary.jsx";
import { lazyWithRecovery } from "./utils/lazyWithRecovery.js";

const HomePage = lazyWithRecovery(() => import("./pages/HomePage.jsx"), "home");
const SearchPage = lazyWithRecovery(() => import("./pages/SearchPage.jsx"), "search");
const LibraryPage = lazyWithRecovery(() => import("./pages/LibraryPage.jsx"), "library");
const LikedPage = lazyWithRecovery(() => import("./pages/LikedPage.jsx"), "liked");
const PlaylistPage = lazyWithRecovery(() => import("./pages/PlaylistPage.jsx"), "playlist");
const TrackPage = lazyWithRecovery(() => import("./pages/TrackPage.jsx"), "track");
const ArtistPage = lazyWithRecovery(() => import("./pages/ArtistPage.jsx"), "artist");
const ReleasePage = lazyWithRecovery(() => import("./pages/ReleasePage.jsx"), "release");
const NewReleasesPage = lazyWithRecovery(() => import("./pages/NewReleasesPage.jsx"), "new-releases");
const ProfilePage = lazyWithRecovery(() => import("./pages/ProfilePage.jsx"), "profile");
const AdminPage = lazyWithRecovery(() => import("./pages/AdminPage.jsx"), "admin");
const NotFoundPage = lazyWithRecovery(() => import("./pages/NotFoundPage.jsx"), "not-found");

function RouteFallback() {
  return (
    <div style={{ padding: "24px 0", color: "rgba(255, 255, 255, 0.72)", fontWeight: 700 }}>
      Загружаем страницу...
    </div>
  );
}

function withSuspense(element) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteFallback />}>{element}</Suspense>
    </RouteErrorBoundary>
  );
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
        <Route path="releases" element={withSuspense(<NewReleasesPage />)} />
        <Route path="release/:releaseId" element={withSuspense(<ReleasePage />)} />
        <Route path="profile" element={withSuspense(<ProfilePage />)} />
        <Route path="admin" element={withSuspense(<AdminPage />)} />
        <Route path="*" element={withSuspense(<NotFoundPage />)} />
      </Route>
    </Routes>
  );
}
