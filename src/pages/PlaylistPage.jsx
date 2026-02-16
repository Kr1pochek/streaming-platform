import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiClock,
  FiExternalLink,
  FiHeart,
  FiLink2,
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
  reorderUserPlaylistTracks,
  removeTrackFromUserPlaylist,
  renameUserPlaylist,
} from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import ModalDialog from "../components/ModalDialog.jsx";

function shuffleTrackIds(trackIds) {
  const ids = [...trackIds];
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[randomIndex]] = [ids[randomIndex], ids[index]];
  }
  return ids;
}

function moveTrack(tracks, fromIndex, toIndex) {
  const safeFrom = Number(fromIndex);
  const safeTo = Number(toIndex);
  if (
    !Number.isInteger(safeFrom) ||
    !Number.isInteger(safeTo) ||
    safeFrom < 0 ||
    safeTo < 0 ||
    safeFrom >= tracks.length ||
    safeTo >= tracks.length
  ) {
    return tracks;
  }

  const nextTracks = [...tracks];
  const [movedTrack] = nextTracks.splice(safeFrom, 1);
  nextTracks.splice(safeTo, 0, movedTrack);
  return nextTracks;
}

export default function PlaylistPage() {
  const { playlistId = "" } = useParams();
  const navigate = useNavigate();
  const loadPlaylistPage = useCallback(() => fetchPlaylistPage(playlistId), [playlistId]);
  const { status, data, error, reload } = useAsyncResource(loadPlaylistPage);

  const { likedIds, currentTrackId, playTrack, playQueue, toggleLikeTrack, addTrackNext, addQueueNext, notify } =
    usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [orderedTracks, setOrderedTracks] = useState([]);
  const [dragFromIndex, setDragFromIndex] = useState(-1);
  const [dragOverIndex, setDragOverIndex] = useState(-1);
  const [reorderSaving, setReorderSaving] = useState(false);

  useEffect(() => {
    setOrderedTracks(Array.isArray(data?.tracks) ? data.tracks : []);
  }, [data?.tracks]);

  const playlistTrackIds = useMemo(() => orderedTracks.map((track) => track.id), [orderedTracks]);
  const isCustomPlaylist = Boolean(data?.playlist?.isCustom);

  const totalDuration = useMemo(
    () => orderedTracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0),
    [orderedTracks]
  );

  const resetDragState = () => {
    setDragFromIndex(-1);
    setDragOverIndex(-1);
  };

  const handleRenamePlaylist = async () => {
    if (!isCustomPlaylist) return;
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      notify("Название плейлиста не может быть пустым.");
      return;
    }

    try {
      await renameUserPlaylist(data.playlist.id, nextTitle);
      setRenameDialogOpen(false);
      setRenameValue("");
      await reload();
      notify("Плейлист переименован.");
    } catch (renameError) {
      notify(renameError instanceof Error ? renameError.message : "Не удалось переименовать плейлист.");
    }
  };

  const handleDeletePlaylist = async () => {
    if (!isCustomPlaylist) return;

    try {
      await deleteUserPlaylist(data.playlist.id);
      setDeleteDialogOpen(false);
      notify("Плейлист удален.");
      navigate("/library");
    } catch (deleteError) {
      notify(deleteError instanceof Error ? deleteError.message : "Не удалось удалить плейлист.");
    }
  };

  const handleRemoveTrack = async (trackId) => {
    if (!isCustomPlaylist) return;

    try {
      await removeTrackFromUserPlaylist(data.playlist.id, trackId);
      await reload();
      notify("Трек удален из плейлиста.");
    } catch (removeError) {
      notify(removeError instanceof Error ? removeError.message : "Не удалось удалить трек из плейлиста.");
    }
  };

  const handleTrackDragStart = (index) => {
    if (!isCustomPlaylist || reorderSaving) {
      return;
    }
    setDragFromIndex(index);
    setDragOverIndex(index);
  };

  const handleTrackDragOver = (event, index) => {
    if (!isCustomPlaylist || reorderSaving) {
      return;
    }
    event.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleTrackDrop = async (event, targetIndex) => {
    if (!isCustomPlaylist || reorderSaving) {
      return;
    }
    event.preventDefault();

    if (
      !Number.isInteger(dragFromIndex) ||
      dragFromIndex < 0 ||
      dragFromIndex >= orderedTracks.length
    ) {
      resetDragState();
      return;
    }

    if (dragFromIndex === targetIndex) {
      resetDragState();
      return;
    }

    const nextTracks = moveTrack(orderedTracks, dragFromIndex, targetIndex);
    setOrderedTracks(nextTracks);
    resetDragState();

    setReorderSaving(true);
    try {
      await reorderUserPlaylistTracks(data.playlist.id, nextTracks.map((track) => track.id));
      await reload();
      notify("Порядок треков обновлен.");
    } catch (reorderError) {
      notify(reorderError instanceof Error ? reorderError.message : "Не удалось изменить порядок треков.");
      await reload();
    } finally {
      setReorderSaving(false);
    }
  };

  const handleSharePlaylist = async () => {
    if (!data?.playlist?.id || typeof window === "undefined") {
      return;
    }
    const absoluteUrl = `${window.location.origin}/playlist/${data.playlist.id}`;
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(absoluteUrl);
      notify("Ссылка на плейлист скопирована.");
    } catch {
      window.prompt("Скопируй ссылку на плейлист:", absoluteUrl);
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
                <span>{orderedTracks.length} треков</span>
                <span>
                  <FiClock />
                  {formatDurationClock(totalDuration)}
                </span>
              </div>
              <div className={styles.heroActions}>
                <button type="button" className={styles.primaryButton} onClick={() => playQueue(playlistTrackIds, 0)}>
                  <FiPlay />
                  Слушать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => playQueue(shuffleTrackIds(playlistTrackIds), 0)}
                >
                  <FiShuffle />
                  Перемешать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => addQueueNext(playlistTrackIds, "Плейлист")}
                >
                  В очередь
                </button>
                <button type="button" className={styles.secondaryButton} onClick={handleSharePlaylist}>
                  <FiLink2 />
                  Поделиться
                </button>
                {isCustomPlaylist ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      setRenameValue(data.playlist.title);
                      setRenameDialogOpen(true);
                    }}
                  >
                    Переименовать
                  </button>
                ) : null}
                {isCustomPlaylist ? (
                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${styles.dangerButton}`.trim()}
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    Удалить
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Треки</h2>
            {isCustomPlaylist ? (
              <p className={styles.reorderHint}>
                Перетаскивай треки, чтобы менять порядок.
                {reorderSaving ? " Сохраняем..." : ""}
              </p>
            ) : null}
            <ul className={styles.trackList}>
              {orderedTracks.map((track, index) => {
                const liked = likedIds.includes(track.id);
                const isActive = currentTrackId === track.id;
                return (
                  <li
                    key={track.id}
                    className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""} ${
                      isCustomPlaylist ? styles.trackRowDraggable : ""
                    } ${dragFromIndex === index ? styles.trackRowDragging : ""} ${
                      dragOverIndex === index && dragFromIndex !== index ? styles.trackRowDropTarget : ""
                    }`.trim()}
                    draggable={isCustomPlaylist}
                    onDragStart={() => handleTrackDragStart(index)}
                    onDragOver={(event) => handleTrackDragOver(event, index)}
                    onDrop={(event) => void handleTrackDrop(event, index)}
                    onDragEnd={resetDragState}
                  >
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
                    {isCustomPlaylist ? (
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
                        <button
                          type="button"
                          className={styles.relatedActionButton}
                          aria-label="Слушать"
                          onClick={(event) => {
                            event.stopPropagation();
                            playTrack(firstTrackId);
                          }}
                        >
                          <FiPlay />
                        </button>
                        <button
                          type="button"
                          className={styles.relatedActionButton}
                          aria-label="Лайк"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleLikeTrack(firstTrackId);
                          }}
                        >
                          <FiHeart />
                        </button>
                        <button
                          type="button"
                          className={styles.relatedActionButton}
                          aria-label="Добавить далее"
                          onClick={(event) => {
                            event.stopPropagation();
                            addTrackNext(firstTrackId);
                          }}
                        >
                          <FiPlus />
                        </button>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      <ModalDialog
        open={renameDialogOpen}
        title="Переименовать плейлист"
        description={data?.playlist ? `Текущий плейлист: ${data.playlist.title}` : ""}
        onClose={() => setRenameDialogOpen(false)}
        actions={
          <>
            <button type="button" className={styles.dialogGhostButton} onClick={() => setRenameDialogOpen(false)}>
              Отмена
            </button>
            <button type="button" className={styles.dialogPrimaryButton} onClick={handleRenamePlaylist}>
              Сохранить
            </button>
          </>
        }
      >
        <input
          className={styles.dialogInput}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          placeholder="Новое название"
          maxLength={80}
        />
      </ModalDialog>

      <ModalDialog
        open={deleteDialogOpen}
        title="Удалить плейлист?"
        description={data?.playlist ? `Плейлист "${data.playlist.title}" будет удален без восстановления.` : ""}
        onClose={() => setDeleteDialogOpen(false)}
        actions={
          <>
            <button type="button" className={styles.dialogGhostButton} onClick={() => setDeleteDialogOpen(false)}>
              Отмена
            </button>
            <button type="button" className={styles.dialogDangerButton} onClick={handleDeletePlaylist}>
              Удалить
            </button>
          </>
        }
      />

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
