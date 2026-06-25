import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiBell,
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiChevronUp,
  FiCloudRain,
  FiCoffee,
  FiHeadphones,
  FiHeart,
  FiMoreHorizontal,
  FiMoon,
  FiMusic,
  FiRadio,
  FiSun,
  FiTarget,
  FiTrendingUp,
  FiX,
  FiZap,
} from "react-icons/fi";
import { BsFillPauseFill, BsFillPlayFill, BsHeartFill } from "react-icons/bs";
import { LuHeart } from "react-icons/lu";
import { useEffect, useRef, useState } from "react";
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
import { COMMON_MUSIC_GENRES } from "../../shared/musicGenres.js";
import CardActionMenu from "../components/CardActionMenu.jsx";
import useCardActionMenu from "../hooks/useCardActionMenu.js";

const genreLabelOverrides = new Map([
  ["edm", "EDM"],
  ["hip-hop", "Hip-Hop"],
  ["j-pop", "J-Pop"],
  ["j-rock", "J-Rock"],
  ["k-pop", "K-Pop"],
  ["lo-fi", "Lo-Fi"],
  ["r&b", "R&B"],
  ["uk garage", "UK Garage"],
]);

const homeGenreAliases = new Map([
  ["рок", "rock"],
  ["трэп", "trap"],
  ["трэп метал", "trap metal"],
]);

function normalizeHomeGenreAliasKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function resolveHomeGenreValue(value) {
  const rawValue = String(value ?? "").trim();
  const normalizedValue = normalizeHomeGenreAliasKey(rawValue);
  const looseValue = normalizedValue.replace(/-/g, " ");
  return homeGenreAliases.get(normalizedValue) ?? homeGenreAliases.get(looseValue) ?? rawValue;
}

function formatHomeGenreLabel(value) {
  const rawValue = resolveHomeGenreValue(value);
  const normalizedValue = rawValue.toLowerCase();
  if (!normalizedValue) {
    return "";
  }
  if (genreLabelOverrides.has(normalizedValue)) {
    return genreLabelOverrides.get(normalizedValue);
  }

  return normalizedValue
    .split(/([\s-]+)/)
    .map((part) => {
      if (/^[\s-]+$/.test(part)) {
        return part;
      }
      return part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part;
    })
    .join("");
}

