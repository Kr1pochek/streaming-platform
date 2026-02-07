import { Link } from "react-router-dom";
import styles from "./PageScaffold.module.css";

export default function NotFoundPage() {
  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.header}>
          <h1 className={styles.title}>404</h1>
          <p className={styles.subtitle}>Страница не найдена. Проверь адрес или вернись на главную.</p>
        </header>

        <p className={styles.emptyState}>
          Перейти на{" "}
          <Link className={styles.homeLink} to="/">
            главную страницу
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
