import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiHeart, FiMoreHorizontal, FiShuffle } from "react-icons/fi";
import { BsFillPlayFill } from "react-icons/bs";
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

  const { likedIds, currentTrackId, playTrack, playQueue } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const artistLine = useMemo(() => data?.release?.artistName ?? "", [data?.release?.artistName]);
  const releaseTrackIds =
    Array.isArray(data?.release?.trackIds) && data.release.trackIds.length
      ? data.release.trackIds
      : Array.isArray(data?.tracks)
        ? data.tracks.map((track) => track.id).filter(Boolean)
        : [];

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
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!releaseTrackIds.length}
                  onClick={() => playQueue(releaseTrackIds, 0)}
                >
                  <BsFillPlayFill />
                  Слушать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!releaseTrackIds.length}
                  onClick={() => playQueue(shuffleTrackIds(releaseTrackIds), 0)}
                >
                  <FiShuffle />
                  Перемешать
                </button>
              </div>
            </div>
          </header>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Треки релиза</h2>
            {data.tracks.length ? (
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
                            {track.title}
                            {liked ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
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
                        className={styles.iconButton}
                        aria-label="Открыть меню трека"
                        onClick={(event) => openTrackMenu(event, track.id)}
                      >
                        <FiMoreHorizontal />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyText}>В этом релизе пока нет доступных треков.</p>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Плейлисты с этим релизом</h2>
            {data.relatedPlaylists.length ? (
              <div className={styles.releaseGrid}>
                {data.relatedPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    className={styles.releaseCard}
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                  >
                    <span className={styles.releaseCover} style={{ background: playlist.cover }} />
                    <span className={styles.releaseTitle}>{playlist.title}</span>
                    <span className={styles.releaseMeta}>
                      {playlist.subtitle || `${playlist.trackIds.length} треков`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>Этот релиз пока не входит в готовые подборки.</p>
            )}
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
