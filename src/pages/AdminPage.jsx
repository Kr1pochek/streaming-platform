import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiActivity,
  FiAlertTriangle,
  FiArrowRight,
  FiMusic,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiUsers,
} from "react-icons/fi";
import styles from "./AdminPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { getAdminStats } from "../api/musicApi.js";
import ResourceState from "../components/ResourceState.jsx";
import AdminStatsSection from "../components/AdminStatsSection.jsx";
import AdminTracksSection from "../components/AdminTracksSection.jsx";
import AdminUsersSection from "../components/AdminUsersSection.jsx";
import useAuth from "../hooks/useAuth.js";

function buildAdminAlerts(stats) {
  if (!stats) {
    return [];
  }

  const alerts = [];
  if (stats.catalogHealth?.sparseCatalog) {
    alerts.push({
      id: "sparse-catalog",
      tone: "warning",
      title: "Каталог сейчас очень маленький",
      description:
        "Публичная часть приложения работает, но с таким объемом контента лучше опираться на системные подборки и загрузки из админского контура.",
    });
  }

  if ((stats.catalogHealth?.publicPlaylistsEmpty ?? 0) > 0) {
    alerts.push({
      id: "empty-playlists",
      tone: "info",
      title: "Часть сидовых плейлистов сейчас пустая",
      description:
        "Это ожидаемо, если в каталоге остались не все исходные треки. Система уже скрывает пустые публичные подборки и подставляет динамические fallback-списки.",
    });
  }

  if ((stats.mediaHealth?.missingLocalFiles ?? 0) > 0 || (stats.mediaHealth?.invalidLocalUrls ?? 0) > 0) {
    alerts.push({
      id: "media-warnings",
      tone: "danger",
      title: "Есть предупреждения по локальным медиа",
      description:
        "Часть записей базы ссылается на отсутствующие или некорректные локальные файлы. Это не валит приложение, но влияет на наполнение каталога.",
    });
  }

  if (!alerts.length) {
    alerts.push({
      id: "stable",
      tone: "success",
      title: "Контур стабильный",
      description: "Сборка, тесты и базовые API проходят. Можно спокойно добивать контент и UX без срочных аварийных правок.",
    });
  }

  return alerts;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { status: authStatus, isAuthenticated, user } = useAuth();
  const [refreshToken, setRefreshToken] = useState(0);
  const canLoadAdminData = authStatus === "authenticated" && Boolean(user?.isAdmin);

  const loadStats = useCallback(() => getAdminStats(), []);
  const { status: statsStatus, data: stats, error: statsError, reload: reloadStats } = useAsyncResource(loadStats, {
    immediate: canLoadAdminData,
  });

  const alerts = useMemo(() => buildAdminAlerts(stats), [stats]);

  const handleRefreshAll = useCallback(async () => {
    setRefreshToken((value) => value + 1);
    await reloadStats();
  }, [reloadStats]);

  if (authStatus === "loading") {
    return (
      <PageShell>
        <ResourceState loading title="Проверяем доступ" description="Подключаем административную панель." />
      </PageShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <PageShell>
        <ResourceState
          title="Нужна авторизация"
          description="Войди в аккаунт с правами администратора, чтобы открыть этот раздел."
          actionLabel="Перейти в профиль"
          onAction={() => navigate("/profile")}
        />
      </PageShell>
    );
  }

  if (!user?.isAdmin) {
    return (
      <PageShell>
        <ResourceState
          title="Доступ ограничен"
          description="Этот раздел доступен только администраторам."
          actionLabel="На главную"
          onAction={() => navigate("/")}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.heroKicker}>
              <FiShield />
              <span>Административный контур</span>
            </p>
            <h1 className={styles.heroTitle}>Панель управления каталогом, медиаданными и пользователями</h1>
            <p className={styles.heroDescription}>
              Здесь видны реальные сигналы проекта: насколько жив каталог, что происходит с медиафайлами,
              какие треки уже можно стримить и кому нужна модерация.
            </p>
            <div className={styles.heroActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleRefreshAll()}
                disabled={statsStatus === "loading"}
              >
                <FiRefreshCw />
                Обновить панель
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate("/profile")}>
                <FiMusic />
                Открыть загрузку треков
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate("/search")}>
                <FiSearch />
                Проверить публичный каталог
                <FiArrowRight />
              </button>
            </div>
          </div>

          <div className={styles.heroMetrics}>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>
                <FiMusic />
              </span>
              <span className={styles.metricValue}>{stats?.catalogHealth?.visibleTracks ?? "—"}</span>
              <span className={styles.metricLabel}>Доступных треков в каталоге</span>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>
                <FiActivity />
              </span>
              <span className={styles.metricValue}>{stats?.catalogHealth?.systemPlaylists ?? "—"}</span>
              <span className={styles.metricLabel}>Системных fallback-плейлистов</span>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricIcon}>
                <FiUsers />
              </span>
              <span className={styles.metricValue}>{stats?.totals?.activeSessions ?? "—"}</span>
              <span className={styles.metricLabel}>Активных сессий</span>
            </article>
          </div>
        </section>

        {statsStatus === "loading" ? (
          <ResourceState
            loading
            title="Собираем диагностику"
            description="Подтягиваем сводку по каталогу, медиафайлам и активности пользователей."
          />
        ) : null}

        {statsStatus === "error" ? (
          <ResourceState
            title="Не удалось загрузить сводку"
            description={statsError}
            actionLabel="Повторить"
            onAction={() => void handleRefreshAll()}
          />
        ) : null}

        {statsStatus === "success" && stats ? (
          <>
            <section className={styles.alertGrid}>
              {alerts.map((alert) => (
                <article
                  key={alert.id}
                  className={`${styles.alertCard} ${styles[`alertCard${alert.tone[0].toUpperCase()}${alert.tone.slice(1)}`]}`.trim()}
                >
                  <span className={styles.alertIcon}>
                    <FiAlertTriangle />
                  </span>
                  <div className={styles.alertBody}>
                    <h2 className={styles.alertTitle}>{alert.title}</h2>
                    <p className={styles.alertDescription}>{alert.description}</p>
                  </div>
                </article>
              ))}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionEyebrow}>Диагностика</p>
                  <h2 className={styles.sectionTitle}>Сводка по платформе</h2>
                </div>
              </div>
              <AdminStatsSection data={stats} />
            </section>

            <AdminTracksSection refreshToken={refreshToken} onChanged={() => void handleRefreshAll()} />
            <AdminUsersSection refreshToken={refreshToken} onChanged={() => void handleRefreshAll()} />
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
