import { FiArrowRight, FiHeart, FiPlay } from "react-icons/fi";
import styles from "./SmartRecommendations.module.css";

export default function SmartRecommendations({
  title = "Попробуй рекомендации",
  tracks,
  onPlayTrack,
  onLikeTrack,
  onOpenTrack,
}) {
  if (!tracks?.length) {
    return null;
  }

  return (
    <section className={styles.block}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.grid}>
        {tracks.map((track) => (
          <article key={track.id} className={styles.card}>
            <span className={styles.cover} style={{ background: track.cover }} />
            <span className={styles.meta}>
              <span className={styles.trackTitle}>{track.title}</span>
              <span className={styles.trackArtist}>{track.artist}</span>
            </span>
            <span className={styles.actions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Слушать трек"
                onClick={() => onPlayTrack(track.id)}
              >
                <FiPlay />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Добавить в избранное"
                onClick={() => onLikeTrack(track.id)}
              >
                <FiHeart />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Открыть страницу трека"
                onClick={() => onOpenTrack(track.id)}
              >
                <FiArrowRight />
              </button>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
