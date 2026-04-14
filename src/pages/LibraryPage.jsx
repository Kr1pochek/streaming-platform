import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { FiChevronRight, FiExternalLink, FiHeart, FiMoreHorizontal, FiPlay, FiPlus } from "react-icons/fi";
import styles from "./LibraryPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import {
  createUserPlaylist,
  deleteUserPlaylist,
  fetchLibraryFeed,
  updateUserPlaylist,
} from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import useAuth from "../hooks/useAuth.js";
import ResourceState from "../components/ResourceState.jsx";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import ModalDialog from "../components/ModalDialog.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import CardActionMenu from "../components/CardActionMenu.jsx";
import useCardActionMenu from "../hooks/useCardActionMenu.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import { formatDurationClock } from "../utils/formatters.js";

const INITIAL_MY_PLAYLISTS_LIMIT = 6;
const INITIAL_SAVED_PLAYLISTS_LIMIT = 6;
const DEFAULT_PLAYLIST_DESCRIPTION = "Custom playlist";
const LEGACY_DEFAULT_PLAYLIST_DESCRIPTIONS = new Set([
  "Пользовательский плейлист",
  "Custom playlist",
]);
const DEFAULT_PLAYLIST_COVER = "linear-gradient(135deg, #5f739f 0%, #9ab2ff 50%, #22324d 100%)";
const MAX_PLAYLIST_IMAGE_FILE_SIZE = 5 * 1024 * 1024;
const PLAYLIST_COVER_MAX_SIDE = 640;
const PLAYLIST_COVER_JPEG_QUALITY = 0.74;
const MAX_PLAYLIST_COVER_BACKGROUND_LENGTH = 900_000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось обработать изображение."));
    image.src = dataUrl;
  });
}

async function buildPlaylistCoverFromFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Выбери файл изображения.");
  }

  if (file.size > MAX_PLAYLIST_IMAGE_FILE_SIZE) {
    throw new Error("Файл слишком большой. Максимум 5 МБ.");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxSide = Math.max(image.width || 1, image.height || 1);
  const scale = maxSide > PLAYLIST_COVER_MAX_SIDE ? PLAYLIST_COVER_MAX_SIDE / maxSide : 1;
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Не удалось подготовить изображение.");
  }

  context.drawImage(image, 0, 0, width, height);
  const optimizedDataUrl = canvas.toDataURL("image/jpeg", PLAYLIST_COVER_JPEG_QUALITY);
  if (optimizedDataUrl.length > MAX_PLAYLIST_COVER_BACKGROUND_LENGTH) {
    throw new Error("Изображение слишком тяжелое. Попробуй фото меньшего размера.");
  }
  return `url("${optimizedDataUrl}") center / cover no-repeat`;
}

function isDefaultPlaylistDescription(value) {
  const text = String(value ?? "").trim();
  return !text || text === DEFAULT_PLAYLIST_DESCRIPTION || LEGACY_DEFAULT_PLAYLIST_DESCRIPTIONS.has(text);
}

function displayPlaylistDescription(value) {
  const text = String(value ?? "").trim();
  if (isDefaultPlaylistDescription(text)) {
    return "Без описания";
  }
  return text;
}

function descriptionToFormValue(value) {
  const text = String(value ?? "").trim();
  return isDefaultPlaylistDescription(text) ? "" : text;
}

