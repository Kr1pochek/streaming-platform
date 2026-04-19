import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiHome,
  FiList,
  FiMusic,
  FiRepeat,
  FiSearch,
  FiSettings,
  FiShuffle,
  FiSkipBack,
  FiSkipForward,
  FiTrash2,
  FiUser,
  FiVolume2,
  FiVolumeX,
  FiX,
} from "react-icons/fi";
import { BsFillPauseFill, BsFillPlayFill, BsHeartFill } from "react-icons/bs";
import { LuHeart } from "react-icons/lu";
import Sidebar from "./Sidebar.jsx";
import styles from "./AppLayout.module.css";
import usePlayer from "../hooks/usePlayer.js";
import useAuth from "../hooks/useAuth.js";
import ArtistInlineLinks from "./ArtistInlineLinks.jsx";
import UserAvatar from "./UserAvatar.jsx";
import { DEFAULT_PLAYER_PALETTE, resolvePlayerPalette } from "../utils/playerPalette.js";

const STREAM_QUALITY_OPTIONS = [
  {
    value: "auto",
    label: "AUTO",
    hint: "Плеер сам выбирает поток",
  },
  {
    value: "high",
    label: "HIGH",
    hint: "Максимальное качество",
  },
  {
    value: "medium",
    label: "MEDIUM",
    hint: "Баланс качества и скорости",
  },
  {
    value: "low",
    label: "LOW",
    hint: "Стабильнее на медленном интернете",
  },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const {
    currentTrack,
    currentIndex,
    queueTracks,
    isPlaying,
    volume,
    streamQuality,
    progressPercent,
    progressLabel,
    durationLabel,
    isCurrentTrackLiked,
    shuffleEnabled,
    repeatMode,
    togglePlay,
    nextTrack,
    prevTrack,
    setProgressPercent,
    setVolume,
    toggleShuffle,
    cycleRepeatMode,
    jumpToQueueIndex,
    moveQueueItem,
    removeQueueItem,
    clearQueue,
    likeTrack,
    unlikeTrack,
    setStreamQuality,
    toastItems,
    dismissToast,
  } = usePlayer();

  const [queueOpen, setQueueOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [playerPalette, setPlayerPalette] = useState(DEFAULT_PLAYER_PALETTE);
  const [displayProgressPercent, setDisplayProgressPercent] = useState(0);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const queuePanelRef = useRef(null);
  const queueToggleRef = useRef(null);
  const qualityMenuRef = useRef(null);
  const toastTimerMapRef = useRef(new Map());
  const lastNonZeroVolumeRef = useRef(volume > 0 ? volume : 70);
  const visualProgressRef = useRef(0);
  const progressAnchorRef = useRef({
    durationSec: 0,
    percent: 0,
    timeMs: 0,
    trackId: null,
  });
  const hasCurrentTrack = Boolean(currentTrack);

  const repeatEnabled = repeatMode !== "off";
  const accountName = user?.displayName ?? user?.username ?? "Гость";
  const streamQualitySelected = streamQuality?.selected || "auto";
  const fallbackQualityLevelLabel =
    streamQualitySelected === "auto" ? "AUTO" : streamQualitySelected.toUpperCase();
  const streamQualityModeLabel =
    streamQuality?.mode === "manual" ? "MANUAL" : streamQuality?.mode === "auto" ? "AUTO" : "";
  const streamQualityLevelLabel = streamQuality?.level
    ? streamQuality.level.toUpperCase()
    : fallbackQualityLevelLabel;
  const showStreamQuality = Boolean(currentTrack && streamQuality?.available);
  const qualityBadgeLabel = streamQualityModeLabel || "STREAM";
  const canControlStreamQuality = Boolean(streamQuality?.available && streamQuality?.canControl);
  const selectedQualityOption =
    STREAM_QUALITY_OPTIONS.find((option) => option.value === streamQualitySelected) ??
    STREAM_QUALITY_OPTIONS[0];
  const timelineProgressValue = Math.min(
    100,
    Math.max(0, Number.isFinite(progressPercent) ? progressPercent : 0),
  );
  const visualProgressPercent = Math.min(
    100,
    Math.max(0, Number.isFinite(displayProgressPercent) ? displayProgressPercent : 0),
  );
  const progressTailRoundRatio = Math.min(1, Math.max(0, (visualProgressPercent - 97) / 3));
  const progressTailRadiusPx = 4 + progressTailRoundRatio * 18;
  const progressEdgeHighlightOpacity = 0.03 * (1 - progressTailRoundRatio);
  const mobileNavItems = [
    { to: "/", label: "Главная", icon: FiHome, end: true },
    { to: "/search", label: "Поиск", icon: FiSearch },
    { to: "/library", label: "Моя музыка", icon: FiMusic },
    { to: "/profile", label: "Профиль", icon: FiUser },
    ...(user?.isAdmin ? [{ to: "/admin", label: "Админка", icon: FiSettings }] : []),
  ];

  const repeatLabel =
    repeatMode === "one"
      ? "Повтор текущего трека"
      : repeatMode === "all"
        ? "Повтор очереди"
        : "Включить повтор";
  const favoriteLabel = isCurrentTrackLiked ? "Убрать трек из избранного" : "Добавить трек в избранное";
  const playerThemeStyle = {
    "--player-panel": playerPalette.panel,
    "--player-panel-edge": playerPalette.panelEdge,
    "--player-surface-start": playerPalette.surfaceStart,
    "--player-surface-end": playerPalette.surfaceEnd,
    "--player-ambient": playerPalette.ambient,
    "--player-ambient-strong": playerPalette.ambientStrong,
    "--player-border": playerPalette.border,
    "--player-progress-track": playerPalette.progressTrack,
    "--player-progress-fill": playerPalette.progressFill,
    "--player-progress-thumb": playerPalette.progressThumb,
    "--player-progress": `${visualProgressPercent}%`,
    "--player-progress-ratio": `${visualProgressPercent / 100}`,
    "--player-progress-tail-round-ratio": `${progressTailRoundRatio.toFixed(4)}`,
    "--player-progress-tail-radius": `${progressTailRadiusPx.toFixed(2)}px`,
    "--player-progress-edge-highlight-opacity": `${progressEdgeHighlightOpacity.toFixed(4)}`,
  };

  useEffect(() => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
    }
  }, [volume]);

  useEffect(() => {
    visualProgressRef.current = visualProgressPercent;
  }, [visualProgressPercent]);

  useEffect(() => {
    const trackId = currentTrack?.id ?? null;
    const durationSec = currentTrack?.durationSec ?? 0;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const previousAnchor = progressAnchorRef.current;
    const trackChanged = previousAnchor.trackId !== trackId;
    const currentVisual = visualProgressRef.current;

    progressAnchorRef.current = {
      durationSec,
      percent: timelineProgressValue,
      timeMs: now,
      trackId,
    };

    if (
      trackChanged ||
      timelineDragging ||
      !hasCurrentTrack ||
      !isPlaying ||
      durationSec <= 0 ||
      timelineProgressValue < currentVisual - 0.75 ||
      Math.abs(timelineProgressValue - currentVisual) > 1.5
    ) {
      setDisplayProgressPercent(timelineProgressValue);
    }
  }, [currentTrack?.durationSec, currentTrack?.id, hasCurrentTrack, isPlaying, timelineDragging, timelineProgressValue]);

  useEffect(() => {
    if (timelineDragging || !hasCurrentTrack || !isPlaying || !(currentTrack?.durationSec > 0)) {
      return undefined;
    }

    let frameId = 0;

    const animateProgress = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const anchor = progressAnchorRef.current;
      const elapsedSec = Math.max(0, (now - anchor.timeMs) / 1000);
      const predictedPercent = Math.min(100, anchor.percent + (elapsedSec / anchor.durationSec) * 100);

      if (Math.abs(predictedPercent - visualProgressRef.current) >= 0.02) {
        setDisplayProgressPercent(predictedPercent);
      }

      frameId = window.requestAnimationFrame(animateProgress);
    };

    frameId = window.requestAnimationFrame(animateProgress);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentTrack?.durationSec, hasCurrentTrack, isPlaying, timelineDragging]);

  const handleVolumeChange = (nextVolume) => {
    const safeVolume = Number(nextVolume);
    if (Number.isFinite(safeVolume) && safeVolume > 0) {
      lastNonZeroVolumeRef.current = safeVolume;
    }
    setVolume(safeVolume);
  };

  const handleToggleMute = () => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
      setVolume(0);
      return;
    }

    const restoredVolume = Number(lastNonZeroVolumeRef.current);
    setVolume(Number.isFinite(restoredVolume) && restoredVolume > 0 ? restoredVolume : 70);
  };

  const handleToggleCurrentLike = () => {
    if (!currentTrack) {
      return;
    }

    if (isCurrentTrackLiked) {
      unlikeTrack(currentTrack.id);
      return;
    }

    likeTrack(currentTrack.id);
  };

  useEffect(() => {
    if (!queueOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (queuePanelRef.current?.contains(target) || queueToggleRef.current?.contains(target)) {
        return;
      }

      setQueueOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [queueOpen]);

  useEffect(() => {
    if (!qualityMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (qualityMenuRef.current?.contains(target)) {
        return;
      }

      setQualityMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setQualityMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [qualityMenuOpen]);

  useEffect(() => {
    if (!currentTrack || !streamQuality?.available) {
      setQualityMenuOpen(false);
    }
  }, [currentTrack, streamQuality?.available]);

  useEffect(() => {
    for (const toast of toastItems) {
      if (toastTimerMapRef.current.has(toast.id)) {
        continue;
      }
      const timeoutId = setTimeout(() => {
        dismissToast(toast.id);
      }, 2600);
      toastTimerMapRef.current.set(toast.id, timeoutId);
    }

    const visibleToastIds = new Set(toastItems.map((toast) => toast.id));
    for (const [toastId, timeoutId] of toastTimerMapRef.current.entries()) {
      if (!visibleToastIds.has(toastId)) {
        clearTimeout(timeoutId);
        toastTimerMapRef.current.delete(toastId);
      }
    }
  }, [toastItems, dismissToast]);

  useEffect(
    () => () => {
      for (const timeoutId of toastTimerMapRef.current.values()) {
        clearTimeout(timeoutId);
      }
      toastTimerMapRef.current.clear();
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const syncPlayerPalette = async () => {
      const nextPalette = await resolvePlayerPalette(currentTrack?.cover);
      if (!cancelled) {
        setPlayerPalette(nextPalette);
      }
    };

    void syncPlayerPalette();

    return () => {
      cancelled = true;
    };
  }, [currentTrack?.cover]);

  return (
    <div className={styles.appShell}>
      <div className={styles.sidebar}>
        <Sidebar />
      </div>

      <main className={styles.main}>
        <div className={styles.mobileNavWrap}>
          <div className={styles.mobileTopRow}>
            <div className={styles.mobileBrand}>
              <span className={styles.mobileBrandLogo}>♪</span>
              <span className={styles.mobileBrandText}>
                <span className={styles.mobileBrandTitle}>MusicApp</span>
                <span className={styles.mobileBrandSub}>стриминг платформа</span>
              </span>
            </div>
            <button
              type="button"
              className={styles.mobileAccountButton}
              aria-label={isAuthenticated ? "Открыть профиль" : "Войти или зарегистрироваться"}
              onClick={() => navigate("/profile")}
            >
              {isAuthenticated ? (
                <UserAvatar avatarUrl={user?.avatarUrl} name={accountName} className={styles.mobileAccountAvatar} />
              ) : (
                <FiUser />
              )}
            </button>
          </div>
          <nav className={styles.mobileNav} aria-label="Быстрая навигация">
            {mobileNavItems.map((item) => {
              const NavIcon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `${styles.mobileNavItem} ${isActive ? styles.mobileNavItemActive : ""}`.trim()
                  }
                >
                  <NavIcon />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className={styles.content}>
          <Outlet />
        </div>

        {queueOpen ? (
          <aside ref={queuePanelRef} className={styles.queuePanel} aria-label="Очередь воспроизведения">
            <header className={styles.queueHeader}>
              <div>
                <h2 className={styles.queueTitle}>Очередь</h2>
                <p className={styles.queueSubtitle}>{queueTracks.length} треков</p>
              </div>
              <div className={styles.queueHeaderActions}>
                <button
                  type="button"
                  className={styles.queueClearButton}
                  aria-label="Очистить очередь"
                  disabled={!queueTracks.length}
                  onClick={clearQueue}
                >
                  <FiTrash2 />
                </button>
                <button
                  type="button"
                  className={styles.queueCloseButton}
                  aria-label="Закрыть очередь"
                  onClick={() => setQueueOpen(false)}
                >
                  <FiX />
                </button>
              </div>
            </header>
            {!queueTracks.length ? (
              <p className={styles.queueEmpty}>Очередь пустая. Добавь треки из поиска или плейлистов.</p>
            ) : (
              <ul className={styles.queueList}>
                {queueTracks.map((track, index) => {
                  const isActive = index === currentIndex;
                  return (
                    <li key={track.id} className={styles.queueRow}>
                      <button
                        type="button"
                        className={`${styles.queueItem} ${isActive ? styles.queueItemActive : ""}`.trim()}
                        onClick={() => jumpToQueueIndex(index)}
                      >
                        <span className={styles.queueIndex}>{index + 1}</span>
                        <span className={styles.queueCover} style={{ background: track.cover }} />
                        <span className={styles.queueMeta}>
                          <span className={styles.queueTrackTitle}>{track.title}</span>
                          <span className={styles.queueTrackArtist}>{track.artist}</span>
                        </span>
                      </button>
                      <div className={styles.queueItemActions}>
                        <button
                          type="button"
                          className={styles.queueActionButton}
                          aria-label="Переместить трек вверх"
                          disabled={index === 0}
                          onClick={() => moveQueueItem(index, index - 1)}
                        >
                          <FiChevronUp />
                        </button>
                        <button
                          type="button"
                          className={styles.queueActionButton}
                          aria-label="Переместить трек вниз"
                          disabled={index === queueTracks.length - 1}
                          onClick={() => moveQueueItem(index, index + 1)}
                        >
                          <FiChevronDown />
                        </button>
                        <button
                          type="button"
                          className={styles.queueActionButton}
                          aria-label="Удалить трек из очереди"
                          onClick={() => removeQueueItem(index)}
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        ) : null}

        <footer className={styles.player} aria-label="Плеер" style={playerThemeStyle}>
          <div className={styles.playerTimelineWrap}>
            <div className={styles.playerTimelineTrack}>
              <div className={styles.playerTimelineRail} aria-hidden="true">
                <span className={styles.playerTimelineRailFill} />
              </div>
              <input
                className={styles.playerTimeline}
                type="range"
                min="0"
                max="100"
                step="any"
                aria-label="Позиция воспроизведения"
                aria-valuetext={`${progressLabel} из ${durationLabel}`}
                value={timelineDragging ? timelineProgressValue : visualProgressPercent}
                onBlur={() => setTimelineDragging(false)}
                onChange={(event) => setProgressPercent(Number(event.target.value))}
                onPointerDown={() => setTimelineDragging(true)}
                onPointerUp={() => setTimelineDragging(false)}
              />
            </div>
            <div className={styles.playerTimelineMeta} aria-hidden="true">
              <span className={`${styles.playerTimelineTime} ${styles.playerTimelineTimeCurrent}`.trim()}>
                {progressLabel}
              </span>
              <span className={`${styles.playerTimelineTime} ${styles.playerTimelineTimeDuration}`.trim()}>
                {durationLabel}
              </span>
            </div>
          </div>

          <div className={styles.playerContent}>
            <div className={styles.playerLeft}>
              <div className={styles.trackArt} style={{ background: currentTrack?.cover }} />
              <div className={styles.trackMeta} aria-live="polite">
                <button
                  type="button"
                  className={styles.trackTitleButton}
                  disabled={!currentTrack}
                  onClick={() => currentTrack && navigate(`/track/${currentTrack.id}`)}
                >
                  {currentTrack?.title ?? "Нет трека"}
                </button>
                {currentTrack?.artist ? (
                  <ArtistInlineLinks
                    artistLine={currentTrack.artist}
                    className={styles.trackArtist}
                    linkClassName={styles.trackArtistButton}
                    textClassName={styles.trackArtistText}
                    onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                  />
                ) : (
                  <div className={styles.trackArtist}>Очередь пуста</div>
                )}
              </div>
            </div>

            <div className={styles.playerCenter}>
              <div className={styles.controls}>
                <div className={styles.controlGroup}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${isCurrentTrackLiked ? styles.iconButtonActive : ""} ${!hasCurrentTrack ? styles.iconButtonDisabled : ""}`.trim()}
                    aria-label={favoriteLabel}
                    aria-pressed={isCurrentTrackLiked}
                    disabled={!hasCurrentTrack}
                    onClick={handleToggleCurrentLike}
                  >
                    {isCurrentTrackLiked ? <BsHeartFill /> : <LuHeart />}
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${shuffleEnabled ? styles.iconButtonActive : ""}`.trim()}
                    aria-label="Перемешать очередь"
                    aria-pressed={shuffleEnabled}
                    onClick={toggleShuffle}
                  >
                    <FiShuffle />
                  </button>
                </div>

                <div className={`${styles.controlGroup} ${styles.transportGroup}`.trim()}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Предыдущий трек"
                    onClick={prevTrack}
                  >
                    <FiSkipBack />
                  </button>
                  <button
                    type="button"
                    className={styles.playButton}
                    aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
                    aria-pressed={isPlaying}
                    onClick={togglePlay}
                  >
                    {isPlaying ? <BsFillPauseFill /> : <BsFillPlayFill />}
                  </button>
                  <button type="button" className={styles.iconButton} aria-label="Следующий трек" onClick={nextTrack}>
                    <FiSkipForward />
                  </button>
                </div>

                <div className={styles.controlGroup}>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${repeatEnabled ? styles.iconButtonActive : ""}`.trim()}
                    aria-label={repeatLabel}
                    aria-pressed={repeatEnabled}
                    onClick={cycleRepeatMode}
                  >
                    <FiRepeat />
                    {repeatMode === "one" ? <span className={styles.repeatBadge}>1</span> : null}
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.playerRight}>
              <div className={styles.playerTools}>
                {showStreamQuality ? (
                  <div className={styles.streamQualityWrap} ref={qualityMenuRef}>
                    <div
                      className={`${styles.streamQualityCluster} ${qualityMenuOpen ? styles.streamQualityClusterOpen : ""}`.trim()}
                    >
                      <button
                        type="button"
                        className={styles.streamQualityTrigger}
                        aria-label="Выбрать качество потока"
                        aria-haspopup="menu"
                        aria-expanded={qualityMenuOpen}
                        disabled={!canControlStreamQuality}
                        onClick={() => setQualityMenuOpen((current) => !current)}
                      >
                        <span className={styles.streamQualityTriggerMeta}>
                          <span className={styles.streamQualityTriggerEyebrow}>QUALITY</span>
                          <span className={styles.streamQualityTriggerValue}>{selectedQualityOption.label}</span>
                        </span>
                        <FiChevronDown className={styles.streamQualityTriggerCaret} />
                      </button>
                      <span className={styles.streamQualityDivider} aria-hidden="true" />
                      <div className={styles.streamQualityBadge} aria-label="Текущее качество потока">
                        <span className={styles.streamQualityMode}>{qualityBadgeLabel}</span>
                        <span className={styles.streamQualityLevel}>{streamQualityLevelLabel}</span>
                      </div>
                    </div>

                    {qualityMenuOpen ? (
                      <div className={styles.streamQualityMenu} role="menu" aria-label="Качество потока">
                        {STREAM_QUALITY_OPTIONS.map((option) => {
                          const isSelected = option.value === streamQualitySelected;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="menuitemradio"
                              aria-checked={isSelected}
                              className={`${styles.streamQualityOption} ${
                                isSelected ? styles.streamQualityOptionActive : ""
                              }`.trim()}
                              onClick={() => {
                                setStreamQuality(option.value);
                                setQualityMenuOpen(false);
                              }}
                            >
                              <span className={styles.streamQualityOptionBody}>
                                <span className={styles.streamQualityOptionLabel}>{option.label}</span>
                                <span className={styles.streamQualityOptionHint}>{option.hint}</span>
                              </span>
                              {isSelected ? <FiCheck className={styles.streamQualityOptionCheck} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  ref={queueToggleRef}
                  className={`${styles.iconButton} ${queueOpen ? styles.iconButtonActive : ""}`.trim()}
                  aria-label="Показать очередь"
                  aria-pressed={queueOpen}
                  onClick={() => setQueueOpen((value) => !value)}
                >
                  <FiList />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={volume > 0 ? "Выключить звук" : "Включить звук"}
                  aria-pressed={volume === 0}
                  onClick={handleToggleMute}
                >
                  {volume > 0 ? <FiVolume2 /> : <FiVolumeX />}
                </button>
              </div>
              <input
                className={`${styles.range} ${styles.volume}`}
                type="range"
                min="0"
                max="100"
                value={volume}
                style={{ "--range-progress": `${volume}%` }}
                onChange={(event) => handleVolumeChange(event.target.value)}
              />
            </div>
          </div>
        </footer>

        {toastItems.length ? (
          <div className={styles.toastStack} aria-live="polite" aria-atomic="false">
            {toastItems.map((toast) => (
              <div key={toast.id} className={styles.toastCard}>
                {toast.message}
              </div>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
