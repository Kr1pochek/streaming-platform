import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiExternalLink, FiPlus } from "react-icons/fi";
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
import ResourceState from "../components/ResourceState.jsx";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import ModalDialog from "../components/ModalDialog.jsx";

const INITIAL_FOLLOWED_ARTISTS_LIMIT = 6;
const INITIAL_MY_PLAYLISTS_LIMIT = 6;
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
  const loadLibraryFeed = useCallback(() => fetchLibraryFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadLibraryFeed);

  const {
    trackMap,
    followedArtistIds,
    playTrack,
    toggleLikeTrack,
    toggleArtistFollow,
    notify,
  } = usePlayer();

  const [showAllArtists, setShowAllArtists] = useState(false);
  const [showAllPlaylists, setShowAllPlaylists] = useState(false);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createCoverUploading, setCreateCoverUploading] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "Новый плейлист",
    description: "",
    cover: "",
  });

  const [editDialog, setEditDialog] = useState({
    open: false,
    playlist: null,
    title: "",
    description: "",
    cover: "",
  });
  const [editCoverUploading, setEditCoverUploading] = useState(false);

  const [deleteDialogPlaylist, setDeleteDialogPlaylist] = useState(null);

  const playlists = useMemo(() => data?.playlists ?? [], [data?.playlists]);
  const myPlaylists = useMemo(() => playlists.filter((playlist) => playlist.isCustom), [playlists]);

  const canTogglePlaylists = myPlaylists.length > INITIAL_MY_PLAYLISTS_LIMIT;
  const visibleMyPlaylists =
    canTogglePlaylists && !showAllPlaylists
      ? myPlaylists.slice(0, INITIAL_MY_PLAYLISTS_LIMIT)
      : myPlaylists;

  const followedArtists = useMemo(() => {
    const artistsById = new Map((data?.artists ?? []).map((artist) => [artist.id, artist]));
    return followedArtistIds.map((id) => artistsById.get(id)).filter(Boolean);
  }, [data?.artists, followedArtistIds]);

  const canToggleArtists = followedArtists.length > INITIAL_FOLLOWED_ARTISTS_LIMIT;
  const visibleFollowedArtists =
    canToggleArtists && !showAllArtists
      ? followedArtists.slice(0, INITIAL_FOLLOWED_ARTISTS_LIMIT)
      : followedArtists;

  const recommendations = useMemo(() => Object.values(trackMap).slice(0, 4), [trackMap]);
  const isEmpty = status === "success" && !myPlaylists.length && !followedArtists.length;

  const openCreateDialog = () => {
    setCreateForm({
      title: "Новый плейлист",
      description: "",
      cover: "",
    });
    setCreateDialogOpen(true);
  };

  const openEditDialog = (playlist) => {
    setEditDialog({
      open: true,
      playlist,
      title: playlist.title,
      description: descriptionToFormValue(playlist.subtitle),
      cover: String(playlist.cover ?? "").trim(),
    });
  };

  const handleCreatePlaylist = async () => {
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
      });
      setCreateDialogOpen(false);
      setCreateForm({ title: "Новый плейлист", description: "", cover: "" });
      await reload();
      notify("Плейлист создан.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось создать плейлист.");
    }
  };

  const handleUpdatePlaylist = async () => {
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
      });
      setEditDialog({ open: false, playlist: null, title: "", description: "", cover: "" });
      await reload();
      notify("Плейлист обновлен.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось обновить плейлист.");
    }
  };

  const handleDeletePlaylist = async () => {
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

  return (
    <PageShell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Моя музыка</h1>
          <p className={styles.subtitle}>Плейлисты и избранные исполнители в одном месте.</p>
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
        <ResourceState loading title="Загружаем библиотеку" description="Собираем плейлисты и подписки." />
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
            description="Создай первый плейлист или подпишись на исполнителей в поиске."
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
              <h2 className={styles.sectionTitle}>Мои плейлисты</h2>
              <span className={styles.playlistCountBadge}>{myPlaylists.length}</span>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {myPlaylists.length ? (
              <>
                <div className={styles.playlistGrid}>
                  {visibleMyPlaylists.map((playlist) => {
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
                            <p className={styles.playlistSubtitle}>{displayPlaylistDescription(playlist.subtitle)}</p>
                            <p className={styles.playlistCount}>{playlist.trackIds.length} треков</p>
                          </div>
                        </button>
                        <div className={styles.playlistActions}>
                          <button type="button" className={styles.playlistGhostButton} onClick={() => openEditDialog(playlist)}>
                            Редактировать
                          </button>
                          <button
                            type="button"
                            className={`${styles.playlistGhostButton} ${styles.playlistDeleteButton}`.trim()}
                            onClick={() => setDeleteDialogPlaylist(playlist)}
                          >
                            Удалить
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
              <h2 className={styles.sectionTitle}>Мои исполнители</h2>
              <span className={styles.artistCount}>{followedArtists.length}</span>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {followedArtists.length ? (
              <>
                <div className={styles.artistGrid}>
                  {visibleFollowedArtists.map((artist) => (
                    <article key={artist.id} className={styles.artistCard}>
                      <span className={styles.artistAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                      <span className={styles.artistMeta}>
                        <span className={styles.artistName}>{artist.name}</span>
                        <span className={styles.artistFollowers}>{artist.followers} подписчиков</span>
                      </span>
                      <div className={styles.artistActions}>
                        <button
                          type="button"
                          className={styles.artistButton}
                          onClick={() => navigate(`/artist/${artist.id}`)}
                        >
                          <FiExternalLink />
                          Открыть
                        </button>
                        <button
                          type="button"
                          className={`${styles.artistButton} ${styles.artistUnfollowButton}`.trim()}
                          onClick={() => toggleArtistFollow(artist.id)}
                        >
                          Отписаться
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                {canToggleArtists ? (
                  <button
                    type="button"
                    className={styles.artistToggleButton}
                    onClick={() => setShowAllArtists((value) => !value)}
                  >
                    {showAllArtists ? "Свернуть" : "Показать всех"}
                  </button>
                ) : null}
              </>
            ) : (
              <div className={styles.sectionState}>
                <ResourceState
                  title="Нет подписок"
                  description="Подписывайся на исполнителей, и они будут отображаться здесь."
                  actionLabel="Открыть поиск"
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
        description="Название, описание и обложка для нового плейлиста."
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
        onClose={() => setEditDialog({ open: false, playlist: null, title: "", description: "", cover: "" })}
        actions={
          <>
            <button
              type="button"
              className={styles.dialogGhostButton}
              onClick={() => setEditDialog({ open: false, playlist: null, title: "", description: "", cover: "" })}
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
    </PageShell>
  );
}
