import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronRight,
  FiClock,
  FiExternalLink,
  FiHeart,
  FiLogOut,
  FiPlus,
  FiSettings,
  FiUpload,
  FiUsers,
} from "react-icons/fi";
import styles from "./ProfilePage.module.css";
import PageShell from "../components/PageShell.jsx";
import usePlayer from "../hooks/usePlayer.js";
import useAuth from "../hooks/useAuth.js";
import ResourceState from "../components/ResourceState.jsx";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import { confirmPasswordReset, requestPasswordReset, uploadTrack } from "../api/musicApi.js";
import ModalDialog from "../components/ModalDialog.jsx";

const UPLOADED_GENRES_STORAGE_PREFIX = "music.profile.uploadedGenres.v1";
const DEFAULT_UPLOAD_TRACK_COVER = "linear-gradient(135deg, #5f739f 0%, #9ab2ff 50%, #22324d 100%)";
const MAX_TRACK_COVER_FILE_SIZE = 5 * 1024 * 1024;
const TRACK_COVER_MAX_SIDE = 640;
const TRACK_COVER_JPEG_QUALITY = 0.74;
const MAX_TRACK_COVER_BACKGROUND_LENGTH = 900_000;

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

async function buildTrackCoverFromFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Выбери файл изображения.");
  }
  if (file.size > MAX_TRACK_COVER_FILE_SIZE) {
    throw new Error("Файл слишком большой. Максимум 5 МБ.");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxSide = Math.max(image.width || 1, image.height || 1);
  const scale = maxSide > TRACK_COVER_MAX_SIDE ? TRACK_COVER_MAX_SIDE / maxSide : 1;
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
  const optimizedDataUrl = canvas.toDataURL("image/jpeg", TRACK_COVER_JPEG_QUALITY);
  if (optimizedDataUrl.length > MAX_TRACK_COVER_BACKGROUND_LENGTH) {
    throw new Error("Изображение слишком тяжелое. Попробуй файл меньшего размера.");
  }

  return `url("${optimizedDataUrl}") center / cover no-repeat`;
}

