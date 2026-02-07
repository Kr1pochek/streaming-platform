import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiHeart, FiPlay, FiPlus, FiUserPlus } from "react-icons/fi";
import styles from "./LibraryPage.module.css";
import useScrollingVisibility from "../hooks/useScrollingVisibility.js";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchLibraryFeed } from "../api/musicApi.js";
import { usePlayer } from "../context/PlayerContext.jsx";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { isScrolling, setScrollElement } = useScrollingVisibility();
  const { status, data, error, reload } = useAsyncResource(fetchLibraryFeed, []);

  const { trackMap, likedIds, playTrack, toggleLikeTrack } = usePlayer();
  const playlists = useMemo(() => data?.playlists ?? [], [data?.playlists]);

  const recentTracks = useMemo(() => {
    if (!playlists.length) return [];

    const ids = [];
    for (const playlist of playlists) {
      for (const trackId of playlist.trackIds) {
        if (!ids.includes(trackId)) ids.push(trackId);
      }
    }

    return ids.map((id) => trackMap[id]).filter(Boolean).slice(0, 10);
  }, [playlists, trackMap]);

  const isEmpty = status === "success" && !data?.playlists?.length && !data?.artists?.length;

  return (
    <div className={styles.page}>
      <section
        ref={setScrollElement}
        className={`${styles.shell} ${isScrolling ? styles.shellScrolling : ""}`.trim()}
      >
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Моя музыка</h1>
            <p className={styles.subtitle}>Плейлисты, артисты и треки в одном месте с быстрым управлением.</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.primaryButton}>
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
          <ResourceState
            title="Библиотека пустая"
            description="Добавь первые треки в лайки или открой подборки в поиске."
            actionLabel="Открыть поиск"
            onAction={() => navigate("/search")}
          />
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
                      <button
                        type="button"
                        className={styles.playlistButton}
                        onClick={() => firstTrack && playTrack(firstTrack.id)}
                      >
                        <FiPlay />
                        Слушать
                      </button>
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
                    <button type="button" className={styles.artistButton}>
                      <FiUserPlus />
                      Подписаться
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
              <ul className={styles.trackList}>
                {recentTracks.map((track) => {
                  const liked = likedIds.includes(track.id);
                  return (
                    <li key={track.id}>
                      <button type="button" className={styles.trackRow} onClick={() => playTrack(track.id)}>
                        <span className={styles.trackCover} style={{ background: track.cover }} />
                        <span className={styles.trackMeta}>
                          <span className={styles.trackTitle}>{track.title}</span>
                          <span className={styles.trackArtist}>{track.artist}</span>
                        </span>
                        <span
                          className={styles.likeButton}
                          role="button"
                          tabIndex={0}
                          aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLikeTrack(track.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleLikeTrack(track.id);
                            }
                          }}
                        >
                          <FiHeart />
                        </span>
                        <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
