import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { BsFillPlayFill } from "react-icons/bs";
import { FiDisc, FiExternalLink, FiMusic, FiRefreshCw } from "react-icons/fi";
import PageShell from "../components/PageShell.jsx";
import ResourceState from "../components/ResourceState.jsx";
import { fetchHomeFeed } from "../api/musicApi.js";
import useAsyncResource from "../hooks/useAsyncResource.js";
import usePlayer from "../hooks/usePlayer.js";
import styles from "./NewReleasesPage.module.css";

const releaseDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function trackWord(count) {
  const safeCount = Math.abs(Number(count ?? 0));
  const lastDigit = safeCount % 10;
  const lastTwoDigits = safeCount % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return "треков";
  }
  if (lastDigit === 1) {
    return "трек";
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return "трека";
  }
  return "треков";
}

function releaseWord(count) {
  const safeCount = Math.abs(Number(count ?? 0));
  const lastDigit = safeCount % 10;
  const lastTwoDigits = safeCount % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return "релизов";
  }
  if (lastDigit === 1) {
    return "релиз";
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return "релиза";
  }
  return "релизов";
}

function formatReleaseDateLabel(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) {
    return "Свежий релиз";
  }
  return releaseDateFormatter.format(value);
}

export default function NewReleasesPage() {
  const navigate = useNavigate();
  const { playQueue } = usePlayer();
  const loadHomeFeed = useCallback(() => fetchHomeFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadHomeFeed);
  const releases = useMemo(
    () => (Array.isArray(data?.releaseNotifications) ? data.releaseNotifications : []),
    [data?.releaseNotifications]
  );
  const artistCount = useMemo(
    () => new Set(releases.map((release) => release.artistId).filter(Boolean)).size,
    [releases]
  );
  const releaseWindowDays = Number.isFinite(Number(data?.releaseNotificationWindowDays))
    ? Number(data.releaseNotificationWindowDays)
    : 14;

  return (
    <PageShell>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={() => navigate("/")}>
          Главная
        </button>

        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            <FiDisc />
            Лента обновлений
          </p>
          <h1 className={styles.title}>Новые релизы</h1>
          <p className={styles.subtitle}>
            Релизы за последние {releaseWindowDays} дней, свежие карточки артистов и быстрый запуск прослушивания.
          </p>
        </div>

        <div className={styles.stats} aria-label="Сводка новых релизов">
          <span className={styles.stat}>
            <strong>{releases.length}</strong>
            {releaseWord(releases.length)}
          </span>
          <span className={styles.stat}>
            <strong>{artistCount}</strong>
            артистов
          </span>
        </div>
      </header>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем релизы" description="Собираем свежие публикации артистов." />
      ) : null}

      {status === "error" ? (
        <ResourceState
          title="Не удалось загрузить релизы"
          description={error}
          actionLabel="Повторить"
          onAction={reload}
        />
      ) : null}

      {status === "success" && !releases.length ? (
        <ResourceState
          title="Пока нет свежих релизов"
          description={`Здесь появятся релизы, опубликованные за последние ${releaseWindowDays} дней.`}
          actionLabel="Перейти в поиск"
          onAction={() => navigate("/search")}
        />
      ) : null}

      {status === "success" && releases.length ? (
        <section className={styles.grid} aria-label="Новые релизы">
          {releases.map((release) => {
            const trackCount = release.trackIds?.length ?? 0;
            return (
              <article
                key={release.id || release.releaseId}
                className={styles.card}
                style={{ "--release-cover": release.cover }}
              >
                <button
                  type="button"
                  className={styles.mainButton}
                  onClick={() => navigate(`/release/${release.releaseId}`)}
                >
                  <span className={styles.coverWrap}>
                    <span className={styles.coverGlow} aria-hidden="true" />
                    <span className={styles.cover} style={{ background: release.cover }} />
                  </span>
                  <span className={styles.meta}>
                    <span className={styles.badgeRow}>
                      <span className={styles.badge}>{String(release.type ?? "release").toUpperCase()}</span>
                      <span className={styles.badge}>{formatReleaseDateLabel(release.publishedAt)}</span>
                    </span>
                    <span className={styles.releaseTitle}>{release.title}</span>
                    <span className={styles.artist}>{release.artistName}</span>
                    <span className={styles.caption}>
                      {release.year} • {trackCount} {trackWord(trackCount)}
                    </span>
                  </span>
                </button>

                <div className={styles.actions}>
                  {trackCount ? (
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => playQueue(release.trackIds, 0)}
                    >
                      <BsFillPlayFill />
                      Слушать
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => navigate(`/release/${release.releaseId}`)}
                  >
                    <FiExternalLink />
                    Открыть
                  </button>
                  {release.artistId ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => navigate(`/artist/${release.artistId}`)}
                    >
                      <FiMusic />
                      Артист
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {status === "success" && releases.length ? (
        <button type="button" className={styles.refreshButton} onClick={reload}>
          <FiRefreshCw />
          Обновить релизы
        </button>
      ) : null}
    </PageShell>
  );
}
