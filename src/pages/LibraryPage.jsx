import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronRight,
  FiExternalLink,
  FiHeart,
  FiPlay,
  FiPlus,
  FiArrowDown,
  FiArrowUp,
} from "react-icons/fi";
import styles from "./LibraryPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import {
  createUserPlaylist,
  deleteUserPlaylist,
  fetchLibraryFeed,
  renameUserPlaylist,
} from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

const sortOptions = [
  { id: "date", label: "По дате" },
  { id: "title", label: "По названию" },
  { id: "artist", label: "По артисту" },
];

function getPrimaryArtist(artistLine = "") {
  const [first = ""] = artistLine.split(",");
  return first.trim().toLowerCase();
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const loadLibraryFeed = useCallback(() => fetchLibraryFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadLibraryFeed);

  const {
    trackMap,
    likedIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    addTrackNext,
  } = usePlayer();

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const [sortBy, setSortBy] = useState("date");

  const playlists = useMemo(() => data?.playlists ?? [], [data?.playlists]);

  const recentTrackEntries = useMemo(() => {
    if (!playlists.length) return [];

    const ids = [];
    for (const playlist of playlists) {
      for (const trackId of playlist.trackIds) {
        if (!ids.includes(trackId)) ids.push(trackId);
      }
    }

    return ids
      .map((id, index) => ({
        track: trackMap[id],
        addedRank: ids.length - index,
      }))
      .filter((item) => Boolean(item.track));
  }, [playlists, trackMap]);

  const sortedRecentTracks = useMemo(() => {
    const items = [...recentTrackEntries];

    if (sortBy === "title") {
      items.sort((first, second) => first.track.title.localeCompare(second.track.title, "ru"));
    } else if (sortBy === "artist") {
      items.sort((first, second) =>
        getPrimaryArtist(first.track.artist).localeCompare(getPrimaryArtist(second.track.artist), "ru")
      );
    } else {
      items.sort((first, second) => second.addedRank - first.addedRank);
    }

    return items.slice(0, 10).map((item) => item.track);
  }, [recentTrackEntries, sortBy]);

  const recommendations = useMemo(() => Object.values(trackMap).slice(0, 4), [trackMap]);

  const isEmpty = status === "success" && !data?.playlists?.length && !data?.artists?.length;

  const handleCreatePlaylist = async () => {
    const value = window.prompt("Название нового плейлиста", "Новый плейлист");
    if (value === null) return;

    try {
      await createUserPlaylist(value);
      await reload();
    } catch {
      // noop
    }
  };

  const handleRenamePlaylist = async (playlist) => {
    const value = window.prompt("Новое название плейлиста", playlist.title);
    if (value === null) return;

    try {
      await renameUserPlaylist(playlist.id, value);
      await reload();
    } catch {
      // noop
    }
  };

  const handleDeletePlaylist = async (playlist) => {
    const shouldDelete = window.confirm(`Удалить плейлист "${playlist.title}"?`);
    if (!shouldDelete) return;

    try {
      await deleteUserPlaylist(playlist.id);
      await reload();
    } catch {
      // noop
    }
  };

  return (
    <PageShell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Моя музыка</h1>
          <p className={styles.subtitle}>Плейлисты, артисты и треки в одном месте с быстрым управлением.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={handleCreatePlaylist}>
            <FiPlus />
            Создать плейлист
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => navigate("/search")}>
            Добавить музыку
          </button>
        </div>
      </header>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем библиотеку" description="Собираем плейлисты и список исполнителей." />
      ) : null}

      {status === "error" ? (
        <ResourceState
          title="Не удалось загрузить библиотеку"
          description={error}
          actionLabel="Повторить"
          onAction={reload}
        />
      ) : null}

      {isEmpty ? (
        <>
          <ResourceState
            title="Библиотека пустая"
            description="Добавь первые треки в лайки или открой подборки в поиске."
            actionLabel="Открыть поиск"
            onAction={() => navigate("/search")}
          />
          <SmartRecommendations
            title="Что можно включить сейчас"
            tracks={recommendations}
            onPlayTrack={playTrack}
            onLikeTrack={toggleLikeTrack}
            onOpenTrack={(trackId) => navigate(`/track/${trackId}`)}
          />
        </>
      ) : null}

      {status === "success" && !isEmpty ? (
        <>
          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Плейлисты</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            <div className={styles.playlistGrid}>
              {data.playlists.map((playlist) => {
                const firstTrack = trackMap[playlist.trackIds[0]];
                return (
                  <article key={playlist.id} className={styles.playlistCard}>
                    <div className={styles.playlistCover} style={{ background: playlist.cover }} />
                    <div className={styles.playlistMeta}>
                      <h3 className={styles.playlistTitle}>{playlist.title}</h3>
                      <p className={styles.playlistSubtitle}>{playlist.subtitle}</p>
                      <p className={styles.playlistCount}>{playlist.trackIds.length} треков</p>
                    </div>
                    <div className={styles.playlistActions}>
                      <button
                        type="button"
                        className={styles.playlistButton}
                        onClick={() => firstTrack && playTrack(firstTrack.id)}
                      >
                        <FiPlay />
                        Слушать
                      </button>
                      <button
                        type="button"
                        className={styles.playlistGhostButton}
                        onClick={() => navigate(`/playlist/${playlist.id}`)}
                      >
                        <FiExternalLink />
                        Открыть
                      </button>
                      {playlist.isCustom ? (
                        <button
                          type="button"
                          className={styles.playlistGhostButton}
                          onClick={() => handleRenamePlaylist(playlist)}
                        >
                          Переименовать
                        </button>
                      ) : null}
                      {playlist.isCustom ? (
                        <button
                          type="button"
                          className={`${styles.playlistGhostButton} ${styles.playlistDeleteButton}`.trim()}
                          onClick={() => handleDeletePlaylist(playlist)}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>
                    {firstTrack ? (
                      <div className={styles.playlistQuickActions}>
                        <button
                          type="button"
                          className={styles.quickActionButton}
                          aria-label="Лайк"
                          onClick={() => toggleLikeTrack(firstTrack.id)}
                        >
                          <FiHeart />
                        </button>
                        <button
                          type="button"
                          className={styles.quickActionButton}
                          aria-label="Добавить далее"
                          onClick={() => addTrackNext(firstTrack.id)}
                        >
                          <FiPlus />
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Исполнители</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            <div className={styles.artistGrid}>
              {data.artists.map((artist) => (
                <article key={artist.id} className={styles.artistCard}>
                  <span className={styles.artistAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                  <span className={styles.artistMeta}>
                    <span className={styles.artistName}>{artist.name}</span>
                    <span className={styles.artistFollowers}>{artist.followers} подписчиков</span>
                  </span>
                  <button
                    type="button"
                    className={styles.artistButton}
                    onClick={() => navigate(`/artist/${artist.id}`)}
                  >
                    <FiExternalLink />
                    Открыть
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Недавно добавленное</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            <div className={styles.sortRow}>
              {sortOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.sortButton} ${sortBy === option.id ? styles.sortButtonActive : ""}`.trim()}
                  onClick={() => setSortBy(option.id)}
                >
                  {option.id === "date" ? <FiArrowDown /> : <FiArrowUp />}
                  {option.label}
                </button>
              ))}
            </div>
            <ul className={styles.trackList}>
              {sortedRecentTracks.map((track) => {
                const liked = likedIds.includes(track.id);
                const isActive = currentTrackId === track.id;
                return (
                  <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
                    <button
                      type="button"
                      className={styles.trackMainButton}
                      onClick={() => playTrack(track.id)}
                      onContextMenu={(event) => openTrackMenu(event, track.id)}
                    >
                      <span className={styles.trackCover} style={{ background: track.cover }} />
                      <span className={styles.trackMeta}>
                        <span className={styles.trackTitle}>
                          {isActive ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                          {track.title}
                        </span>
                        <ArtistInlineLinks
                          artistLine={track.artist}
                          className={styles.trackArtist}
                          linkClassName={styles.trackArtistButton}
                          textClassName={styles.trackArtist}
                          onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                          stopPropagation
                        />
                      </span>
                      <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.likeButton} ${liked ? styles.likeButtonActive : ""}`.trim()}
                      aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                      onClick={() => toggleLikeTrack(track.id)}
                    >
                      <FiHeart />
                    </button>
                    <button
                      type="button"
                      className={styles.queueButton}
                      aria-label="Добавить далее в очередь"
                      onClick={() => addTrackNext(track.id)}
                    >
                      <FiPlus />
                    </button>
                    <button
                      type="button"
                      className={styles.trackOpenButton}
                      aria-label="Открыть страницу трека"
                      onClick={() => navigate(`/track/${track.id}`)}
                    >
                      <FiExternalLink />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
