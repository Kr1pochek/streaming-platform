import styles from "./ResourceState.module.css";

export default function ResourceState({ title, description, actionLabel, onAction, loading = false }) {
  return (
    <div className={styles.stateCard} role={loading ? "status" : undefined}>
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
