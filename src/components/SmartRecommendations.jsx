import { FiArrowRight, FiHeart, FiMoreHorizontal } from "react-icons/fi";
import { BsFillPlayFill } from "react-icons/bs";
import styles from "./SmartRecommendations.module.css";

export default function SmartRecommendations({
  title = "Попробуй рекомендации",
  tracks,
  onPlayTrack,
  onLikeTrack,
  onOpenTrack,
  onOpenTrackMenu,
}) {
  if (!tracks?.length) {
    return null;
  }

  return (
    <section className={styles.block}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.grid}>
        {tracks.map((track) => (
          <article
            key={track.id}
            className={styles.card}
            onContextMenu={onOpenTrackMenu ? (event) => onOpenTrackMenu(event, track.id) : undefined}
          >
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
                <BsFillPlayFill />
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
                onClick={onOpenTrackMenu ? (event) => onOpenTrackMenu(event, track.id) : () => onOpenTrack(track.id)}
              >
                {onOpenTrackMenu ? <FiMoreHorizontal /> : <FiArrowRight />}
              </button>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