function getTopGenres(genres = []) {
  const scoreMap = new Map();
  const displayByNormalized = new Map();
  for (const item of genres) {
    const display = String(item ?? "").trim();
    if (!display) continue;
    const normalized = display.toLowerCase();
    if (!displayByNormalized.has(normalized)) {
      displayByNormalized.set(normalized, display);
    }
    scoreMap.set(normalized, (scoreMap.get(normalized) ?? 0) + 1);
  }
  return [...scoreMap.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], "ru"))
    .slice(0, 8)
    .map(([normalized]) => displayByNormalized.get(normalized) ?? normalized);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const {
    status: authStatus,
    user,
    isAuthenticated,
    signIn,
    signUp,
    signOut,
    updateProfile,
    changePassword,
  } = useAuth();
  const {
    artists,
    trackMap,
    likedIds,
    historyIds,
    followedArtistIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    toggleArtistFollow,
    addTrackNext,
    notify,
    refreshCatalog,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const [authMode, setAuthMode] = useState("login");
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
    displayName: "",
  });
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [showResetForm, setShowResetForm] = useState(false);
  const [resetUsername, setResetUsername] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetInfo, setResetInfo] = useState("");
  const [devResetToken, setDevResetToken] = useState("");

  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const uploadAudioInputRef = useRef(null);
  const uploadCoverInputRef = useRef(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    audio: null,
    title: "",
    artist: "",
    trackId: "",
    durationSec: "",
    explicit: false,
    genre: "",
    cover: "",
    tags: "",
  });
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadCoverProcessing, setUploadCoverProcessing] = useState(false);
  const [uploadCoverFileName, setUploadCoverFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadedTrackId, setUploadedTrackId] = useState("");
  const [uploadedGenres, setUploadedGenres] = useState([]);

  useEffect(() => {
    setProfileDisplayName(user?.displayName ?? user?.username ?? "");
  }, [user?.displayName, user?.username]);

  const historyTracks = useMemo(() => historyIds.map((id) => trackMap[id]).filter(Boolean), [historyIds, trackMap]);
  const uploadedGenresStorageKey = useMemo(() => {
    const userId = String(user?.id ?? "").trim();
    if (!userId) {
      return "";
    }
    return `${UPLOADED_GENRES_STORAGE_PREFIX}.${userId}`;
  }, [user?.id]);

  useEffect(() => {
    if (!uploadedGenresStorageKey) {
      setUploadedGenres([]);
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(uploadedGenresStorageKey);
      if (!raw) {
        setUploadedGenres([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setUploadedGenres([]);
        return;
      }
      setUploadedGenres(
        parsed
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
          .slice(0, 400)
      );
    } catch {
      setUploadedGenres([]);
    }
  }, [uploadedGenresStorageKey]);

  useEffect(() => {
    if (!uploadedGenresStorageKey || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(uploadedGenresStorageKey, JSON.stringify(uploadedGenres.slice(0, 400)));
    } catch {
      // noop
    }
  }, [uploadedGenresStorageKey, uploadedGenres]);

  const favoriteGenres = useMemo(() => getTopGenres(uploadedGenres), [uploadedGenres]);

  const followedArtists = useMemo(() => {
    const followedSet = new Set(followedArtistIds);
    return (artists ?? []).filter((artist) => followedSet.has(artist.id));
  }, [artists, followedArtistIds]);

  const recommendations = useMemo(() => {
    const excluded = new Set([...likedIds, ...historyIds]);
    return Object.values(trackMap).filter((track) => !excluded.has(track.id)).slice(0, 4);
  }, [trackMap, likedIds, historyIds]);

  const totalHistoryDuration = useMemo(
    () => historyTracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0),
    [historyTracks]
  );

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (authSubmitting) {
      return;
    }

    setAuthError("");
    setAuthSubmitting(true);
    try {
      if (authMode === "register") {
        await signUp({
          username: credentials.username,
          password: credentials.password,
          displayName: credentials.displayName,
        });
      } else {
        await signIn({
          username: credentials.username,
          password: credentials.password,
        });
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не удалось выполнить авторизацию.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRequestResetToken = async () => {
    if (resetSubmitting) {
      return;
    }

    const username = resetUsername.trim();
    if (!username) {
      setResetError("Укажи логин.");
      return;
    }

    setResetSubmitting(true);
    setResetError("");
    setResetInfo("");
    setDevResetToken("");
    try {
      const response = await requestPasswordReset({ username });
      const nextToken = String(response?.resetToken ?? "").trim();
      setResetInfo("Если аккаунт существует, токен восстановления создан.");
      if (nextToken) {
        setDevResetToken(nextToken);
        setResetToken(nextToken);
      }
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Не удалось запросить сброс пароля.");
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    if (resetSubmitting) {
      return;
    }

    const username = resetUsername.trim();
    const token = resetToken.trim();
    if (!username || !token || !resetPassword) {
      setResetError("Заполни логин, токен и новый пароль.");
      return;
    }

    setResetSubmitting(true);
    setResetError("");
    setResetInfo("");
    try {
      await confirmPasswordReset({
        username,
        token,
        newPassword: resetPassword,
      });
      notify("Пароль изменен. Теперь войди с новым паролем.");
      setShowResetForm(false);
      setAuthMode("login");
      setCredentials((prev) => ({ ...prev, username, password: "", displayName: "" }));
      setResetUsername("");
      setResetToken("");
      setResetPassword("");
      setDevResetToken("");
      setResetInfo("");
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Не удалось обновить пароль.");
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleUpdateProfile = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || profileSubmitting) {
      return;
    }

    const displayName = profileDisplayName.trim();
    if (!displayName) {
      setProfileError("Имя профиля не может быть пустым.");
      return;
    }

    setProfileSubmitting(true);
    setProfileError("");
    try {
      await updateProfile({ displayName });
      notify("Профиль обновлен.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Не удалось обновить профиль.");
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || passwordSubmitting) {
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError("Заполни все поля пароля.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Новый пароль и подтверждение не совпадают.");
      return;
    }

    setPasswordSubmitting(true);
    setPasswordError("");
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      notify("Пароль обновлен.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Не удалось изменить пароль.");
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleOpenAccountDialog = () => {
    setProfileError("");
    setPasswordError("");
    setAccountDialogOpen(true);
  };

  const handleCloseAccountDialog = () => {
    setProfileError("");
    setPasswordError("");
    setAccountDialogOpen(false);
  };

  const handleOpenUploadDialog = () => {
    setUploadError("");
    setUploadDialogOpen(true);
  };

  const handleCloseUploadDialog = () => {
    if (uploadSubmitting || uploadCoverProcessing) {
      return;
    }
    setUploadError("");
    setUploadDialogOpen(false);
  };

  const handleUploadFieldChange = (field, value) => {
    setUploadForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSelectUploadAudioFile = () => {
    uploadAudioInputRef.current?.click();
  };

  const handleSelectUploadCoverFile = () => {
    uploadCoverInputRef.current?.click();
  };

  const handleUploadAudioFileChange = (event) => {
    const nextFile = event.target.files?.[0] ?? null;
    handleUploadFieldChange("audio", nextFile);
  };

  const handleUploadCoverFileChange = async (event) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      return;
    }

    setUploadError("");
    setUploadCoverProcessing(true);
    try {
      const nextCover = await buildTrackCoverFromFile(nextFile);
      handleUploadFieldChange("cover", nextCover);
      setUploadCoverFileName(nextFile.name);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Не удалось обработать изображение.");
      if (uploadCoverInputRef.current) {
        uploadCoverInputRef.current.value = "";
      }
    } finally {
      setUploadCoverProcessing(false);
    }
  };

  const handleClearUploadCover = () => {
    if (uploadSubmitting || uploadCoverProcessing) {
      return;
    }
    handleUploadFieldChange("cover", "");
    setUploadCoverFileName("");
    if (uploadCoverInputRef.current) {
      uploadCoverInputRef.current.value = "";
    }
  };

  const handleUploadTrack = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || uploadSubmitting) {
      return;
    }

    const title = uploadForm.title.trim();
    const artist = uploadForm.artist.trim();
    const genre = uploadForm.genre.trim();

    if (!uploadForm.audio) {
      setUploadError("Выбери аудиофайл.");
      return;
    }
    if (!title || !artist) {
      setUploadError("Название и исполнитель обязательны.");
      return;
    }
    if (!genre) {
      setUploadError("Жанр обязателен.");
      return;
    }
    if (uploadCoverProcessing) {
      setUploadError("Дождись завершения обработки обложки.");
      return;
    }

    setUploadSubmitting(true);
    setUploadError("");
    setUploadedTrackId("");

    try {
      const duration = Number.parseInt(String(uploadForm.durationSec ?? "").trim(), 10);
      const normalizedGenre = genre.toLowerCase();
      const customTags = String(uploadForm.tags ?? "")
        .split(/[,\n]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const tags = Array.from(new Set([normalizedGenre, ...customTags]));

      const response = await uploadTrack({
        audio: uploadForm.audio,
        title,
        artist,
        trackId: uploadForm.trackId.trim() || undefined,
        durationSec: Number.isFinite(duration) ? duration : undefined,
        explicit: uploadForm.explicit,
        cover: uploadForm.cover.trim() || undefined,
        tags: tags.join(","),
      });

      const nextTrackId = String(response?.track?.id ?? "").trim();
      setUploadedGenres((prev) => [genre, ...prev].slice(0, 400));
      setUploadForm({
        audio: null,
        title: "",
        artist: "",
        trackId: "",
        durationSec: "",
        explicit: false,
        genre: "",
        cover: "",
        tags: "",
      });
      if (uploadAudioInputRef.current) {
        uploadAudioInputRef.current.value = "";
      }
      if (uploadCoverInputRef.current) {
        uploadCoverInputRef.current.value = "";
      }
      setUploadCoverFileName("");

      if (nextTrackId) {
        setUploadedTrackId(nextTrackId);
      }
      notify("Трек успешно загружен.");
      try {
        await refreshCatalog({ silent: true });
      } catch {
        // keep successful upload result even if catalog refresh fails
      }
      setUploadDialogOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Не удалось загрузить трек.");
    } finally {
      setUploadSubmitting(false);
    }
  };

  const changeCredentials = (field, value) => {
    setCredentials((prev) => ({ ...prev, [field]: value }));
  };

  if (authStatus === "loading" && !isAuthenticated) {
    return (
      <PageShell>
        <ResourceState loading title="Проверяем сессию" description="Подключаем профиль и предпочтения." />
      </PageShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <PageShell>
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Авторизация</h2>
          </div>

          {!showResetForm ? (
            <form className={styles.authForm} onSubmit={handleAuthSubmit}>
              <p className={styles.subtitle}>
                {authMode === "register"
                  ? "Создай аккаунт, чтобы синхронизировать лайки, подписки и историю."
                  : "Войди, чтобы продолжить прослушивание с теми же лайками и плейлистами."}
              </p>

              <label className={styles.authLabel}>
                Логин
                <input
                  className={styles.authInput}
                  value={credentials.username}
                  onChange={(event) => changeCredentials("username", event.target.value)}
                  minLength={3}
                  maxLength={32}
                  required
                />
              </label>

              <label className={styles.authLabel}>
                Пароль
                <input
                  className={styles.authInput}
                  type="password"
                  value={credentials.password}
                  onChange={(event) => changeCredentials("password", event.target.value)}
                  minLength={6}
                  maxLength={128}
                  required
                />
              </label>

              {authMode === "register" ? (
                <label className={styles.authLabel}>
                  Отображаемое имя
                  <input
                    className={styles.authInput}
                    value={credentials.displayName}
                    onChange={(event) => changeCredentials("displayName", event.target.value)}
                    maxLength={48}
                  />
                </label>
              ) : null}

              {authError ? <p className={styles.authError}>{authError}</p> : null}
              <div className={styles.authActions}>
                <button type="submit" className={styles.authPrimaryButton} disabled={authSubmitting}>
                  {authSubmitting ? "Подключаем..." : authMode === "register" ? "Создать аккаунт" : "Войти"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setAuthMode((prev) => (prev === "register" ? "login" : "register"));
                    setAuthError("");
                  }}
                >
                  {authMode === "register" ? "У меня уже есть аккаунт" : "Создать новый аккаунт"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setShowResetForm(true);
                    setResetError("");
                    setResetInfo("");
                    setDevResetToken("");
                  }}
                >
                  Забыли пароль?
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.authForm}>
              <p className={styles.subtitle}>
                Запроси токен восстановления, затем введи его и новый пароль.
              </p>

              <label className={styles.authLabel}>
                Логин
                <input
                  className={styles.authInput}
                  value={resetUsername}
                  onChange={(event) => setResetUsername(event.target.value)}
                  minLength={3}
                  maxLength={32}
                />
              </label>

              <label className={styles.authLabel}>
                Токен восстановления
                <input
                  className={styles.authInput}
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                />
              </label>

              <label className={styles.authLabel}>
                Новый пароль
                <input
                  className={styles.authInput}
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  minLength={6}
                  maxLength={128}
                />
              </label>

              {devResetToken ? <p className={styles.authError}>Dev token: {devResetToken}</p> : null}
              {resetInfo ? <p className={styles.subtitle}>{resetInfo}</p> : null}
              {resetError ? <p className={styles.authError}>{resetError}</p> : null}

              <div className={styles.authActions}>
                <button
                  type="button"
                  className={styles.authPrimaryButton}
                  disabled={resetSubmitting}
                  onClick={handleRequestResetToken}
                >
                  {resetSubmitting ? "Запрашиваем..." : "Получить токен"}
                </button>

                <button
                  type="button"
                  className={styles.authPrimaryButton}
                  disabled={resetSubmitting}
                  onClick={handleConfirmReset}
                >
                  {resetSubmitting ? "Сохраняем..." : "Сменить пароль"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setShowResetForm(false);
                    setResetError("");
                    setResetInfo("");
                    setDevResetToken("");
                  }}
                >
                  Назад ко входу
                </button>
              </div>
            </div>
          )}
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Профиль</h1>
          <p className={styles.subtitle}>
            {user?.displayName ?? user?.username ?? "Пользователь"}: подписки, история и музыкальные предпочтения.
          </p>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.statsRow}>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Подписок</span>
              <strong className={styles.statValue}>{followedArtists.length}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>История</span>
              <strong className={styles.statValue}>{historyTracks.length}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Время прослушивания</span>
              <strong className={styles.statValue}>{formatDurationClock(totalHistoryDuration)}</strong>
            </article>
          </div>
          <div className={styles.controlRow}>
            <button type="button" className={styles.actionButton} onClick={handleOpenAccountDialog}>
              <FiSettings />
              Настройки аккаунта
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.uploadActionButton}`.trim()}
              onClick={handleOpenUploadDialog}
            >
              <FiUpload />
              Загрузить трек
            </button>
            <button type="button" className={styles.logoutButton} onClick={signOut}>
              <FiLogOut />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionTitleRow}>
          <h2 className={styles.sectionTitle}>Подписки</h2>
          <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
        </div>
        {followedArtists.length ? (
          <div className={styles.artistGrid}>
            {followedArtists.map((artist) => (
              <article key={artist.id} className={styles.artistCard}>
                <button
                  type="button"
                  className={styles.artistMainButton}
                  onClick={() => navigate(`/artist/${artist.id}`)}
                >
                  <span className={styles.artistAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                  <span className={styles.artistMeta}>
                    <span className={styles.artistName}>{artist.name}</span>
                    <span className={styles.artistFollowers}>
                      <FiUsers />
                      {artist.followers}
                    </span>
                  </span>
                </button>
                <div className={styles.artistActions}>
                  <button
                    type="button"
                    className={styles.artistActionButton}
                    onClick={() => navigate(`/artist/${artist.id}`)}
                  >
                    <FiExternalLink />
                    Открыть
                  </button>
                  <button
                    type="button"
                    className={`${styles.artistActionButton} ${styles.artistUnfollowButton}`.trim()}
                    onClick={() => toggleArtistFollow(artist.id)}
                  >
                    Отписаться
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.subscriptionsEmpty}>
            <ResourceState
              title="Пока нет подписок"
              description="Открой страницу исполнителя и нажми «Подписаться»."
              actionLabel="Перейти в поиск"
              onAction={() => navigate("/search")}
            />
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitleRow}>
          <h2 className={styles.sectionTitle}>История</h2>
          <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
        </div>
        {historyTracks.length ? (
          <ul className={styles.trackList}>
            {historyTracks.map((track) => {
              const isActive = currentTrackId === track.id;
              const liked = likedIds.includes(track.id);
              return (
                <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
                  <button
                    type="button"
                    className={styles.trackMain}
                    onClick={() => playTrack(track.id)}
                    onContextMenu={(event) => openTrackMenu(event, track.id)}
                  >
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
                    <span className={styles.trackDuration}>
                      <FiClock />
                      {formatDurationClock(track.durationSec)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${liked ? styles.iconButtonActive : ""}`.trim()}
                    onClick={() => toggleLikeTrack(track.id)}
                    aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                  >
                    <FiHeart />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => addTrackNext(track.id)}
                    aria-label="Добавить далее в очередь"
                  >
                    <FiPlus />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ResourceState
            title="История пуста"
            description="Запусти несколько треков из поиска или плейлистов."
            actionLabel="Открыть поиск"
            onAction={() => navigate("/search")}
          />
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitleRow}>
          <h2 className={styles.sectionTitle}>Любимые жанры</h2>
        </div>
        {favoriteGenres.length ? (
          <div className={styles.genreRow}>
            {favoriteGenres.map((genre) => (
              <span key={genre} className={styles.genreChip}>
                {genre}
              </span>
            ))}
          </div>
        ) : (
          <p className={styles.emptyText}>Жанры появятся после загрузки треков с указанным жанром.</p>
        )}
      </section>

      {!followedArtists.length && !historyTracks.length ? (
        <SmartRecommendations
          title="Для старта профиля"
          tracks={recommendations}
          onPlayTrack={playTrack}
          onLikeTrack={toggleLikeTrack}
          onOpenTrack={(trackId) => navigate(`/track/${trackId}`)}
        />
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />

      <ModalDialog
        open={accountDialogOpen}
        title="Настройки аккаунта"
        description="Смена отображаемого имени и пароля."
        onClose={handleCloseAccountDialog}
      >
        <form className={`${styles.authForm} ${styles.modalForm}`.trim()} onSubmit={handleUpdateProfile}>
          <label className={styles.authLabel}>
            Отображаемое имя
            <input
              className={styles.authInput}
              value={profileDisplayName}
              onChange={(event) => setProfileDisplayName(event.target.value)}
              maxLength={48}
            />
          </label>
          {profileError ? <p className={styles.authError}>{profileError}</p> : null}
          <div className={styles.authActions}>
            <button type="submit" className={styles.authPrimaryButton} disabled={profileSubmitting}>
              {profileSubmitting ? "Сохраняем..." : "Сохранить профиль"}
            </button>
          </div>
        </form>

        <form className={`${styles.authForm} ${styles.modalForm}`.trim()} onSubmit={handleChangePassword}>
          <label className={styles.authLabel}>
            Текущий пароль
            <input
              className={styles.authInput}
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
              }
              minLength={6}
              maxLength={128}
            />
          </label>
          <label className={styles.authLabel}>
            Новый пароль
            <input
              className={styles.authInput}
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              minLength={6}
              maxLength={128}
            />
          </label>
          <label className={styles.authLabel}>
            Подтверждение нового пароля
            <input
              className={styles.authInput}
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
              }
              minLength={6}
              maxLength={128}
            />
          </label>
          {passwordError ? <p className={styles.authError}>{passwordError}</p> : null}
          <div className={styles.authActions}>
            <button type="submit" className={styles.authPrimaryButton} disabled={passwordSubmitting}>
              {passwordSubmitting ? "Сохраняем..." : "Изменить пароль"}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={uploadDialogOpen}
        title="Загрузка трека"
        description="Заполни данные трека и укажи жанр. Этот жанр попадет в любимые жанры профиля."
        onClose={handleCloseUploadDialog}
      >
        <form className={`${styles.authForm} ${styles.modalForm}`.trim()} onSubmit={handleUploadTrack}>
          <label className={styles.authLabel}>
            Аудиофайл
            <input
              ref={uploadAudioInputRef}
              className={styles.fileInputHidden}
              type="file"
              accept="audio/*"
              onChange={handleUploadAudioFileChange}
            />
            <div className={styles.filePickerRow}>
              <button type="button" className={styles.filePickerButton} onClick={handleSelectUploadAudioFile}>
                Выбрать файл
              </button>
              <span className={styles.filePickerText}>
                {uploadForm.audio ? uploadForm.audio.name : "Файл не выбран"}
              </span>
            </div>
          </label>

          <div className={styles.uploadGrid}>
            <label className={styles.authLabel}>
              Название
              <input
                className={styles.authInput}
                value={uploadForm.title}
                maxLength={120}
                required
                onChange={(event) => handleUploadFieldChange("title", event.target.value)}
              />
            </label>

            <label className={styles.authLabel}>
              Исполнитель
              <input
                className={styles.authInput}
                value={uploadForm.artist}
                maxLength={160}
                required
                onChange={(event) => handleUploadFieldChange("artist", event.target.value)}
              />
            </label>

            <label className={styles.authLabel}>
              Жанр
              <input
                className={styles.authInput}
                value={uploadForm.genre}
                maxLength={40}
                required
                placeholder="Например, synthwave"
                onChange={(event) => handleUploadFieldChange("genre", event.target.value)}
              />
            </label>

            <label className={styles.authLabel}>
              Track ID (опционально)
              <input
                className={styles.authInput}
                value={uploadForm.trackId}
                maxLength={80}
                onChange={(event) => handleUploadFieldChange("trackId", event.target.value)}
              />
            </label>

            <label className={styles.authLabel}>
              Длительность, сек (опционально)
              <input
                className={styles.authInput}
                type="number"
                min={1}
                step={1}
                value={uploadForm.durationSec}
                onChange={(event) => handleUploadFieldChange("durationSec", event.target.value)}
              />
            </label>

            <div className={styles.coverUploadBlock}>
              <p className={styles.coverUploadTitle}>Обложка (опционально)</p>
              <div className={styles.coverUploadLayout}>
                <span
                  className={styles.coverPreview}
                  style={{ background: uploadForm.cover || DEFAULT_UPLOAD_TRACK_COVER }}
                />
                <div className={styles.coverUploadControls}>
                  <input
                    ref={uploadCoverInputRef}
                    className={styles.fileInputHidden}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadCoverFileChange}
                  />
                  <div className={styles.coverUploadButtons}>
                    <button
                      type="button"
                      className={styles.filePickerButton}
                      disabled={uploadCoverProcessing}
                      onClick={handleSelectUploadCoverFile}
                    >
                      {uploadCoverProcessing ? "Обрабатываем..." : "Загрузить обложку"}
                    </button>
                    <button
                      type="button"
                      className={styles.authSecondaryButton}
                      disabled={!uploadForm.cover || uploadCoverProcessing}
                      onClick={handleClearUploadCover}
                    >
                      Удалить
                    </button>
                  </div>
                  <p className={styles.filePickerText}>{uploadCoverFileName || "JPG/PNG/WebP, до 5 МБ"}</p>
                </div>
              </div>
            </div>
          </div>

          <label className={styles.authLabel}>
            Доп. теги (через запятую, опционально)
            <input
              className={styles.authInput}
              value={uploadForm.tags}
              maxLength={240}
              placeholder="night, driving"
              onChange={(event) => handleUploadFieldChange("tags", event.target.value)}
            />
          </label>

          <label className={styles.uploadCheckbox}>
            <input
              type="checkbox"
              checked={uploadForm.explicit}
              onChange={(event) => handleUploadFieldChange("explicit", event.target.checked)}
            />
            Explicit
          </label>

          <p className={styles.uploadHint}>Трек появится в каталоге после загрузки и обновления данных плеера.</p>

          {uploadError ? <p className={styles.authError}>{uploadError}</p> : null}
          {uploadedTrackId ? <p className={styles.uploadSuccess}>Загружено: {uploadedTrackId}</p> : null}

          <div className={styles.authActions}>
            <button
              type="submit"
              className={styles.authPrimaryButton}
              disabled={uploadSubmitting || uploadCoverProcessing}
            >
              {uploadSubmitting ? "Загружаем..." : "Загрузить трек"}
            </button>
            <button
              type="button"
              className={styles.authSecondaryButton}
              disabled={uploadSubmitting || uploadCoverProcessing}
              onClick={handleCloseUploadDialog}
            >
              Закрыть
            </button>
          </div>
        </form>
      </ModalDialog>
    </PageShell>
  );
}
