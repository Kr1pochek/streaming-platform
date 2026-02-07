import useScrollingVisibility from "../hooks/useScrollingVisibility.js";
import styles from "./PageShell.module.css";

export default function PageShell({ children }) {
  const { isScrolling, setScrollElement } = useScrollingVisibility();

  return (
    <div className={styles.page}>
      <section
        ref={setScrollElement}
        className={`${styles.shell} ${isScrolling ? styles.shellScrolling : ""}`.trim()}
      >
        {children}
      </section>
    </div>
  );
}
