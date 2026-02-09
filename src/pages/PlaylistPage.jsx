import { useCallback, useMemo, useState } from "react";
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
import ModalDialog from "../components/ModalDialog.jsx";

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

  const { likedIds, currentTrackId, playTrack, playQueue, toggleLikeTrack, addTrackNext, addQueueNext, notify } =
    usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const totalDuration = useMemo(
    () => (data?.tracks ?? []).reduce((sum, track) => sum + (track.durationSec ?? 0), 0),
    [data?.tracks]
  );

  const handleRenamePlaylist = async () => {
    if (!data?.playlist?.isCustom) return;
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
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось переименовать плейлист.");
    }
  };

  const handleDeletePlaylist = async () => {
    if (!data?.playlist?.isCustom) return;

    try {
      await deleteUserPlaylist(data.playlist.id);
      setDeleteDialogOpen(false);
      notify("Плейлист удален.");
      navigate("/library");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось удалить плейлист.");
    }
  };

  const handleRemoveTrack = async (trackId) => {
    if (!data?.playlist?.isCustom) return;

    try {
      await removeTrackFromUserPlaylist(data.playlist.id, trackId);
      await reload();
      notify("Трек удален из плейлиста.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось удалить трек из плейлиста.");
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
                {data.playlist.isCustom ? (
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
