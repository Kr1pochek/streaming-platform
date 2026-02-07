import { Routes, Route } from "react-router-dom";
import AppLayout from "./components/AppLayout.jsx";
import HomePage from "./pages/HomePage.jsx";
import SearchPage from "./pages/SearchPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import LikedPage from "./pages/LikedPage.jsx";
import PlaylistPage from "./pages/PlaylistPage.jsx";
import TrackPage from "./pages/TrackPage.jsx";
import ArtistPage from "./pages/ArtistPage.jsx";
import ReleasePage from "./pages/ReleasePage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="liked" element={<LikedPage />} />
        <Route path="playlist/:playlistId" element={<PlaylistPage />} />
        <Route path="track/:trackId" element={<TrackPage />} />
        <Route path="artist/:artistId" element={<ArtistPage />} />
        <Route path="release/:releaseId" element={<ReleasePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
