import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiClock,
  FiExternalLink,
  FiHeart,
  FiPlay,
  FiPlus,
  FiShuffle,
  FiTrash2,
} from "react-icons/fi";
import { LuHeart } from "react-icons/lu";
import styles from "./PlaylistPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import {
  deleteUserPlaylist,
  fetchPlaylistPage,
  removeTrackFromUserPlaylist,
  renameUserPlaylist,
} from "../api/musicApi.js";
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

export default function PlaylistPage() {
  const { playlistId = "" } = useParams();
  const navigate = useNavigate();
  const loadPlaylistPage = useCallback(() => fetchPlaylistPage(playlistId), [playlistId]);
  const { status, data, error, reload } = useAsyncResource(loadPlaylistPage);

  const { likedIds, currentTrackId, playTrack, playQueue, toggleLikeTrack, addTrackNext, addQueueNext } =
    usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const totalDuration = useMemo(
    () => (data?.tracks ?? []).reduce((sum, track) => sum + (track.durationSec ?? 0), 0),
    [data?.tracks]
  );

  const handleRenamePlaylist = async () => {
    if (!data?.playlist?.isCustom) return;
    const nextTitle = window.prompt("Новое название плейлиста", data.playlist.title);
    if (nextTitle === null) return;

    try {
      await renameUserPlaylist(data.playlist.id, nextTitle);
      await reload();
    } catch {
      // noop
    }
  };

  const handleDeletePlaylist = async () => {
    if (!data?.playlist?.isCustom) return;
    const shouldDelete = window.confirm(`Удалить плейлист "${data.playlist.title}"?`);
    if (!shouldDelete) return;

    try {
      await deleteUserPlaylist(data.playlist.id);
      navigate("/library");
    } catch {
      // noop
    }
  };

  const handleRemoveTrack = async (trackId) => {
    if (!data?.playlist?.isCustom) return;

    try {
      await removeTrackFromUserPlaylist(data.playlist.id, trackId);
      await reload();
    } catch {
      // noop
    }
  };

  return (
    <PageShell>
      <button type="button" className={styles.backButton} onClick={() => navigate(-1)}>
        <FiArrowLeft />
        Назад
      </button>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем плейлист" description="Подтягиваем треки и подробности подборки." />
      ) : null}

      {status === "error" ? (
        <ResourceState title="Плейлист недоступен" description={error} actionLabel="Повторить" onAction={reload} />
      ) : null}

      {status === "success" && data ? (
        <>
          <header className={styles.hero}>
            <div className={styles.cover} style={{ background: data.playlist.cover }} />
            <div className={styles.heroMeta}>
              <p className={styles.heroLabel}>Плейлист</p>
              <h1 className={styles.heroTitle}>{data.playlist.title}</h1>
              <p className={styles.heroSubtitle}>{data.playlist.subtitle}</p>
              <div className={styles.heroStats}>
                <span>{data.tracks.length} треков</span>
                <span>
                  <FiClock />
                  {formatDurationClock(totalDuration)}
                </span>
              </div>
              <div className={styles.heroActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => playQueue(data.playlist.trackIds, 0)}
                >
                  <FiPlay />
                  Слушать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => playQueue(shuffleTrackIds(data.playlist.trackIds), 0)}
                >
                  <FiShuffle />
                  Перемешать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => addQueueNext(data.playlist.trackIds, "Плейлист")}
                >
                  В очередь
                </button>
                {data.playlist.isCustom ? (
                  <button type="button" className={styles.secondaryButton} onClick={handleRenamePlaylist}>
                    Переименовать
                  </button>
                ) : null}
                {data.playlist.isCustom ? (
                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${styles.dangerButton}`.trim()}
                    onClick={handleDeletePlaylist}
                  >
                    Удалить
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Треки</h2>
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
                    {data.playlist.isCustom ? (
                      <button
                        type="button"
                        className={`${styles.iconButton} ${styles.removeTrackButton}`.trim()}
                        aria-label="Удалить трек из плейлиста"
                        onClick={() => handleRemoveTrack(track.id)}
                      >
                        <FiTrash2 />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Похожие плейлисты</h2>
            <div className={styles.relatedGrid}>
              {data.relatedPlaylists.map((playlist) => {
                const firstTrackId = playlist.trackIds?.[0] ?? null;
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    className={styles.relatedCard}
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                  >
                    <span className={styles.relatedCover} style={{ background: playlist.cover }} />
                    <span className={styles.relatedTitle}>{playlist.title}</span>
                    <span className={styles.relatedSubtitle}>{playlist.subtitle}</span>
                    {firstTrackId ? (
                      <span className={styles.relatedActions}>
                        <span
                          className={styles.relatedActionButton}
                          role="button"
                          tabIndex={0}
                          aria-label="Слушать"
                          onClick={(event) => {
                            event.stopPropagation();
                            playTrack(firstTrackId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              playTrack(firstTrackId);
                            }
                          }}
                        >
                          <FiPlay />
                        </span>
                        <span
                          className={styles.relatedActionButton}
                          role="button"
                          tabIndex={0}
                          aria-label="Лайк"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLikeTrack(firstTrackId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleLikeTrack(firstTrackId);
                            }
                          }}
                        >
                          <FiHeart />
                        </span>
                        <span
                          className={styles.relatedActionButton}
                          role="button"
                          tabIndex={0}
                          aria-label="Добавить далее"
                          onClick={(event) => {
                            event.stopPropagation();
                            addTrackNext(firstTrackId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              addTrackNext(firstTrackId);
                            }
                          }}
                        >
                          <FiPlus />
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
