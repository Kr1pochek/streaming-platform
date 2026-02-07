import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiExternalLink, FiHeart, FiMusic, FiPlay, FiPlus, FiSearch } from "react-icons/fi";
import styles from "./LikedPage.module.css";
import usePlayer from "../hooks/usePlayer.js";
import PageShell from "../components/PageShell.jsx";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

function splitColumns(items) {
  const splitPoint = Math.ceil(items.length / 2);
  return [items.slice(0, splitPoint), items.slice(splitPoint)];
}

export default function LikedPage() {
  const navigate = useNavigate();
  const { likedIds, trackMap, currentTrackId, playTrack, toggleLikeTrack, addTrackNext } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const likedTracks = useMemo(() => likedIds.map((id) => trackMap[id]).filter(Boolean), [likedIds, trackMap]);

  const recommendations = useMemo(() => {
    const excluded = new Set(likedIds);
    return Object.values(trackMap).filter((track) => !excluded.has(track.id)).slice(0, 4);
  }, [trackMap, likedIds]);

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
    <PageShell>
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
          <SmartRecommendations
            title="Можно начать с этих треков"
            tracks={recommendations}
            onPlayTrack={playTrack}
            onLikeTrack={toggleLikeTrack}
            onOpenTrack={(trackId) => navigate(`/track/${trackId}`)}
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
              <TrackColumn
                tracks={leftTracks}
                currentTrackId={currentTrackId}
                onPlay={playTrack}
                onToggleLike={toggleLikeTrack}
                onAddNext={addTrackNext}
                onOpenTrack={(id) => navigate(`/track/${id}`)}
                onOpenArtist={(id) => navigate(`/artist/${id}`)}
                onOpenTrackMenu={openTrackMenu}
              />
              <TrackColumn
                tracks={rightTracks}
                currentTrackId={currentTrackId}
                onPlay={playTrack}
                onToggleLike={toggleLikeTrack}
                onAddNext={addTrackNext}
                onOpenTrack={(id) => navigate(`/track/${id}`)}
                onOpenArtist={(id) => navigate(`/artist/${id}`)}
                onOpenTrackMenu={openTrackMenu}
              />
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

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}

function TrackColumn({
  tracks,
  currentTrackId,
  onPlay,
  onToggleLike,
  onAddNext,
  onOpenTrack,
  onOpenArtist,
  onOpenTrackMenu,
}) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => (
        <li key={track.id} className={`${styles.trackRow} ${currentTrackId === track.id ? styles.trackRowActive : ""}`.trim()}>
          <button
            type="button"
            className={styles.trackMainButton}
            onClick={() => onPlay(track.id)}
            onContextMenu={(event) => onOpenTrackMenu(event, track.id)}
          >
            <span className={styles.trackCover} style={{ background: track.cover }} />
            <span className={styles.trackMeta}>
              <span className={styles.trackTitle}>
                {currentTrackId === track.id ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                {track.title}
              </span>
              <ArtistInlineLinks
                artistLine={track.artist}
                className={styles.trackArtist}
                linkClassName={styles.trackArtistButton}
                textClassName={styles.trackArtist}
                onOpenArtist={onOpenArtist}
                stopPropagation
              />
            </span>
            <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
          </button>
          <button
            type="button"
            className={`${styles.unlikeButton} ${styles.unlikeButtonActive}`.trim()}
            aria-label="Убрать из избранного"
            onClick={() => onToggleLike(track.id)}
          >
            <FiHeart />
          </button>
          <button
            type="button"
            className={styles.queueButton}
            aria-label="Добавить далее в очередь"
            onClick={() => onAddNext(track.id)}
          >
            <FiPlus />
          </button>
          <button
            type="button"
            className={styles.trackOpenButton}
            aria-label="Открыть страницу трека"
            onClick={() => onOpenTrack(track.id)}
          >
            <FiExternalLink />
          </button>
        </li>
      ))}
    </ul>
  );
}