export default function LibraryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const loadLibraryFeed = useCallback(() => fetchLibraryFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadLibraryFeed);

  const {
    trackMap,
    likedIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    togglePlaylistSave,
    notify,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();
  const {
    menuState: cardMenuState,
    openCardMenu,
    closeCardMenu,
  } = useCardActionMenu();

  const [showAllPlaylists, setShowAllPlaylists] = useState(false);
  const [showAllSavedPlaylists, setShowAllSavedPlaylists] = useState(false);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createCoverUploading, setCreateCoverUploading] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "Новый плейлист",
    description: "",
    cover: "",
    isPublic: false,
  });

  const [editDialog, setEditDialog] = useState({
    open: false,
    playlist: null,
    title: "",
    description: "",
    cover: "",
    isPublic: false,
  });
  const [editCoverUploading, setEditCoverUploading] = useState(false);

  const [deleteDialogPlaylist, setDeleteDialogPlaylist] = useState(null);

  const playlists = useMemo(() => data?.playlists ?? [], [data?.playlists]);
  const savedPlaylists = useMemo(() => data?.savedPlaylists ?? [], [data?.savedPlaylists]);
  const myPlaylists = useMemo(() => playlists.filter((playlist) => playlist.isCustom), [playlists]);

  const canTogglePlaylists = myPlaylists.length > INITIAL_MY_PLAYLISTS_LIMIT;
  const visibleMyPlaylists =
    canTogglePlaylists && !showAllPlaylists
      ? myPlaylists.slice(0, INITIAL_MY_PLAYLISTS_LIMIT)
      : myPlaylists;
  const canToggleSavedPlaylists = savedPlaylists.length > INITIAL_SAVED_PLAYLISTS_LIMIT;
  const visibleSavedPlaylists =
    canToggleSavedPlaylists && !showAllSavedPlaylists
      ? savedPlaylists.slice(0, INITIAL_SAVED_PLAYLISTS_LIMIT)
      : savedPlaylists;

  const likedTracks = useMemo(() => likedIds.map((id) => trackMap[id]).filter(Boolean), [likedIds, trackMap]);
  const likedPreviewTracks = useMemo(() => likedTracks.slice(0, 6), [likedTracks]);
  const recommendations = useMemo(
    () => Object.values(trackMap).filter((track) => !likedIds.includes(track.id)).slice(0, 4),
    [trackMap, likedIds]
  );
  const isEmpty = status === "success" && !myPlaylists.length && !savedPlaylists.length && !likedTracks.length;

  useEffect(() => {
    if (searchParams.get("createPlaylist") !== "1") {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("createPlaylist");
    setSearchParams(nextParams, { replace: true });

    if (!isAuthenticated) {
      notify("Войди в аккаунт, чтобы управлять плейлистами.");
      navigate("/profile");
      return;
    }

    setCreateForm({
      title: "Новый плейлист",
      description: "",
      cover: "",
      isPublic: false,
    });
    setCreateDialogOpen(true);
  }, [isAuthenticated, navigate, notify, searchParams, setSearchParams]);

  const requireAuthenticated = () => {
    if (isAuthenticated) {
      return true;
    }
    notify("Войди в аккаунт, чтобы управлять плейлистами.");
    navigate("/profile");
    return false;
  };

  const openCreateDialog = () => {
    if (!requireAuthenticated()) {
      return;
    }
    setCreateForm({
      title: "Новый плейлист",
      description: "",
      cover: "",
      isPublic: false,
    });
    setCreateDialogOpen(true);
  };

  const openEditDialog = (playlist) => {
    if (!requireAuthenticated()) {
      return;
    }
    setEditDialog({
      open: true,
      playlist,
      title: playlist.title,
      description: descriptionToFormValue(playlist.subtitle),
      cover: String(playlist.cover ?? "").trim(),
      isPublic: Boolean(playlist.isPublic),
    });
  };

  const handleCreatePlaylist = async () => {
    if (!requireAuthenticated()) {
      return;
    }
    const title = createForm.title.trim();
    if (!title) {
      notify("Название плейлиста не может быть пустым.");
      return;
    }

    try {
      await createUserPlaylist({
        title,
        description: createForm.description.trim(),
        cover: createForm.cover.trim(),
        isPublic: createForm.isPublic,
      });
      setCreateDialogOpen(false);
      setCreateForm({ title: "Новый плейлист", description: "", cover: "", isPublic: false });
      await reload();
      notify("Плейлист создан.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось создать плейлист.");
    }
  };

  const handleUpdatePlaylist = async () => {
    if (!requireAuthenticated()) {
      return;
    }
    if (!editDialog.playlist) {
      return;
    }

    const title = editDialog.title.trim();
    if (!title) {
      notify("Название плейлиста не может быть пустым.");
      return;
    }

    try {
      await updateUserPlaylist(editDialog.playlist.id, {
        title,
        description: editDialog.description.trim(),
        cover: editDialog.cover.trim(),
        isPublic: editDialog.isPublic,
      });
      setEditDialog({ open: false, playlist: null, title: "", description: "", cover: "", isPublic: false });
      await reload();
      notify("Плейлист обновлен.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось обновить плейлист.");
    }
  };

  const handleToggleSavedPlaylist = async (playlistId) => {
    if (!requireAuthenticated()) {
      return;
    }

    const synced = await togglePlaylistSave(playlistId);
    if (!synced) {
      return;
    }

    await reload();
  };

  const handleDeletePlaylist = async () => {
    if (!requireAuthenticated()) {
      return;
    }
    if (!deleteDialogPlaylist) {
      return;
    }

    try {
      await deleteUserPlaylist(deleteDialogPlaylist.id);
      setDeleteDialogPlaylist(null);
      await reload();
      notify("Плейлист удален.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось удалить плейлист.");
    }
  };

  const handleCreateCoverChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setCreateCoverUploading(true);
    try {
      const nextCover = await buildPlaylistCoverFromFile(file);
      setCreateForm((prev) => ({ ...prev, cover: nextCover }));
      notify("Обложка добавлена.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось загрузить обложку.");
    } finally {
      setCreateCoverUploading(false);
    }
  };

  const handleEditCoverChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setEditCoverUploading(true);
    try {
      const nextCover = await buildPlaylistCoverFromFile(file);
      setEditDialog((prev) => ({ ...prev, cover: nextCover }));
      notify("Обложка добавлена.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось загрузить обложку.");
    } finally {
      setEditCoverUploading(false);
    }
  };

  const copyEntityLink = async (path, successMessage, promptLabel) => {
    if (typeof window === "undefined") {
      return;
    }

    const absoluteUrl = `${window.location.origin}${path}`;
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(absoluteUrl);
      notify(successMessage);
    } catch {
      window.prompt(promptLabel, absoluteUrl);
    }
  };

  return (
    <PageShell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Моя музыка</h1>
          <p className={styles.subtitle}>Любимые треки, свои плейлисты и сохраненные подборки в одном месте.</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.primaryButton} onClick={openCreateDialog}>
            <FiPlus />
            Создать плейлист
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => navigate("/search")}>
            Добавить музыку
          </button>
        </div>
      </header>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем библиотеку" description="Собираем лайки, плейлисты и сохранения." />
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
            description="Лайкни трек, сохрани подборку или создай первый плейлист."
            actionLabel="Открыть поиск"
            onAction={() => navigate("/search")}
          />
          <SmartRecommendations
            title="Что можно включить сейчас"
            tracks={recommendations}
            onPlayTrack={playTrack}
            onLikeTrack={toggleLikeTrack}
            onOpenTrackMenu={openTrackMenu}
          />
        </>
      ) : null}

      {status === "success" && !isEmpty ? (
        <>
          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Мне нравится</h2>
              <span className={styles.playlistCountBadge}>{likedTracks.length}</span>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {likedTracks.length ? (
              <>
                <ul className={styles.trackList}>
                  {likedPreviewTracks.map((track) => (
                    <li key={track.id} className={`${styles.trackRow} ${currentTrackId === track.id ? styles.trackRowActive : ""}`.trim()}>
                      <button
                        type="button"
                        className={styles.trackMainButton}
                        onClick={() => playTrack(track.id)}
                        onContextMenu={(event) => openTrackMenu(event, track.id)}
                      >
                        <span className={styles.trackCover} style={{ background: track.cover }} />
                        <span className={styles.trackMeta}>
                          <span className={styles.trackTitle}>
                            {track.title}
                            {currentTrackId !== track.id ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
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
                        className={`${styles.likeButton} ${styles.likeButtonActive}`.trim()}
                        aria-label="Убрать из понравившихся"
                        onClick={() => toggleLikeTrack(track.id)}
                      >
                        <FiHeart />
                      </button>
                      <button
                        type="button"
                        className={styles.queueButton}
                        aria-label="Открыть меню трека"
                        onClick={(event) => openTrackMenu(event, track.id)}
                      >
                        <FiMoreHorizontal />
                      </button>
                    </li>
                  ))}
                </ul>

                <button type="button" className={styles.playlistToggleButton} onClick={() => navigate("/liked")}>
                  Открыть весь список
                </button>
              </>
            ) : (
              <div className={styles.sectionState}>
                <ResourceState
                  title="Пока нет лайков"
                  description="Отмечай треки сердцем, и они будут собираться здесь."
                  actionLabel="Перейти в поиск"
                  onAction={() => navigate("/search")}
                />
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Мои плейлисты</h2>
              <span className={styles.playlistCountBadge}>{myPlaylists.length}</span>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {myPlaylists.length ? (
              <>
                <div className={styles.playlistGrid}>
                  {visibleMyPlaylists.map((playlist) => {
                    const firstTrackId = playlist.trackIds?.[0] ?? null;
                    return (
                      <article key={playlist.id} className={styles.playlistCard}>
                        <button
                          type="button"
                          className={styles.playlistMainButton}
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                          aria-label={`Открыть плейлист ${playlist.title}`}
                        >
                          <div
                            className={styles.playlistCover}
                            style={{ background: playlist.cover || DEFAULT_PLAYLIST_COVER }}
                          />
                          <div className={styles.playlistMeta}>
                            <h3 className={styles.playlistTitle}>{playlist.title}</h3>
                            <div className={styles.playlistPills}>
                              <span className={styles.playlistPill}>
                                {playlist.isPublic ? "Публичный" : "Только вам"}
                              </span>
                            </div>
                            <p className={styles.playlistSubtitle}>{displayPlaylistDescription(playlist.subtitle)}</p>
                            <p className={styles.playlistCount}>{playlist.trackIds.length} треков</p>
                          </div>
                        </button>
                        <div className={styles.cardActions}>
                          {firstTrackId ? (
                            <button
                              type="button"
                              className={styles.cardActionButton}
                              aria-label="Слушать плейлист"
                              onClick={() => playTrack(firstTrackId)}
                            >
                              <FiPlay />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.cardActionButton}
                            aria-label="Меню плейлиста"
                            onClick={(event) =>
                              openCardMenu(event, {
                                title: playlist.title,
                                subtitle: `${playlist.trackIds.length} треков`,
                                actions: [
                                  {
                                    id: `open-playlist-${playlist.id}`,
                                    icon: "open",
                                    label: "Открыть плейлист",
                                    onSelect: () => navigate(`/playlist/${playlist.id}`),
                                  },
                                  {
                                    id: `share-playlist-${playlist.id}`,
                                    icon: "share",
                                    label: "Поделиться",
                                    onSelect: () =>
                                      copyEntityLink(
                                        `/playlist/${playlist.id}`,
                                        "Ссылка на плейлист скопирована.",
                                        "Скопируй ссылку на плейлист:"
                                      ),
                                  },
                                  {
                                    id: `edit-playlist-${playlist.id}`,
                                    icon: "edit",
                                    label: "Редактировать",
                                    onSelect: () => openEditDialog(playlist),
                                  },
                                  {
                                    id: `delete-playlist-${playlist.id}`,
                                    icon: "delete",
                                    label: "Удалить",
                                    tone: "danger",
                                    onSelect: () => setDeleteDialogPlaylist(playlist),
                                  },
                                ],
                              })
                            }
                          >
                            <FiMoreHorizontal />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {canTogglePlaylists ? (
                  <button
                    type="button"
                    className={styles.playlistToggleButton}
                    onClick={() => setShowAllPlaylists((value) => !value)}
                  >
                    {showAllPlaylists ? "Свернуть" : "Показать все"}
                  </button>
                ) : null}
              </>
            ) : (
              <div className={styles.sectionState}>
                <ResourceState
                  title="У тебя пока нет плейлистов"
                  description="Создай первый плейлист и добавь туда треки из поиска."
                  actionLabel="Создать плейлист"
                  onAction={openCreateDialog}
                />
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Сохраненные плейлисты</h2>
              <span className={styles.playlistCountBadge}>{savedPlaylists.length}</span>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {savedPlaylists.length ? (
              <>
                <div className={styles.playlistGrid}>
                  {visibleSavedPlaylists.map((playlist) => (
                    <article key={playlist.id} className={styles.playlistCard}>
                      <button
                        type="button"
                        className={styles.playlistMainButton}
                        onClick={() => navigate(`/playlist/${playlist.id}`)}
                        aria-label={`Открыть плейлист ${playlist.title}`}
                      >
                        <div
                          className={styles.playlistCover}
                          style={{ background: playlist.cover || DEFAULT_PLAYLIST_COVER }}
                        />
                        <div className={styles.playlistMeta}>
                          <h3 className={styles.playlistTitle}>{playlist.title}</h3>
                          <div className={styles.playlistPills}>
                            <span className={styles.playlistPill}>
                              {playlist.isCustom ? "Публичный плейлист" : "Подборка каталога"}
                            </span>
                          </div>
                          <p className={styles.playlistSubtitle}>{displayPlaylistDescription(playlist.subtitle)}</p>
                          <p className={styles.playlistCount}>{playlist.trackIds.length} треков</p>
                        </div>
                      </button>
                      <div className={styles.cardActions}>
                        {playlist.trackIds?.[0] ? (
                          <button
                            type="button"
                            className={styles.cardActionButton}
                            aria-label="Слушать плейлист"
                            onClick={() => playTrack(playlist.trackIds[0])}
                          >
                            <FiPlay />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Меню плейлиста"
                          onClick={(event) =>
                            openCardMenu(event, {
                              title: playlist.title,
                              subtitle: `${playlist.trackIds.length} треков`,
                              actions: [
                                {
                                  id: `open-saved-playlist-${playlist.id}`,
                                  icon: "open",
                                  label: "Открыть плейлист",
                                  onSelect: () => navigate(`/playlist/${playlist.id}`),
                                },
                                {
                                  id: `share-saved-playlist-${playlist.id}`,
                                  icon: "share",
                                  label: "Поделиться",
                                  onSelect: () =>
                                    copyEntityLink(
                                      `/playlist/${playlist.id}`,
                                      "Ссылка на плейлист скопирована.",
                                      "Скопируй ссылку на плейлист:"
                                    ),
                                },
                                {
                                  id: `remove-saved-playlist-${playlist.id}`,
                                  icon: "remove",
                                  label: "Убрать из моей музыки",
                                  tone: "danger",
                                  onSelect: () => handleToggleSavedPlaylist(playlist.id),
                                },
                              ],
                            })
                          }
                        >
                          <FiMoreHorizontal />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {canToggleSavedPlaylists ? (
                  <button
                    type="button"
                    className={styles.playlistToggleButton}
                    onClick={() => setShowAllSavedPlaylists((value) => !value)}
                  >
                    {showAllSavedPlaylists ? "Свернуть" : "Показать все"}
                  </button>
                ) : null}
              </>
            ) : (
              <div className={styles.sectionState}>
                <ResourceState
                  title="Пока нет сохраненных плейлистов"
                  description="Открывай публичные плейлисты и добавляй их в свою музыку кнопкой нравится."
                  actionLabel="Перейти в поиск"
                  onAction={() => navigate("/search")}
                />
              </div>
            )}
          </section>

        </>
      ) : null}

      <ModalDialog
        open={createDialogOpen}
        title="Создать плейлист"
        description="Название, описание, обложка и видимость для нового плейлиста."
        onClose={() => setCreateDialogOpen(false)}
        actions={
          <>
            <button
              type="button"
              className={styles.dialogGhostButton}
              onClick={() => setCreateDialogOpen(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogPrimaryButton}
              onClick={handleCreatePlaylist}
              disabled={createCoverUploading}
            >
              Создать
            </button>
          </>
        }
      >
        <div className={styles.dialogField}>
          <label htmlFor="create-playlist-title" className={styles.dialogLabel}>Название</label>
          <input
            id="create-playlist-title"
            className={styles.dialogInput}
            value={createForm.title}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Название плейлиста"
            maxLength={80}
          />
        </div>
        <div className={styles.dialogField}>
          <label htmlFor="create-playlist-description" className={styles.dialogLabel}>Описание</label>
          <textarea
            id="create-playlist-description"
            className={styles.dialogTextarea}
            value={createForm.description}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Например: любимый вечерний вайб"
            maxLength={280}
          />
        </div>
        <div className={styles.dialogField}>
          <span className={styles.dialogLabel}>Видимость</span>
          <div className={styles.dialogVisibilityGroup}>
            <button
              type="button"
              className={`${styles.dialogVisibilityButton} ${!createForm.isPublic ? styles.dialogVisibilityButtonActive : ""}`.trim()}
              onClick={() => setCreateForm((prev) => ({ ...prev, isPublic: false }))}
            >
              Только я
            </button>
            <button
              type="button"
              className={`${styles.dialogVisibilityButton} ${createForm.isPublic ? styles.dialogVisibilityButtonActive : ""}`.trim()}
              onClick={() => setCreateForm((prev) => ({ ...prev, isPublic: true }))}
            >
              Публичный
            </button>
          </div>
          <p className={styles.dialogHint}>Публичный плейлист можно открыть по ссылке и сохранить в библиотеку.</p>
        </div>
        <div className={styles.dialogField}>
          <span className={styles.dialogLabel}>Обложка</span>
          <div
            className={styles.dialogCoverPreview}
            style={{ background: createForm.cover || DEFAULT_PLAYLIST_COVER }}
          />
          <div className={styles.dialogCoverActions}>
            <label className={styles.dialogFileButton}>
              {createCoverUploading ? "Обрабатываем..." : "Загрузить изображение"}
              <input
                className={styles.dialogFileInput}
                type="file"
                accept="image/*"
                disabled={createCoverUploading}
                onChange={handleCreateCoverChange}
              />
            </label>
            <button
              type="button"
              className={styles.dialogGhostButton}
              disabled={!createForm.cover || createCoverUploading}
              onClick={() => setCreateForm((prev) => ({ ...prev, cover: "" }))}
            >
              Сбросить
            </button>
          </div>
          <p className={styles.dialogHint}>JPG/PNG/WebP, до 5 МБ.</p>
        </div>
      </ModalDialog>

      <ModalDialog
        open={editDialog.open}
        title="Редактировать плейлист"
        description={editDialog.playlist ? `Плейлист: ${editDialog.playlist.title}` : ""}
        onClose={() => setEditDialog({ open: false, playlist: null, title: "", description: "", cover: "", isPublic: false })}
        actions={
          <>
            <button
              type="button"
              className={styles.dialogGhostButton}
              onClick={() => setEditDialog({ open: false, playlist: null, title: "", description: "", cover: "", isPublic: false })}
            >
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogPrimaryButton}
              onClick={handleUpdatePlaylist}
              disabled={editCoverUploading}
            >
              Сохранить
            </button>
          </>
        }
      >
        <div className={styles.dialogField}>
          <label htmlFor="edit-playlist-title" className={styles.dialogLabel}>Название</label>
          <input
            id="edit-playlist-title"
            className={styles.dialogInput}
            value={editDialog.title}
            onChange={(event) => setEditDialog((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Название плейлиста"
            maxLength={80}
          />
        </div>
        <div className={styles.dialogField}>
          <label htmlFor="edit-playlist-description" className={styles.dialogLabel}>Описание</label>
          <textarea
            id="edit-playlist-description"
            className={styles.dialogTextarea}
            value={editDialog.description}
            onChange={(event) => setEditDialog((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Описание плейлиста"
            maxLength={280}
          />
        </div>
        <div className={styles.dialogField}>
          <span className={styles.dialogLabel}>Видимость</span>
          <div className={styles.dialogVisibilityGroup}>
            <button
              type="button"
              className={`${styles.dialogVisibilityButton} ${!editDialog.isPublic ? styles.dialogVisibilityButtonActive : ""}`.trim()}
              onClick={() => setEditDialog((prev) => ({ ...prev, isPublic: false }))}
            >
              Только я
            </button>
            <button
              type="button"
              className={`${styles.dialogVisibilityButton} ${editDialog.isPublic ? styles.dialogVisibilityButtonActive : ""}`.trim()}
              onClick={() => setEditDialog((prev) => ({ ...prev, isPublic: true }))}
            >
              Публичный
            </button>
          </div>
          <p className={styles.dialogHint}>Публичный плейлист доступен по ссылке и виден в сохранениях.</p>
        </div>
        <div className={styles.dialogField}>
          <span className={styles.dialogLabel}>Обложка</span>
          <div
            className={styles.dialogCoverPreview}
            style={{ background: editDialog.cover || DEFAULT_PLAYLIST_COVER }}
          />
          <div className={styles.dialogCoverActions}>
            <label className={styles.dialogFileButton}>
              {editCoverUploading ? "Обрабатываем..." : "Загрузить изображение"}
              <input
                className={styles.dialogFileInput}
                type="file"
                accept="image/*"
                disabled={editCoverUploading}
                onChange={handleEditCoverChange}
              />
            </label>
            <button
              type="button"
              className={styles.dialogGhostButton}
              disabled={!editDialog.cover || editCoverUploading}
              onClick={() => setEditDialog((prev) => ({ ...prev, cover: "" }))}
            >
              Сбросить
            </button>
          </div>
          <p className={styles.dialogHint}>JPG/PNG/WebP, до 5 МБ.</p>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(deleteDialogPlaylist)}
        title="Удалить плейлист?"
        description={
          deleteDialogPlaylist
            ? `Плейлист "${deleteDialogPlaylist.title}" будет удален без возможности восстановления.`
            : ""
        }
        onClose={() => setDeleteDialogPlaylist(null)}
        actions={
          <>
            <button
              type="button"
              className={styles.dialogGhostButton}
              onClick={() => setDeleteDialogPlaylist(null)}
            >
              Отмена
            </button>
            <button type="button" className={styles.dialogDangerButton} onClick={handleDeletePlaylist}>
              Удалить
            </button>
          </>
        }
      />
      <CardActionMenu menuState={cardMenuState} onClose={closeCardMenu} />
      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
