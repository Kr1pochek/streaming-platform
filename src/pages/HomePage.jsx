import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiArrowRight,
  FiBell,
  FiChevronRight,
  FiHeadphones,
  FiHeart,
  FiMoreHorizontal,
  FiMusic,
  FiPlay,
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
  new: FiTrendingUp,
  energy: FiZap,
};
const releaseDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});

function trackWord(count) {
  const safeCount = Math.max(0, Number(count ?? 0));
  const remainder100 = safeCount % 100;
  const remainder10 = safeCount % 10;
  if (remainder100 >= 11 && remainder100 <= 14) {
    return "треков";
  }
  if (remainder10 === 1) {
    return "трек";
  }
  if (remainder10 >= 2 && remainder10 <= 4) {
    return "трека";
  }
  return "треков";
}

function releaseWord(count) {
  const safeCount = Math.max(0, Number(count ?? 0));
  const remainder100 = safeCount % 100;
  const remainder10 = safeCount % 10;
  if (remainder100 >= 11 && remainder100 <= 14) {
    return "релизов";
  }
  if (remainder10 === 1) {
    return "релиз";
  }
  if (remainder10 >= 2 && remainder10 <= 4) {
    return "релиза";
  }
  return "релизов";
}

function formatReleaseDateLabel(timestamp) {
  const value = Number(timestamp ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "Свежий релиз";
  }
  return `Обновлено ${releaseDateFormatter.format(value)}`;
}

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
    playQueue,
    togglePlay,
    likedIds,
    isPlaying,
    toggleLikeTrack,
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
  const catalogState = data?.catalogState ?? {};
  const updatedArtistCount = new Set(releaseNotifications.map((item) => item.artistId).filter(Boolean)).size;

  const freshTracks = useMemo(
    () => (data?.freshTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.freshTrackIds, trackMap]
  );
  const freshTrackColumns = useMemo(() => {
    const midpoint = Math.ceil(freshTracks.length / 2);
    return [freshTracks.slice(0, midpoint), freshTracks.slice(midpoint)].filter((column) => column.length);
  }, [freshTracks]);
  const isCompactCatalog = Boolean(catalogState.sparseCatalog);
  const visibleTrackCount = Number(catalogState.visibleTracks ?? freshTracks.length);

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
              {isCompactCatalog
                ? `Сейчас в каталоге ${visibleTrackCount} ${trackWord(visibleTrackCount)}. Главная автоматически собирает живые подборки из того, что уже доступно.`
                : "Сегодня в фокусе подборки, быстрые действия и свежие релизы, синхронизированные с плеером."}
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
                <button
                  key={tag}
                  type="button"
                  className={styles.vibeTag}
                  onClick={() => navigate("/search", { state: { initialQuery: tag } })}
                >
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

        {status === "success" && isCompactCatalog ? (
          <section className={styles.catalogNotice}>
            <p className={styles.catalogNoticeTitle}>Каталог работает в компактном режиме</p>
            <p className={styles.catalogNoticeText}>
              Витрина, поиск и плейлисты уже адаптированы под маленькое количество треков, так что приложение можно
              спокойно показывать и наполнять дальше.
            </p>
          </section>
        ) : null}

        {status === "success" && !sectionsEmpty ? (
          <>
            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Новые релизы</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              {releaseNotifications.length ? (
                <div className={styles.releaseHub}>
                  <div className={styles.releaseHubHeader}>
                    <div className={styles.releaseHubCopy}>
                      <p className={styles.releaseHubEyebrow}>
                        <FiBell />
                        Лента обновлений
                      </p>
                      <p className={styles.releaseHubText}>
                        Здесь показываются свежие опубликованные релизы каталога. Если ты подписан на артистов, их
                        релизы поднимаются выше в этом блоке.
                      </p>
                    </div>
                    <div className={styles.releaseHubStats}>
                      <span className={styles.releaseHubStat}>
                        <strong>{releaseNotifications.length}</strong> {releaseWord(releaseNotifications.length)}
                      </span>
                      <span className={styles.releaseHubStat}>
                        <strong>{updatedArtistCount}</strong> артистов обновились
                      </span>
                    </div>
                  </div>

                  <div className={styles.releaseCardGrid}>
                    {releaseNotifications.map((item) => (
                      <article
                        key={item.id}
                        className={styles.releaseFeedCard}
                        style={{ "--release-cover": item.cover }}
                      >
                        <button
                          className={styles.releaseFeedMainButton}
                          type="button"
                          onClick={() => navigate(`/release/${item.releaseId}`)}
                        >
                          <span className={styles.releaseFeedVisual}>
                            <span className={styles.releaseFeedGlow} aria-hidden="true" />
                            <span className={styles.releaseFeedCover} style={{ background: item.cover }} />
                          </span>
                          <span className={styles.releaseFeedMeta}>
                            <span className={styles.releaseFeedBadgeRow}>
                              <span className={styles.releaseFeedBadge}>{String(item.type ?? "").toUpperCase()}</span>
                              <span className={styles.releaseFeedBadge}>{formatReleaseDateLabel(item.publishedAt)}</span>
                            </span>
                            <span className={styles.releaseFeedTitle}>{item.title}</span>
                            <span className={styles.releaseFeedSubtitle}>
                              {item.artistName} • {item.year}
                            </span>
                            <span className={styles.releaseFeedCaption}>
                              {item.trackIds?.length ?? 0} {trackWord(item.trackIds?.length ?? 0)}
                            </span>
                          </span>
                        </button>
                        <div className={styles.releaseFeedActions}>
                          {item.trackIds?.length ? (
                            <button
                              type="button"
                              className={styles.releaseFeedPrimaryButton}
                              onClick={() => playQueue(item.trackIds, 0)}
                            >
                              <FiPlay />
                              Слушать
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={styles.releaseFeedSecondaryButton}
                            onClick={() => navigate(`/artist/${item.artistId}`)}
                          >
                            <FiArrowRight />
                            К артисту
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <ResourceState
                  title="Пока нет опубликованных релизов"
                  description="Когда в каталоге появятся опубликованные релизы, они сразу покажутся в этом блоке."
                  actionLabel="Перейти в поиск"
                  onAction={() => navigate("/search")}
                />
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Быстрый старт</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.actionGrid}>
                {(data?.quickActions ?? []).map((item) => {
                  const Icon =
                    item.id === "wave"
                      ? isPlaying
                        ? BsFillPauseFill
                        : BsFillPlayFill
                      : actionIcons[item.id] ?? FiMusic;
                  const onClick =
                    item.id === "new"
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
                <h2 className={styles.sectionHeading}>{isCompactCatalog ? "Доступно прямо сейчас" : "Свежие подборки"}</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.showcaseGrid}>
                {(data?.showcases ?? []).map((item) => (
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
                          aria-label="Открыть меню трека"
                          onClick={(event) => openTrackMenu(event, item.trackIds[0])}
                        >
                          <FiMoreHorizontal />
                        </button>
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>{isCompactCatalog ? "Все доступные треки" : "На волне"}</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div
                className={`${styles.trackGrid} ${freshTrackColumns.length === 1 ? styles.trackGridSingle : ""}`.trim()}
              >
                {freshTrackColumns.map((column, index) => (
                  <TrackColumn
                    key={`fresh-column-${index}`}
                    tracks={column}
                    likedIds={likedIds}
                    currentTrackId={currentTrackId}
                    onPlay={playTrack}
                    onOpenTrackMenu={openTrackMenu}
                    onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                  />
                ))}
              </div>
            </section>
          </>
        ) : null}
      <TrackQueueMenu
        menuState={menuState}
        onAddTrackNext={addTrackToQueueNext}
        onOpenTrack={() => {
          if (menuState?.trackId) {
            navigate(`/track/${menuState.trackId}`);
          }
          closeTrackMenu();
        }}
        onClose={closeTrackMenu}
      />
    </PageShell>
  );
}

function TrackColumn({
  tracks,
  likedIds,
  currentTrackId,
  onPlay,
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
            <span className={styles.trackCover} style={{ background: track.cover }} />
            <span className={styles.trackMeta}>
              <span className={styles.trackTitle}>
                {track.title}
                {likedIds.includes(track.id) ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
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
            aria-label="Открыть меню действий"
            onClick={(event) => onOpenTrackMenu(event, track.id)}
          >
            <FiMoreHorizontal />
          </button>
          <span className={styles.trackTime}>{formatDurationClock(track.durationSec)}</span>
        </li>
      ))}
    </ul>
  );
}


