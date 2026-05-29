import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import {
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiHome,
  FiList,
  FiMusic,
  FiRadio,
  FiRepeat,
  FiSearch,
  FiSettings,
  FiShuffle,
  FiSliders,
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

function formatEqualizerGain(gain) {
  const roundedGain = Math.round(Number(gain) || 0);
  return `${roundedGain > 0 ? "+" : ""}${roundedGain}`;
}

export default function AppLayout() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const {
    currentTrack,
    currentIndex,
    queueTracks,
    queueSource,
    isWaveActive,
    isPlaying,
    volume,
    streamQuality,
    equalizer,
    equalizerPresets,
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
    setEqualizerPreset,
    setEqualizerBand,
    setEqualizerPreamp,
    toastItems,
    dismissToast,
  } = usePlayer();

  const [queueOpen, setQueueOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [equalizerOpen, setEqualizerOpen] = useState(false);
  const [equalizerPresetOpen, setEqualizerPresetOpen] = useState(false);
  const [playerPalette, setPlayerPalette] = useState(DEFAULT_PLAYER_PALETTE);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const queuePanelRef = useRef(null);
  const queueToggleRef = useRef(null);
  const qualityMenuRef = useRef(null);
  const equalizerPanelRef = useRef(null);
  const equalizerToggleRef = useRef(null);
  const toastTimerMapRef = useRef(new Map());
  const lastNonZeroVolumeRef = useRef(volume > 0 ? volume : 70);
  const hasCurrentTrack = Boolean(currentTrack);
  const showWaveBadge = Boolean(hasCurrentTrack && (isWaveActive || queueSource === "wave"));

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
  const equalizerPresetLabel = equalizer?.presetLabel ?? "По умолчанию";
  const equalizerBands = Array.isArray(equalizer?.bands) ? equalizer.bands : [];
  const equalizerPreampDb = Math.round(Number(equalizer?.preampDb ?? 0));
  const equalizerPreampMinDb = Number(equalizer?.preampMinDb ?? -12);
  const equalizerPreampMaxDb = Number(equalizer?.preampMaxDb ?? 12);
  const equalizerCustomPresetId = equalizer?.customPresetId ?? "custom";
  const equalizerPresetOptions = [
    { id: equalizerCustomPresetId, label: "Своя настройка" },
    ...(Array.isArray(equalizerPresets) ? equalizerPresets : []),
  ];
  const timelineProgressValue = Math.min(
    100,
    Math.max(0, Number.isFinite(progressPercent) ? progressPercent : 0),
  );
  const visualProgressPercent = timelineProgressValue;
  const progressTailRoundRatio = Math.min(1, Math.max(0, 0.18 + (visualProgressPercent / 100) * 0.82));
  const progressTailRadiusPx = 6 + progressTailRoundRatio * 16;
  const progressEdgeHighlightOpacity = 0.03 * (1 - progressTailRoundRatio);
  const mobileNavItems = [
    { to: "/", label: "Главная", icon: FiHome, end: true },
    { to: "/search", label: "Поиск", icon: FiSearch },
    { to: "/library", label: "Музыка", icon: FiMusic },
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

  const handleToggleQueuePanel = () => {
    setQueueOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setEqualizerOpen(false);
        setQualityMenuOpen(false);
      }
      return nextOpen;
    });
  };

  const handleToggleEqualizerPanel = () => {
    setEqualizerOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setQueueOpen(false);
        setQualityMenuOpen(false);
      } else {
        setEqualizerPresetOpen(false);
      }
      return nextOpen;
    });
  };

  const handleToggleQualityMenu = () => {
    setQualityMenuOpen((current) => {
      const nextOpen = !current;
      if (nextOpen) {
        setEqualizerOpen(false);
        setEqualizerPresetOpen(false);
        setQueueOpen(false);
      }
      return nextOpen;
    });
  };

  const handleSelectEqualizerPreset = (presetId) => {
    setEqualizerPreset(presetId);
    setEqualizerPresetOpen(false);
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
    if (!equalizerOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (equalizerPanelRef.current?.contains(target) || equalizerToggleRef.current?.contains(target)) {
        return;
      }

      setEqualizerPresetOpen(false);
      setEqualizerOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (equalizerPresetOpen) {
          setEqualizerPresetOpen(false);
          return;
        }
        setEqualizerPresetOpen(false);
        setEqualizerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [equalizerOpen, equalizerPresetOpen]);

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
      const timeoutId = setTimeout(() => {
        setQualityMenuOpen(false);
      }, 0);
      return () => {
        clearTimeout(timeoutId);
      };
    }
    return undefined;
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
          <aside
            ref={queuePanelRef}
            className={styles.queuePanel}
            aria-label="Очередь воспроизведения"
            data-testid="player-queue-panel"
          >
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

        {equalizerOpen ? (
          <aside
            ref={equalizerPanelRef}
            className={styles.equalizerPanel}
            aria-label="Эквалайзер"
            data-testid="player-equalizer-panel"
          >
            <header className={styles.equalizerHeader}>
              <h2 className={styles.equalizerTitle}>Эквалайзер</h2>
            </header>

            <div className={styles.equalizerGraph}>
              <label className={styles.equalizerLevelBand}>
                <input
                  className={styles.equalizerLevelSlider}
                  type="range"
                  min={equalizerPreampMinDb}
                  max={equalizerPreampMaxDb}
                  step="1"
                  value={equalizerPreampDb}
                  aria-label="Уровень усиления эквалайзера"
                  aria-valuetext={`${formatEqualizerGain(equalizerPreampDb)} dB`}
                  onChange={(event) => setEqualizerPreamp(Number(event.target.value))}
                />
                <span className={styles.equalizerLevelLabel}>уровень</span>
              </label>
              <div className={styles.equalizerDbScale} aria-hidden="true">
                <span>12dB</span>
                <span>0dB</span>
                <span>-12dB</span>
              </div>
              <div className={styles.equalizerBands}>
                {equalizerBands.map((band, index) => {
                  const gain = Number(band.gain) || 0;

                  return (
                    <label key={band.id} className={styles.equalizerBand}>
                      <input
                        className={styles.equalizerBandSlider}
                        type="range"
                        min="-12"
                        max="12"
                        step="1"
                        value={gain}
                        aria-label={`Полоса ${band.label}`}
                        aria-valuetext={`${formatEqualizerGain(gain)} dB`}
                        onChange={(event) => setEqualizerBand(index, Number(event.target.value))}
                      />
                      <span className={styles.equalizerBandLabel}>{band.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className={styles.equalizerPresetWrap}>
              <button
                type="button"
                className={`${styles.equalizerPresetSelect} ${
                  equalizerPresetOpen ? styles.equalizerPresetSelectOpen : ""
                }`.trim()}
                aria-label="Выбрать пресет эквалайзера"
                aria-haspopup="listbox"
                aria-expanded={equalizerPresetOpen}
                onClick={() => setEqualizerPresetOpen((current) => !current)}
              >
                <span>{equalizerPresetLabel}</span>
                <FiChevronDown />
              </button>
            </div>

            {equalizerPresetOpen ? (
              <div className={styles.equalizerPresetMenu} role="listbox" aria-label="Пресеты эквалайзера">
                {equalizerPresetOptions.map((preset) => {
                  const isActive = equalizer?.presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`${styles.equalizerPresetOption} ${
                        isActive ? styles.equalizerPresetOptionActive : ""
                      }`.trim()}
                      onClick={() => handleSelectEqualizerPreset(preset.id)}
                    >
                      <span>{preset.label}</span>
                      {isActive ? <FiCheck /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </aside>
        ) : null}

        <footer className={styles.player} aria-label="Плеер" data-testid="player-footer" style={playerThemeStyle}>
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
                  data-testid="player-current-track-button"
                  disabled={!currentTrack}
                  onClick={() => currentTrack && navigate(`/track/${currentTrack.id}`)}
                >
                  {currentTrack?.title ?? "Нет трека"}
                </button>
                {currentTrack?.artist ? (
                  <div className={styles.trackStateRow}>
                    <ArtistInlineLinks
                      artistLine={currentTrack.artist}
                      className={styles.trackArtist}
                      linkClassName={styles.trackArtistButton}
                      textClassName={styles.trackArtistText}
                      onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                    />
                    {showWaveBadge ? (
                      <span className={styles.waveBadge} title="Играет скрытая очередь Моей волны">
                        <FiRadio aria-hidden="true" />
                        Моя волна
                      </span>
                    ) : null}
                  </div>
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
                    data-testid="player-prev-button"
                    onClick={prevTrack}
                  >
                    <FiSkipBack />
                  </button>
                  <button
                    type="button"
                    className={styles.playButton}
                    aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
                    aria-pressed={isPlaying}
                    data-testid="player-play-toggle"
                    onClick={togglePlay}
                  >
                    {isPlaying ? <BsFillPauseFill /> : <BsFillPlayFill />}
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Следующий трек"
                    data-testid="player-next-button"
                    onClick={nextTrack}
                  >
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
                        onClick={handleToggleQualityMenu}
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
                  ref={equalizerToggleRef}
                  className={`${styles.iconButton} ${equalizerOpen ? styles.iconButtonActive : ""}`.trim()}
                  aria-label="Открыть эквалайзер"
                  aria-pressed={equalizerOpen}
                  data-testid="player-equalizer-toggle"
                  onClick={handleToggleEqualizerPanel}
                >
                  <FiSliders />
                </button>
                <button
                  type="button"
                  ref={queueToggleRef}
                  className={`${styles.iconButton} ${queueOpen ? styles.iconButtonActive : ""}`.trim()}
                  aria-label="Показать очередь"
                  aria-pressed={queueOpen}
                  data-testid="player-queue-toggle"
                  onClick={handleToggleQueuePanel}
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
