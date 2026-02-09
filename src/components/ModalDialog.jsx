import { useEffect } from "react";
import styles from "./ModalDialog.module.css";

export default function ModalDialog({
  open,
  title,
  description = "",
  onClose,
  children,
  actions,
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {description ? <p className={styles.description}>{description}</p> : null}
        </header>
        <div className={styles.content}>{children}</div>
        {actions ? <footer className={styles.footer}>{actions}</footer> : null}
      </section>
    </div>
  );
}
