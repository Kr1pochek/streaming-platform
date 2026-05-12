import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiArrowRight,
  FiBell,
  FiChevronLeft,
  FiChevronRight,
  FiHeadphones,
  FiHeart,
  FiMoreHorizontal,
  FiMusic,
  FiRadio,
  FiTrendingUp,
  FiZap,
} from "react-icons/fi";
import { BsFillPauseFill, BsFillPlayFill, BsHeartFill } from "react-icons/bs";
import { LuHeart } from "react-icons/lu";
import { useEffect, useRef } from "react";
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
import { buildWaveQueuePlan } from "../../shared/waveRecommendations.js";
import CardActionMenu from "../components/CardActionMenu.jsx";
import useCardActionMenu from "../hooks/useCardActionMenu.js";

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

function areTrackQueuesEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((trackId, index) => trackId === right[index]);
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
    queue,
    playTrack,
    playQueue,
    togglePlay,
    likedIds,
    isPlaying,
    notify,
    toggleLikeTrack,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();
  const {
    menuState: cardMenuState,
    openCardMenu,
    closeCardMenu,
  } = useCardActionMenu();
  const lastWaveQueueRef = useRef([]);
  const releaseRailRef = useRef(null);

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
  const catalogTracks = useMemo(() => Object.values(trackMap).filter((track) => track?.id), [trackMap]);
  const freshTrackColumns = useMemo(() => {
    const midpoint = Math.ceil(freshTracks.length / 2);
    return [freshTracks.slice(0, midpoint), freshTracks.slice(midpoint)].filter((column) => column.length);
  }, [freshTracks]);
  const isCompactCatalog = Boolean(catalogState.sparseCatalog);
  const visibleTrackCount = Number(catalogState.visibleTracks ?? freshTracks.length);
  const isCatalogEmpty = status === "success" && visibleTrackCount === 0 && !releaseNotifications.length;
  const waveButtonDisabled = !isCatalogEmpty && !catalogTracks.length;
  const isCurrentTrackFinished =
    Boolean(currentTrack?.durationSec) && progressSec >= Math.max(currentTrack.durationSec - 0.25, 0);

  useEffect(() => {
    lastWaveQueueRef.current = [];
  }, [likedIds]);

  const buildHomeWavePlan = useCallback(
    () =>
      buildWaveQueuePlan(catalogTracks, {
        likedTrackIds: likedIds,
        limit: Math.min(catalogTracks.length, 18),
      }),
    [catalogTracks, likedIds]
  );

  const handleWaveAction = useCallback(() => {
    if (isPlaying) {
      togglePlay();
      return;
    }

    if (!catalogTracks.length) {
      notify("В каталоге пока нет треков для запуска Моей волны.");
      return;
    }

    if (queue.length && areTrackQueuesEqual(queue, lastWaveQueueRef.current) && !isCurrentTrackFinished) {
      togglePlay();
      return;
    }

    const waveQueuePlan = buildHomeWavePlan();
    if (!waveQueuePlan.trackIds.length) {
      notify("Не удалось собрать Мою волну. Попробуй чуть позже.");
      return;
    }

    lastWaveQueueRef.current = waveQueuePlan.trackIds;
    playQueue(waveQueuePlan.trackIds, waveQueuePlan.startIndex);
  }, [buildHomeWavePlan, catalogTracks.length, isCurrentTrackFinished, isPlaying, notify, playQueue, queue, togglePlay]);

  const scrollReleaseRail = useCallback((direction) => {
    const rail = releaseRailRef.current;
    if (!rail) {
      return;
    }

    const offset = Math.max(rail.clientWidth * 0.82, 280);
    rail.scrollBy({
      left: offset * direction,
      behavior: "smooth",
    });
  }, []);

  const copyPlaylistLink = useCallback(
    async (playlistId) => {
      if (!playlistId || typeof window === "undefined") {
        return;
      }

      const absoluteUrl = new URL(`/playlist/${playlistId}`, window.location.origin).toString();
      try {
        if (!navigator?.clipboard?.writeText) {
          throw new Error("clipboard-unavailable");
        }
        await navigator.clipboard.writeText(absoluteUrl);
        notify("Ссылка на плейлист скопирована.");
      } catch {
        window.prompt("Скопируй ссылку на плейлист:", absoluteUrl);
      }
    },
    [notify]
  );

  const openShowcaseMenu = useCallback(
    (event, item) => {
      const playlistId = item?.playlistId ?? null;
      if (!playlistId) {
        return;
      }

      openCardMenu(event, {
        title: item.title ?? "Подборка",
        subtitle: `${item.trackIds?.length ?? 0} треков`,
        actions: [
          {
            id: `open-showcase-${playlistId}`,
            icon: "open",
            label: "Открыть плейлист",
            onSelect: () => navigate(`/playlist/${playlistId}`),
          },
          {
            id: `share-showcase-${playlistId}`,
            icon: "share",
            label: "Поделиться",
            onSelect: () => copyPlaylistLink(playlistId),
          },
        ],
      });
    },
    [copyPlaylistLink, navigate, openCardMenu]
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

            <h1 className={styles.heroTitle}>
              {isCatalogEmpty ? "Каталог пока пуст." : "Музыка, которая попадает в настроение."}
            </h1>
            <p className={styles.heroSubtitle}>
              {isCatalogEmpty
                ? "Демо-контент уже удалён. Когда добавишь новые треки, здесь появятся подборки, релизы и персональная витрина."
                : isCompactCatalog
                ? `Сейчас в каталоге ${visibleTrackCount} ${trackWord(visibleTrackCount)}. Главная автоматически собирает живые подборки из того, что уже доступно.`
                : "Сегодня в фокусе подборки, быстрые действия и свежие релизы, синхронизированные с плеером."}
            </p>

            <div className={styles.heroActions}>
              <button
                type="button"
                className={styles.primaryButton}
                data-testid="home-wave-button"
                disabled={waveButtonDisabled}
                onClick={isCatalogEmpty ? () => navigate("/search") : handleWaveAction}
              >
                {isCatalogEmpty ? <FiArrowRight /> : isPlaying ? <BsFillPauseFill /> : <BsFillPlayFill />}
                {isCatalogEmpty ? "Перейти в поиск" : isPlaying ? "Пауза" : "Слушать волну"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate("/library")}>
                Открыть библиотеку
                <FiArrowRight />
              </button>
            </div>

            {!isCatalogEmpty ? (
              <div className={styles.vibeRow}>
                {(data?.vibeTags ?? []).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={styles.vibeTag}
                    data-testid="home-vibe-tag"
                    onClick={() => navigate("/search", { state: { initialQuery: tag } })}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
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
            description="Добавь новые треки в проект, и главная автоматически начнёт собирать витрину и рекомендации."
            actionLabel="Перейти в поиск"
            onAction={() => navigate("/search")}
          />
        ) : null}

        {status === "success" && isCompactCatalog && !isCatalogEmpty ? (
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
                    <div className={styles.releaseHubHeaderMeta}>
                      <div className={styles.releaseHubStats}>
                        <span className={styles.releaseHubStat}>
                          <strong>{releaseNotifications.length}</strong> {releaseWord(releaseNotifications.length)}
                        </span>
                        <span className={styles.releaseHubStat}>
                          <strong>{updatedArtistCount}</strong> артистов обновились
                        </span>
                      </div>
                      {releaseNotifications.length > 1 ? (
                        <div className={styles.releaseHubControls}>
                          <button
                            type="button"
                            className={styles.releaseHubControlButton}
                            onClick={() => scrollReleaseRail(-1)}
                            aria-label="Прокрутить релизы влево"
                          >
                            <FiChevronLeft />
                          </button>
                          <button
                            type="button"
                            className={styles.releaseHubControlButton}
                            onClick={() => scrollReleaseRail(1)}
                            aria-label="Прокрутить релизы вправо"
                          >
                            <FiChevronRight />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className={styles.releaseCardGrid} ref={releaseRailRef}>
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
                              <BsFillPlayFill />
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
                      : item.id === "wave"
                        ? handleWaveAction
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
                {(data?.showcases ?? []).map((item) => {
                  const primaryTrackId = item.trackIds?.[0] ?? null;
                  const isPrimaryTrackLiked = primaryTrackId ? likedIds.includes(primaryTrackId) : false;

                  return (
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
                      <span className={styles.cardActions}>
                        {primaryTrackId ? (
                          <>
                            <button
                              type="button"
                              className={styles.cardActionButton}
                              aria-label="Слушать трек"
                              onClick={() => playTrack(primaryTrackId)}
                            >
                              <BsFillPlayFill />
                            </button>
                            <button
                              type="button"
                              className={`${styles.cardActionButton} ${styles.cardActionButtonLike} ${isPrimaryTrackLiked ? styles.cardActionButtonLiked : ""}`.trim()}
                              aria-label={isPrimaryTrackLiked ? "Убрать из избранного" : "Добавить в избранное"}
                              aria-pressed={isPrimaryTrackLiked}
                              onClick={() => toggleLikeTrack(primaryTrackId)}
                            >
                              <span className={styles.cardActionHeartOutline} aria-hidden="true">
                                <LuHeart />
                              </span>
                              <span className={styles.cardActionHeartFilled} aria-hidden="true">
                                <BsHeartFill />
                              </span>
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Меню плейлиста"
                          onClick={(event) => openShowcaseMenu(event, item)}
                        >
                          <FiMoreHorizontal />
                        </button>
                      </span>
                    </article>
                  );
                })}
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
      <CardActionMenu menuState={cardMenuState} onClose={closeCardMenu} />
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


