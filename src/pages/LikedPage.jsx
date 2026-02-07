import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiHeart, FiMusic, FiPlay, FiSearch } from "react-icons/fi";
import styles from "./LikedPage.module.css";
import { usePlayer } from "../context/PlayerContext.jsx";
import useScrollingVisibility from "../hooks/useScrollingVisibility.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";

function splitColumns(items) {
  const splitPoint = Math.ceil(items.length / 2);
  return [items.slice(0, splitPoint), items.slice(splitPoint)];
}

export default function LikedPage() {
  const navigate = useNavigate();
  const { isScrolling, setScrollElement } = useScrollingVisibility();
  const { likedIds, trackMap, playTrack, toggleLikeTrack } = usePlayer();

  const likedTracks = useMemo(() => likedIds.map((id) => trackMap[id]).filter(Boolean), [likedIds, trackMap]);

  const totalDuration = useMemo(
    () => likedTracks.reduce((sum, track) => sum + (track?.durationSec ?? 0), 0),
    [likedTracks]
  );

  const uniqueArtistsCount = useMemo(() => {
    const artists = new Set(likedTracks.map((track) => track.artist));
    return artists.size;
  }, [likedTracks]);

  const [leftTracks, rightTracks] = useMemo(() => splitColumns(likedTracks), [likedTracks]);

  return (
    <div className={styles.page}>
      <section
        ref={setScrollElement}
        className={`${styles.shell} ${isScrolling ? styles.shellScrolling : ""}`.trim()}
      >
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Мне нравится</h1>
            <p className={styles.subtitle}>Твои любимые треки всегда под рукой и синхронизированы с плеером.</p>
          </div>
          <div className={styles.statsRow}>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Всего треков</span>
              <strong className={styles.statValue}>{likedTracks.length}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Длительность</span>
              <strong className={styles.statValue}>{formatDurationClock(totalDuration)}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Исполнителей</span>
              <strong className={styles.statValue}>{uniqueArtistsCount}</strong>
            </article>
          </div>
        </header>

        {!likedTracks.length ? (
          <section className={styles.section}>
            <ResourceState
              title="Пока нет лайков"
              description="Отметь сердцем треки в поиске или библиотеке, и они появятся здесь."
              actionLabel="Открыть поиск"
              onAction={() => navigate("/search")}
            />
          </section>
        ) : (
          <>
            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionTitle}>Твои лайки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.trackGrid}>
                <TrackColumn tracks={leftTracks} onPlay={playTrack} onToggleLike={toggleLikeTrack} />
                <TrackColumn tracks={rightTracks} onPlay={playTrack} onToggleLike={toggleLikeTrack} />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionTitle}>Быстрые действия</h2>
              </div>
              <div className={styles.actionsRow}>
                <button type="button" className={styles.primaryButton} onClick={() => playTrack(likedTracks[0].id)}>
                  <FiPlay />
                  Слушать с начала
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => navigate("/library")}>
                  <FiMusic />
                  В библиотеку
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => navigate("/search")}>
                  <FiSearch />
                  Найти ещё
                </button>
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function TrackColumn({ tracks, onPlay, onToggleLike }) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => (
        <li key={track.id}>
          <button type="button" className={styles.trackRow} onClick={() => onPlay(track.id)}>
            <span className={styles.trackCover} style={{ background: track.cover }} />
            <span className={styles.trackMeta}>
              <span className={styles.trackTitle}>{track.title}</span>
              <span className={styles.trackArtist}>{track.artist}</span>
            </span>
            <span
              className={styles.unlikeButton}
              role="button"
              tabIndex={0}
              aria-label="Убрать из избранного"
              onClick={(event) => {
                event.stopPropagation();
                onToggleLike(track.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleLike(track.id);
                }
              }}
            >
              <FiHeart />
            </span>
            <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
