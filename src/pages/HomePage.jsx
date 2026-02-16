import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiArrowRight,
  FiBell,
  FiChevronRight,
  FiHeadphones,
  FiHeart,
  FiMusic,
  FiPlay,
  FiPlus,
  FiRadio,
  FiTrendingUp,
  FiZap,
} from "react-icons/fi";
import { BsFillPauseFill, BsFillPlayFill } from "react-icons/bs";
import styles from "./HomePage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchHomeFeed } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import useAuth from "../hooks/useAuth.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

const actionIcons = {
  wave: FiRadio,
  liked: FiHeart,
  new: FiTrendingUp,
  energy: FiZap,
};

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const loadHomeFeed = useCallback(() => fetchHomeFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadHomeFeed);

  const {
    trackMap,
    currentTrack,
    currentTrackId,
    progressSec,
    durationLabel,
    playTrack,
    togglePlay,
    likedIds,
    isPlaying,
    toggleLikeTrack,
    addTrackNext,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return "Доброй ночи";
    if (hour < 12) return "Доброе утро";
    if (hour < 18) return "Добрый день";
    return "Добрый вечер";
  }, []);
  const greetingName = user?.displayName ?? user?.username ?? "гость";
  const releaseNotifications = Array.isArray(data?.releaseNotifications) ? data.releaseNotifications : [];

  const freshTracks = useMemo(
    () => (data?.freshTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.freshTrackIds, trackMap]
  );

  const sectionsEmpty =
    status === "success" &&
    !data?.showcases?.length &&
    !freshTracks.length &&
    !releaseNotifications.length;

  return (
    <PageShell>
        <header className={styles.hero}>
          <div className={styles.heroMain}>
            <p className={styles.kicker}>
              <FiHeadphones />
              <span>{greeting}, {greetingName}</span>
            </p>

            <h1 className={styles.heroTitle}>Музыка, которая попадает в настроение.</h1>
            <p className={styles.heroSubtitle}>
              Сегодня в фокусе подборки, быстрые действия и свежие релизы, синхронизированные с плеером.
            </p>

            <div className={styles.heroActions}>
              <button type="button" className={styles.primaryButton} onClick={togglePlay}>
                {isPlaying ? <BsFillPauseFill /> : <BsFillPlayFill />}
                {isPlaying ? "Пауза" : "Слушать волну"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate("/library")}>
                Открыть библиотеку
                <FiArrowRight />
              </button>
            </div>

            <div className={styles.vibeRow}>
              {(data?.vibeTags ?? []).map((tag) => (
                <button key={tag} type="button" className={styles.vibeTag} onClick={() => navigate("/search")}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <aside className={styles.nowCard}>
            <div className={styles.nowCover} style={{ background: currentTrack?.cover }} />
            <div className={styles.nowMeta}>
              <p className={styles.nowLabel}>Сейчас играет</p>
              <h2 className={styles.nowTitle}>{currentTrack?.title ?? "Выбери трек"}</h2>
              {currentTrack?.artist ? (
                <ArtistInlineLinks
                  artistLine={currentTrack.artist}
                  className={styles.nowArtist}
                  linkClassName={styles.nowArtistButton}
                  textClassName={styles.nowArtist}
                  onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                />
              ) : (
                <p className={styles.nowArtist}>Начни с поиска</p>
              )}
              {currentTrack ? (
                <button
                  type="button"
                  className={styles.nowOpenButton}
                  onClick={() => navigate(`/track/${currentTrack.id}`)}
                >
                  Открыть трек
                </button>
              ) : null}
            </div>
            <div className={styles.progressWrap}>
              <span>{formatDurationClock(progressSec)}</span>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width:
                      currentTrack?.durationSec && progressSec
                        ? `${Math.min((progressSec / currentTrack.durationSec) * 100, 100)}%`
                        : "0%",
                  }}
                />
              </div>
              <span>{durationLabel}</span>
            </div>
          </aside>
        </header>

        {status === "loading" ? (
          <ResourceState
            loading
            title="Загружаем главную"
            description="Подтягиваем подборки, быстрые действия и персональные треки."
          />
        ) : null}

        {status === "error" ? (
          <ResourceState title="Не удалось загрузить главную" description={error} actionLabel="Повторить" onAction={reload} />
        ) : null}

        {sectionsEmpty ? (
          <ResourceState
            title="Пока пусто"
            description="Добавь треки в очередь или лайки, чтобы наполнять главную автоматически."
            actionLabel="Перейти в поиск"
            onAction={() => navigate("/search")}
          />
        ) : null}

        {status === "success" && !sectionsEmpty ? (
          <>
            {user?.id ? (
              <section className={styles.section}>
                <div className={styles.sectionTitleRow}>
                  <h2 className={styles.sectionHeading}>Новые релизы по подпискам</h2>
                  <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
                </div>
                {releaseNotifications.length ? (
                  <div className={styles.notificationGrid}>
                    {releaseNotifications.map((item) => (
                      <article key={item.id} className={styles.notificationCard}>
                        <button
                          className={styles.notificationMainButton}
                          type="button"
                          onClick={() => navigate(`/release/${item.releaseId}`)}
                        >
                          <span className={styles.notificationCover} style={{ background: item.cover }} />
                          <span className={styles.notificationMeta}>
                            <span className={styles.notificationTitle}>{item.title}</span>
                            <span className={styles.notificationSubtitle}>
                              {item.artistName} • {String(item.type ?? "").toUpperCase()} • {item.year}
                            </span>
                          </span>
                        </button>
                        <span className={styles.notificationActions}>
                          {item.trackIds?.[0] ? (
                            <button
                              type="button"
                              className={styles.notificationActionButton}
                              aria-label="Слушать релиз"
                              onClick={() => playTrack(item.trackIds[0])}
                            >
                              <FiPlay />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.notificationActionButton}
                            aria-label="Открыть исполнителя"
                            onClick={() => navigate(`/artist/${item.artistId}`)}
                          >
                            <FiBell />
                          </button>
                        </span>
                      </article>
                    ))}
                  </div>
                ) : (
                  <ResourceState
                    title="Пока нет новых релизов"
                    description="Подпишись на артистов, чтобы получать обновления прямо на главной."
                    actionLabel="Перейти в поиск"
                    onAction={() => navigate("/search")}
                  />
                )}
              </section>
            ) : null}

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Быстрый старт</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.actionGrid}>
                {data.quickActions.map((item) => {
                  const Icon =
                    item.id === "wave"
                      ? isPlaying
                        ? BsFillPauseFill
                        : BsFillPlayFill
                      : actionIcons[item.id] ?? FiMusic;
                  const onClick =
                    item.id === "liked"
                      ? () => navigate("/liked")
                      : item.id === "new"
                        ? () => navigate("/search")
                        : item.id === "energy"
                          ? () => freshTracks[0] && playTrack(freshTracks[0].id)
                          : togglePlay;

                  return (
                    <button key={item.id} className={styles.actionCard} type="button" onClick={onClick}>
                      <span className={styles.actionIcon} style={{ background: item.accent }}>
                        <Icon />
                      </span>
                      <span className={styles.actionMeta}>
                        <span className={styles.actionTitle}>{item.title}</span>
                        <span className={styles.actionSubtitle}>{item.subtitle}</span>
                      </span>
                      <FiArrowRight className={styles.actionArrow} />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Свежие подборки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.showcaseGrid}>
                {data.showcases.map((item) => (
                  <article key={item.id} className={styles.showcaseCard}>
                    <button
                      className={styles.showcaseMainButton}
                      type="button"
                      onClick={() => navigate(`/playlist/${item.playlistId ?? "pl-fresh"}`)}
                    >
                      <span className={styles.showcaseCover} style={{ background: item.cover }} />
                      <span className={styles.showcaseTitle}>{item.title}</span>
                      <span className={styles.showcaseSubtitle}>{item.subtitle}</span>
                    </button>
                    {item.trackIds?.[0] ? (
                      <span className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Слушать трек"
                          onClick={() => playTrack(item.trackIds[0])}
                        >
                          <FiPlay />
                        </button>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Лайк"
                          onClick={() => toggleLikeTrack(item.trackIds[0])}
                        >
                          <FiHeart />
                        </button>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Добавить далее"
                          onClick={() => addTrackNext(item.trackIds[0])}
                        >
                          <FiArrowRight />
                        </button>
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>На волне</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.trackGrid}>
                <TrackColumn
                  tracks={freshTracks.slice(0, Math.ceil(freshTracks.length / 2))}
                  likedIds={likedIds}
                  currentTrackId={currentTrackId}
                  onPlay={playTrack}
                  onAddNext={addTrackNext}
                  onOpenTrackMenu={openTrackMenu}
                  onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                />
                <TrackColumn
                  tracks={freshTracks.slice(Math.ceil(freshTracks.length / 2))}
                  likedIds={likedIds}
                  currentTrackId={currentTrackId}
                  onPlay={playTrack}
                  onAddNext={addTrackNext}
                  onOpenTrackMenu={openTrackMenu}
                  onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                />
              </div>
            </section>
          </>
        ) : null}
      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}

function TrackColumn({
  tracks,
  likedIds,
  currentTrackId,
  onPlay,
  onAddNext,
  onOpenTrackMenu,
  onOpenArtist,
}) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => (
        <li
          key={track.id}
          className={`${styles.trackRow} ${currentTrackId === track.id ? styles.trackRowActive : ""}`.trim()}
        >
          <button
            type="button"
            className={styles.trackMainButton}
            onClick={() => onPlay(track.id)}
            onContextMenu={(event) => onOpenTrackMenu(event, track.id)}
          >
            <span className={styles.trackIcon}>
              <FiMusic />
            </span>
            <span className={styles.trackMeta}>
              <span className={styles.trackTitle}>
                {currentTrackId === track.id ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                {track.title}
                {likedIds.includes(track.id) ? <span className={styles.trackLikedDot} aria-hidden="true" /> : null}
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
          </button>
          <button
            type="button"
            className={styles.queueButton}
            aria-label="Добавить далее в очередь"
            onClick={() => onAddNext(track.id)}
          >
            <FiPlus />
          </button>
          <span className={styles.trackTime}>{formatDurationClock(track.durationSec)}</span>
        </li>
      ))}
    </ul>
  );
}


