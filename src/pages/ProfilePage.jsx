import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiClock, FiExternalLink, FiHeart, FiLogOut, FiPlus, FiUsers } from "react-icons/fi";
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
import { confirmPasswordReset, requestPasswordReset } from "../api/musicApi.js";

function getTopGenres(tracks) {
  const scoreMap = new Map();
  for (const track of tracks) {
    for (const tag of track.tags ?? []) {
      scoreMap.set(tag, (scoreMap.get(tag) ?? 0) + 1);
    }
  }
  return [...scoreMap.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, 8)
    .map(([tag]) => tag);
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

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    setProfileDisplayName(user?.displayName ?? user?.username ?? "");
  }, [user?.displayName, user?.username]);

  const likedTracks = useMemo(() => likedIds.map((id) => trackMap[id]).filter(Boolean), [likedIds, trackMap]);
  const historyTracks = useMemo(() => historyIds.map((id) => trackMap[id]).filter(Boolean), [historyIds, trackMap]);
  const favoriteGenres = useMemo(() => getTopGenres(likedTracks), [likedTracks]);

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
      setResetInfo("Если аккаунт существует, токен восстановление создан.");
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
          <button type="button" className={styles.logoutButton} onClick={signOut}>
            <FiLogOut />
            Выйти
          </button>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionTitleRow}>
          <h2 className={styles.sectionTitle}>Настройки аккаунта</h2>
          <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
        </div>

        <form className={styles.authForm} onSubmit={handleUpdateProfile}>
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

        <form className={styles.authForm} onSubmit={handleChangePassword}>
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
      </section>

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
              <button key={genre} type="button" className={styles.genreTag} onClick={() => navigate("/search")}>
                {genre}
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.emptyText}>Добавь треки в избранное, чтобы профиль собрал твои жанры.</p>
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
    </PageShell>
  );
}
