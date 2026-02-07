import styles from "./ResourceState.module.css";

export default function ResourceState({ title, description, actionLabel, onAction, loading = false }) {
  if (loading) {
    return (
      <div className={styles.skeletonCard} role="status" aria-live="polite">
        <span className={`${styles.skeletonLine} ${styles.skeletonTitle}`} />
        <span className={`${styles.skeletonLine} ${styles.skeletonText}`} />
        <span className={`${styles.skeletonLine} ${styles.skeletonTextShort}`} />
        <span className={`${styles.skeletonLine} ${styles.skeletonButton}`} />
      </div>
    );
  }

  return (
    <div className={styles.stateCard}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{description}</p>
      {actionLabel ? (
        <button type="button" className={styles.button} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
