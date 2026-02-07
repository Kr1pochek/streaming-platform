import { Outlet } from "react-router-dom";
import { FiSkipBack, FiSkipForward, FiPause, FiPlay, FiVolume2 } from "react-icons/fi";
import { LuHeart, LuHeartOff } from "react-icons/lu";
import Sidebar from "./Sidebar.jsx";
import styles from "./AppLayout.module.css";
import { usePlayer } from "../context/PlayerContext.jsx";

export default function AppLayout() {
  const {
    currentTrack,
    isPlaying,
    volume,
    progressPercent,
    progressLabel,
    durationLabel,
    isCurrentTrackLiked,
    togglePlay,
    nextTrack,
    prevTrack,
    setProgressPercent,
    setVolume,
    likeTrack,
    unlikeTrack,
  } = usePlayer();

  const canLikeCurrent = Boolean(currentTrack && !isCurrentTrackLiked);
  const canUnlikeCurrent = Boolean(currentTrack && isCurrentTrackLiked);

  return (
    <div className={styles.appShell}>
      <div className={styles.sidebar}>
        <Sidebar />
      </div>

      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>

        <footer className={styles.player} aria-label="Плеер">
          <div className={styles.playerLeft}>
            <div className={styles.trackArt} style={{ background: currentTrack?.cover }} />
            <div className={styles.trackMeta} aria-live="polite">
              <div className={styles.trackTitle}>{currentTrack?.title ?? "Нет трека"}</div>
              <div className={styles.trackArtist}>{currentTrack?.artist ?? "Очередь пуста"}</div>
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
                {isPlaying ? <FiPause /> : <FiPlay />}
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
            </div>
            <div className={styles.progressRow}>
              <span className={styles.time}>{progressLabel}</span>
              <input
                className={`${styles.range} ${styles.progress}`}
                type="range"
                min="0"
                max="100"
                value={progressPercent}
                onChange={(event) => setProgressPercent(Number(event.target.value))}
              />
              <span className={styles.time}>{durationLabel}</span>
            </div>
          </div>

          <div className={styles.playerRight}>
            <button type="button" className={styles.iconButton} aria-label="Громкость">
              <FiVolume2 />
            </button>
            <input
              className={`${styles.range} ${styles.volume}`}
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
        </footer>
      </main>
    </div>
  );
}
