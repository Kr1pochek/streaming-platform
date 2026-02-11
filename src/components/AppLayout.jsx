import { useEffect, useRef, useState } from "react";
import { useNavigate, Outlet } from "react-router-dom";
import {
  FiChevronDown,
  FiChevronUp,
  FiList,
  FiRepeat,
  FiShuffle,
  FiSkipBack,
  FiSkipForward,
  FiTrash2,
  FiVolume2,
  FiVolumeX,
  FiX,
} from "react-icons/fi";
import { BsFillPauseFill, BsFillPlayFill } from "react-icons/bs";
import { LuHeart, LuHeartOff } from "react-icons/lu";
import Sidebar from "./Sidebar.jsx";
import styles from "./AppLayout.module.css";
import usePlayer from "../hooks/usePlayer.js";
import ArtistInlineLinks from "./ArtistInlineLinks.jsx";

export default function AppLayout() {
  const navigate = useNavigate();
  const {
    currentTrack,
    currentIndex,
    queueTracks,
    isPlaying,
    volume,
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
    toastItems,
    dismissToast,
  } = usePlayer();

  const [queueOpen, setQueueOpen] = useState(false);
  const queuePanelRef = useRef(null);
  const queueToggleRef = useRef(null);
  const toastTimerMapRef = useRef(new Map());
  const lastNonZeroVolumeRef = useRef(volume > 0 ? volume : 70);

  const canLikeCurrent = Boolean(currentTrack && !isCurrentTrackLiked);
  const canUnlikeCurrent = Boolean(currentTrack && isCurrentTrackLiked);
  const repeatEnabled = repeatMode !== "off";

  const repeatLabel =
    repeatMode === "one"
      ? "Повтор текущего трека"
      : repeatMode === "all"
        ? "Повтор очереди"
        : "Включить повтор";

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

  return (
    <div className={styles.appShell}>
      <div className={styles.sidebar}>
        <Sidebar />
      </div>

      <main className={styles.main}>
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

        <footer className={styles.player} aria-label="Плеер">
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
              <button
                type="button"
                className={`${styles.iconButton} ${canLikeCurrent ? "" : styles.iconButtonDisabled}`.trim()}
                aria-label="Добавить трек в избранное"
                aria-pressed={isCurrentTrackLiked}
                disabled={!canLikeCurrent}
                onClick={() => currentTrack && likeTrack(currentTrack.id)}
              >
                <LuHeart />
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
              <button
                type="button"
                className={`${styles.iconButton} ${canUnlikeCurrent ? "" : styles.iconButtonDisabled}`.trim()}
                aria-label="Убрать трек из избранного"
                disabled={!canUnlikeCurrent}
                onClick={() => currentTrack && unlikeTrack(currentTrack.id)}
              >
                <LuHeartOff />
              </button>
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
            <div className={styles.progressRow}>
              <span className={styles.time}>{progressLabel}</span>
              <input
                className={`${styles.range} ${styles.progress}`}
                type="range"
                min="0"
                max="100"
                value={progressPercent}
                style={{ "--range-progress": `${progressPercent}%` }}
                onChange={(event) => setProgressPercent(Number(event.target.value))}
              />
              <span className={styles.time}>{durationLabel}</span>
            </div>
          </div>

          <div className={styles.playerRight}>
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
            <input
              className={`${styles.range} ${styles.volume}`}
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => handleVolumeChange(event.target.value)}
            />
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
