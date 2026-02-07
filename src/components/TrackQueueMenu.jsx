import styles from "./TrackQueueMenu.module.css";

export default function TrackQueueMenu({ menuState, onAddTrackNext, onClose }) {
  if (!menuState) {
    return null;
  }

  return (
    <div
      className={styles.menu}
      style={{ top: menuState.y, left: menuState.x }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" className={styles.menuButton} onClick={onAddTrackNext}>
        Добавить далее
      </button>
      <button type="button" className={styles.menuButtonGhost} onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}
