import { Outlet } from "react-router-dom";
import { FiSkipBack, FiSkipForward, FiPause, FiVolume2 } from "react-icons/fi";
import Sidebar from "./Sidebar.jsx";
import styles from "./AppLayout.module.css";

export default function AppLayout() {
  return (
    <div className={styles.appShell}>
      <div className={styles.sidebar}>
        <Sidebar />
      </div>

      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>

        <footer className={styles.player}>
          <div className={styles.playerLeft}>
            <div className={styles.trackArt} />
            <div className={styles.trackMeta}>
              <div className={styles.trackTitle}>Я хочу убиться</div>
              <div className={styles.trackArtist}>Pain</div>
            </div>
          </div>

          <div className={styles.playerCenter}>
            <div className={styles.controls}>
              <button className={styles.iconButton} aria-label="Предыдущий трек">
                <FiSkipBack />
              </button>
              <button className={styles.playButton} aria-label="Пауза">
                <FiPause />
              </button>
              <button className={styles.iconButton} aria-label="Следующий трек">
                <FiSkipForward />
              </button>
            </div>
            <div className={styles.progressRow}>
              <span className={styles.time}>1:04</span>
              <input
                className={`${styles.range} ${styles.progress}`}
                type="range"
                min="0"
                max="100"
                defaultValue="32"
              />
              <span className={styles.time}>3:42</span>
            </div>
          </div>

          <div className={styles.playerRight}>
            <button className={styles.iconButton} aria-label="Громкость">
              <FiVolume2 />
            </button>
            <input
              className={`${styles.range} ${styles.volume}`}
              type="range"
              min="0"
              max="100"
              defaultValue="70"
            />
          </div>
        </footer>
      </main>
    </div>
  );
}
