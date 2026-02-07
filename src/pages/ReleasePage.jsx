import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiExternalLink, FiHeart, FiPlay, FiPlus, FiShuffle } from "react-icons/fi";
import { LuHeart } from "react-icons/lu";
import styles from "./ReleasePage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchReleasePage } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

function shuffleTrackIds(trackIds) {
  const ids = [...trackIds];
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[randomIndex]] = [ids[randomIndex], ids[index]];
  }
  return ids;
}

export default function ReleasePage() {
  const { releaseId = "" } = useParams();
  const navigate = useNavigate();
  const loadReleasePage = useCallback(() => fetchReleasePage(releaseId), [releaseId]);
  const { status, data, error, reload } = useAsyncResource(loadReleasePage);

  const { likedIds, currentTrackId, playTrack, playQueue, toggleLikeTrack, addTrackNext } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const artistLine = useMemo(() => data?.release?.artistName ?? "", [data?.release?.artistName]);

  return (
    <PageShell>
      <button type="button" className={styles.backButton} onClick={() => navigate(-1)}>
        <FiArrowLeft />
        Назад
      </button>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем релиз" description="Собираем треки и связанные подборки." />
      ) : null}

      {status === "error" ? (
        <ResourceState title="Релиз недоступен" description={error} actionLabel="Повторить" onAction={reload} />
      ) : null}

      {status === "success" && data ? (
        <>
          <header className={styles.hero}>
            <div className={styles.cover} style={{ background: data.release.cover }} />
            <div className={styles.heroMeta}>
              <p className={styles.heroLabel}>{data.release.type.toUpperCase()}</p>
              <h1 className={styles.heroTitle}>{data.release.title}</h1>
              <ArtistInlineLinks
                artistLine={artistLine}
                className={styles.heroSubtitle}
                linkClassName={styles.heroArtistButton}
                textClassName={styles.heroSubtitle}
                onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
              />
              <div className={styles.heroStats}>
                <span>{data.release.year}</span>
                <span>{data.tracks.length} треков</span>
                <span>{formatDurationClock(data.totalDurationSec)}</span>
              </div>
              <div className={styles.heroActions}>
                <button type="button" className={styles.primaryButton} onClick={() => playQueue(data.release.trackIds, 0)}>
                  <FiPlay />
                  Слушать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => playQueue(shuffleTrackIds(data.release.trackIds), 0)}
                >
                  <FiShuffle />
                  Перемешать
                </button>
              </div>
            </div>
          </header>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Треки релиза</h2>
            <ul className={styles.trackList}>
              {data.tracks.map((track, index) => {
                const liked = likedIds.includes(track.id);
                const isActive = currentTrackId === track.id;
                return (
                  <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
                    <button
                      type="button"
                      className={styles.trackMain}
                      onClick={() => playTrack(track.id)}
                      onContextMenu={(event) => openTrackMenu(event, track.id)}
                    >
                      <span className={styles.trackIndex}>{index + 1}</span>
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
                      className={`${styles.iconButton} ${liked ? styles.iconButtonActive : ""}`.trim()}
                      aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                      onClick={() => toggleLikeTrack(track.id)}
                    >
                      {liked ? <FiHeart /> : <LuHeart />}
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Открыть страницу трека"
                      onClick={() => navigate(`/track/${track.id}`)}
                    >
                      <FiExternalLink />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Добавить далее в очередь"
                      onClick={() => addTrackNext(track.id)}
                    >
                      <FiPlus />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Другие релизы исполнителя</h2>
            {data.moreReleasesByArtist.length ? (
              <div className={styles.releaseGrid}>
                {data.moreReleasesByArtist.map((release) => (
                  <button
                    key={release.id}
                    type="button"
                    className={styles.releaseCard}
                    onClick={() => navigate(`/release/${release.id}`)}
                  >
                    <span className={styles.releaseCover} style={{ background: release.cover }} />
                    <span className={styles.releaseTitle}>{release.title}</span>
                    <span className={styles.releaseMeta}>
                      {release.year} • {release.type.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>Пока нет других релизов этого исполнителя.</p>
            )}
          </section>
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