function normalizeHomeGenreKey(value) {
  return resolveHomeGenreValue(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function collectTrackGenreKeys(track) {
  const values = [track?.genre, ...(Array.isArray(track?.tags) ? track.tags : [])];
  return new Set(values.map((value) => normalizeHomeGenreKey(value)).filter(Boolean));
}

function getHomeMoodTracks(mood, tracks = []) {
  const moodGenreKeys = new Set(mood.genres.map((genre) => normalizeHomeGenreKey(genre)).filter(Boolean));

  return tracks.filter((track) => {
    const trackGenreKeys = collectTrackGenreKeys(track);
    return [...trackGenreKeys].some((genreKey) => moodGenreKeys.has(genreKey));
  });
}

const actionIcons = {
  wave: FiRadio,
  new: FiTrendingUp,
  energy: FiZap,
};
const releaseDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});
const HOME_GENRE_PREVIEW_LIMIT = 18;
const HOME_MOOD_GROUPS = [
  {
    id: "calm",
    label: "Спокойное",
    icon: FiCoffee,
    accent: "#8ed7ff",
    glow: "rgba(142, 215, 255, 0.32)",
    wash: "rgba(142, 215, 255, 0.13)",
    genres: ["ambient", "lo-fi", "neo-soul", "piano", "folk", "dream pop", "classical", "minimal"],
  },
  {
    id: "sad",
    label: "Грустное",
    icon: FiCloudRain,
    accent: "#aab9ff",
    glow: "rgba(170, 185, 255, 0.32)",
    wash: "rgba(170, 185, 255, 0.13)",
    genres: ["emo", "blues", "shoegaze", "post-punk", "indie rock", "screamo", "soul"],
  },
  {
    id: "bright",
    label: "Бодрое",
    icon: FiSun,
    accent: "#ffdf5a",
    glow: "rgba(255, 223, 90, 0.34)",
    wash: "rgba(255, 223, 90, 0.15)",
    genres: ["dance", "edm", "house", "techno", "hyperpop", "pop", "synth-pop", "electro", "trap"],
  },
  {
    id: "dark",
    label: "Мрачное",
    icon: FiMoon,
    accent: "#ff6f8f",
    glow: "rgba(255, 111, 143, 0.32)",
    wash: "rgba(255, 111, 143, 0.13)",
    genres: [
      "dark ambient",
      "death metal",
      "industrial",
      "industrial metal",
      "phonk",
      "horrorcore",
      "metal",
      "nu metal",
      "trap metal",
    ],
  },
  {
    id: "romantic",
    label: "Романтичное",
    icon: FiHeart,
    accent: "#ff9fba",
    glow: "rgba(255, 159, 186, 0.32)",
    wash: "rgba(255, 159, 186, 0.13)",
    genres: ["r&b", "neo-soul", "soul", "pop", "indie pop", "dream pop", "jazz"],
  },
  {
    id: "focus",
    label: "Фокус",
    icon: FiTarget,
    accent: "#8ef0bd",
    glow: "rgba(142, 240, 189, 0.3)",
    wash: "rgba(142, 240, 189, 0.13)",
    genres: ["ambient", "minimal", "deep house", "classical", "soundtrack", "lo-fi", "piano"],
  },
  {
    id: "party",
    label: "Вечеринка",
    icon: FiZap,
    accent: "#ff985f",
    glow: "rgba(255, 152, 95, 0.34)",
    wash: "rgba(255, 152, 95, 0.14)",
    genres: ["trap", "dancehall", "reggaeton", "bass", "dubstep", "uk garage", "tech house", "drum and bass"],
  },
];

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
  const { user, isAuthenticated } = useAuth();
  const loadHomeFeed = useCallback(() => fetchHomeFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadHomeFeed);

  const {
    trackMap,
    currentTrack,
    currentTrackId,
    progressSec,
    durationLabel,
    queue,
    queueSource,
    waveQueue,
    playTrack,
    playQueue,
    togglePlay,
    likedIds,
    savedPlaylistIds,
    isPlaying,
    notify,
    togglePlaylistSave,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();
  const {
    menuState: cardMenuState,
    openCardMenu,
    closeCardMenu,
  } = useCardActionMenu();
  const lastWaveQueueRef = useRef([]);
  const releaseRailRef = useRef(null);
  const moodPopoverRef = useRef(null);
  const [showAllHomeGenres, setShowAllHomeGenres] = useState(false);
  const [selectedHomeMoodId, setSelectedHomeMoodId] = useState("");
  const [isMoodMenuOpen, setIsMoodMenuOpen] = useState(false);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return "Доброй ночи";
    if (hour < 12) return "Доброе утро";
    if (hour < 18) return "Добрый день";
    return "Добрый вечер";
  }, []);
  const greetingName = user?.displayName ?? user?.username ?? "гость";
  const releaseNotifications = Array.isArray(data?.releaseNotifications) ? data.releaseNotifications : [];
  const parsedReleaseNotificationWindowDays = Number(data?.releaseNotificationWindowDays ?? 14);
  const releaseNotificationWindowDays = Number.isFinite(parsedReleaseNotificationWindowDays)
    ? parsedReleaseNotificationWindowDays
    : 14;
  const catalogState = data?.catalogState ?? {};
  const updatedArtistCount = new Set(releaseNotifications.map((item) => item.artistId).filter(Boolean)).size;
  const homeGenreTags = useMemo(() => {
    const seenGenres = new Set();

    return [...(data?.vibeTags ?? []), ...COMMON_MUSIC_GENRES]
      .map((genre) => formatHomeGenreLabel(genre))
      .filter((genre) => {
        const normalizedGenre = genre.toLowerCase();
        if (!normalizedGenre || seenGenres.has(normalizedGenre)) {
          return false;
        }
        seenGenres.add(normalizedGenre);
        return true;
      });
  }, [data?.vibeTags]);
  const selectedHomeMood = HOME_MOOD_GROUPS.find((mood) => mood.id === selectedHomeMoodId) ?? null;
  const activeHomeGenreTags = selectedHomeMood
    ? selectedHomeMood.genres.map((genre) => formatHomeGenreLabel(genre)).filter(Boolean)
    : homeGenreTags;
  const visibleHomeGenreTags = showAllHomeGenres
    ? activeHomeGenreTags
    : activeHomeGenreTags.slice(0, HOME_GENRE_PREVIEW_LIMIT);
  const hiddenHomeGenreCount = Math.max(0, activeHomeGenreTags.length - HOME_GENRE_PREVIEW_LIMIT);
  const canToggleHomeGenres = activeHomeGenreTags.length > HOME_GENRE_PREVIEW_LIMIT;

  const freshTracks = useMemo(
    () => (data?.freshTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.freshTrackIds, trackMap]
  );
  const catalogTracks = useMemo(() => Object.values(trackMap).filter((track) => track?.id), [trackMap]);
  const moodTrackCounts = useMemo(
    () =>
      HOME_MOOD_GROUPS.reduce((counts, mood) => {
        counts[mood.id] = getHomeMoodTracks(mood, catalogTracks).length;
        return counts;
      }, {}),
    [catalogTracks]
  );
  const freshTrackColumns = useMemo(() => {
    const midpoint = Math.ceil(freshTracks.length / 2);
    return [freshTracks.slice(0, midpoint), freshTracks.slice(midpoint)].filter((column) => column.length);
  }, [freshTracks]);
  const isCompactCatalog = Boolean(catalogState.sparseCatalog);
  const visibleTrackCount = Number(catalogState.visibleTracks ?? freshTracks.length);
  const isCatalogEmpty = status === "success" && visibleTrackCount === 0 && !releaseNotifications.length;
  const waveButtonDisabled = !isCatalogEmpty && !catalogTracks.length;
  const ActiveMoodIcon = selectedHomeMood?.icon ?? FiMusic;
  const selectedHomeMoodTrackCount = selectedHomeMood ? moodTrackCounts[selectedHomeMood.id] ?? 0 : catalogTracks.length;
  const moodButtonStyle = {
    "--mood-accent": selectedHomeMood?.accent ?? "#f5cc46",
    "--mood-glow": selectedHomeMood?.glow ?? "rgba(245, 204, 70, 0.32)",
    "--mood-wash": selectedHomeMood?.wash ?? "rgba(245, 204, 70, 0.14)",
  };
  const isCurrentTrackFinished =
    Boolean(currentTrack?.durationSec) && progressSec >= Math.max(currentTrack.durationSec - 0.25, 0);
  const isWavePlaybackActive = queueSource === "wave" && waveQueue.length > 0 && !isCurrentTrackFinished;

  useEffect(() => {
    lastWaveQueueRef.current = [];
  }, [likedIds]);

  useEffect(() => {
    if (!isMoodMenuOpen || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (moodPopoverRef.current?.contains(event.target)) {
        return;
      }
      setIsMoodMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsMoodMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMoodMenuOpen]);

  const buildHomeWavePlan = useCallback(
    () =>
      buildWaveQueuePlan(catalogTracks, {
        likedTrackIds: likedIds,
        limit: Math.min(catalogTracks.length, 18),
      }),
    [catalogTracks, likedIds]
  );

  const handleWaveAction = useCallback(() => {
    if (isWavePlaybackActive) {
      togglePlay();
      return;
    }

    if (!catalogTracks.length) {
      notify("В каталоге пока нет треков для запуска Моей волны.");
      return;
    }

    if (
      queue.length &&
      (queueSource === "wave" || areTrackQueuesEqual(queue, lastWaveQueueRef.current)) &&
      !isCurrentTrackFinished
    ) {
      togglePlay();
      return;
    }

    const waveQueuePlan = buildHomeWavePlan();
    if (!waveQueuePlan.trackIds.length) {
      notify("Не удалось собрать Мою волну. Попробуй чуть позже.");
      return;
    }

    lastWaveQueueRef.current = waveQueuePlan.trackIds;
    playQueue(waveQueuePlan.trackIds, waveQueuePlan.startIndex, { source: "wave" });
  }, [buildHomeWavePlan, catalogTracks.length, isCurrentTrackFinished, isWavePlaybackActive, notify, playQueue, queue, queueSource, togglePlay]);

  const handleMoodSelect = useCallback(
    (mood) => {
      const moodTracks = getHomeMoodTracks(mood, catalogTracks);

      setSelectedHomeMoodId(mood.id);
      setShowAllHomeGenres(false);
      setIsMoodMenuOpen(false);

      if (!moodTracks.length) {
        notify(`Пока нет треков под настроение «${mood.label}».`);
        return;
      }

      const moodQueuePlan = buildWaveQueuePlan(moodTracks, {
        likedTrackIds: likedIds,
        limit: Math.min(moodTracks.length, 18),
      });

      if (!moodQueuePlan.trackIds.length) {
        notify(`Пока нет треков под настроение «${mood.label}».`);
        return;
      }

      playQueue(moodQueuePlan.trackIds, moodQueuePlan.startIndex);
      notify(`Запускаю настроение: ${mood.label}.`);
    },
    [catalogTracks, likedIds, notify, playQueue]
  );

  const handleMoodReset = useCallback(() => {
    setSelectedHomeMoodId("");
    setShowAllHomeGenres(false);
    setIsMoodMenuOpen(false);
  }, []);

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

  const handleTogglePlaylistSave = useCallback(
    async (playlistId) => {
      const normalizedPlaylistId = String(playlistId ?? "").trim();
      if (!normalizedPlaylistId) {
        return;
      }

      if (!isAuthenticated) {
        notify("Войди в аккаунт, чтобы сохранять плейлисты в свою музыку.");
        navigate("/profile");
        return;
      }

      await togglePlaylistSave(normalizedPlaylistId);
    },
    [isAuthenticated, navigate, notify, togglePlaylistSave]
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
                {isWavePlaybackActive && isPlaying ? <BsFillPauseFill /> : <BsFillPlayFill />}
                {isCatalogEmpty ? "Перейти в поиск" : isWavePlaybackActive && isPlaying ? "Пауза" : "Слушать волну"}
              </button>
              {!isCatalogEmpty ? (
                <div className={styles.moodPopoverAnchor} ref={moodPopoverRef}>
                  <button
                    type="button"
                    className={`${styles.moodHeroButton} ${
                      selectedHomeMood ? styles.moodHeroButtonActive : ""
                    }`.trim()}
                    style={moodButtonStyle}
                    aria-haspopup="listbox"
                    aria-expanded={isMoodMenuOpen}
                    aria-controls="home-mood-menu"
                    aria-label={
                      selectedHomeMood
                        ? `Настроение: ${selectedHomeMood.label}, ${selectedHomeMoodTrackCount} ${trackWord(
                            selectedHomeMoodTrackCount
                          )}`
                        : "Выбрать настроение"
                    }
                    onClick={() => setIsMoodMenuOpen((current) => !current)}
                  >
                    <span className={styles.moodHeroButtonIcon}>
                      <ActiveMoodIcon aria-hidden="true" />
                    </span>
                    <span className={styles.moodHeroButtonText}>
                      <span className={styles.moodHeroButtonLabel}>Настроение</span>
                      <span className={styles.moodHeroButtonValue}>{selectedHomeMood?.label ?? "Выбрать"}</span>
                    </span>
                    {isMoodMenuOpen ? <FiChevronUp aria-hidden="true" /> : <FiChevronDown aria-hidden="true" />}
                  </button>

                  {isMoodMenuOpen ? (
                    <div className={styles.moodMenuWrap} id="home-mood-menu">
                      <div className={styles.moodMenuHeader}>
                        <div>
                          <span className={styles.moodRailLabel}>Mood Engine</span>
                          <p className={styles.moodMenuTitle}>
                            {selectedHomeMood ? `Активно: ${selectedHomeMood.label}` : "Выбери настроение"}
                          </p>
                        </div>
                        <span className={styles.moodTrackBadge}>
                          {selectedHomeMoodTrackCount} {trackWord(selectedHomeMoodTrackCount)}
                        </span>
                      </div>
                      <div className={styles.moodOptionGrid} role="listbox" aria-label="Настроение">
                        {HOME_MOOD_GROUPS.map((mood) => {
                          const isActiveMood = mood.id === selectedHomeMoodId;
                          const MoodIcon = mood.icon;
                          const moodTrackCount = moodTrackCounts[mood.id] ?? 0;
                          return (
                            <button
                              key={mood.id}
                              type="button"
                              role="option"
                              aria-selected={isActiveMood}
                              aria-label={`${mood.label}: ${moodTrackCount} ${trackWord(moodTrackCount)}`}
                              className={`${styles.moodOptionButton} ${
                                isActiveMood ? styles.moodOptionButtonActive : ""
                              }`.trim()}
                              style={{
                                "--mood-accent": mood.accent,
                                "--mood-glow": mood.glow,
                                "--mood-wash": mood.wash,
                              }}
                              onClick={() => handleMoodSelect(mood)}
                            >
                              <span className={styles.moodOptionIcon}>
                                <MoodIcon aria-hidden="true" />
                              </span>
                              <span className={styles.moodOptionBody}>
                                <span className={styles.moodOptionTitle}>{mood.label}</span>
                                <span className={styles.moodOptionMeta}>
                                  {moodTrackCount} {trackWord(moodTrackCount)}
                                </span>
                              </span>
                              <span className={styles.moodOptionSignal}>
                                {isActiveMood ? <FiCheck aria-hidden="true" /> : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedHomeMood ? (
                        <button type="button" className={styles.moodResetButton} onClick={handleMoodReset}>
                          <FiX aria-hidden="true" />
                          <span>All genres</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button type="button" className={styles.secondaryButton} onClick={() => navigate("/library")}>
                Открыть библиотеку
              </button>
            </div>

            {!isCatalogEmpty ? (
              <div className={styles.genreArea}>
                <div
                  className={`${styles.vibeRow} ${showAllHomeGenres ? styles.vibeRowExpanded : ""}`.trim()}
                  aria-label={selectedHomeMood ? "Selected mood genres" : "Genres"}
                >
                  {visibleHomeGenreTags.map((tag) => (
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
                  {canToggleHomeGenres ? (
                    <button
                      type="button"
                      className={styles.vibeToggleButton}
                      aria-expanded={showAllHomeGenres}
                      onClick={() => setShowAllHomeGenres((current) => !current)}
                    >
                      {showAllHomeGenres ? (
                        <>
                          Collapse
                          <FiChevronUp />
                        </>
                      ) : (
                        <>
                          More {hiddenHomeGenreCount}
                          <FiChevronDown />
                        </>
                      )}
                    </button>
                  ) : null}
                </div>
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
                <button
                  type="button"
                  className={styles.sectionTitleButton}
                  onClick={() => navigate("/releases")}
                >
                  <h2 className={styles.sectionHeading}>Новые релизы</h2>
                  <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
                </button>
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
                        Здесь показываются релизы, опубликованные за последние {releaseNotificationWindowDays} дней.
                        Если ты подписан на артистов, их релизы поднимаются выше в этом блоке.
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
                            <FiMusic />
                            К артисту
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <ResourceState
                  title="Пока нет свежих релизов"
                  description={`Здесь появляются релизы за последние ${releaseNotificationWindowDays} дней, а более старые автоматически уходят из блока.`}
                  actionLabel="Перейти в поиск"
                  onAction={() => navigate("/search")}
                />
              )}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Быстрый старт</h2>
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
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>{isCompactCatalog ? "Доступно прямо сейчас" : "Свежие подборки"}</h2>
              </div>
              <div className={styles.showcaseGrid}>
                {(data?.showcases ?? []).map((item) => {
                  const primaryTrackId = item.trackIds?.[0] ?? null;
                  const playlistId = item.playlistId ?? "";
                  const isPlaylistSaved = playlistId ? savedPlaylistIds.includes(playlistId) : false;

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
                        {primaryTrackId || playlistId ? (
                          <>
                            {primaryTrackId ? (
                              <button
                                type="button"
                                className={styles.cardActionButton}
                                aria-label="Слушать трек"
                                onClick={() => playTrack(primaryTrackId)}
                              >
                                <BsFillPlayFill />
                              </button>
                            ) : null}
                            {playlistId ? (
                              <button
                                type="button"
                                className={`${styles.cardActionButton} ${styles.cardActionButtonLike} ${isPlaylistSaved ? styles.cardActionButtonLiked : ""}`.trim()}
                                aria-label={isPlaylistSaved ? "Убрать плейлист из моей музыки" : "Сохранить плейлист"}
                                aria-pressed={isPlaylistSaved}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleTogglePlaylistSave(playlistId);
                                }}
                              >
                                <span className={styles.cardActionHeartOutline} aria-hidden="true">
                                  <LuHeart />
                                </span>
                                <span className={styles.cardActionHeartFilled} aria-hidden="true">
                                  <BsHeartFill />
                                </span>
                              </button>
                            ) : null}
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
