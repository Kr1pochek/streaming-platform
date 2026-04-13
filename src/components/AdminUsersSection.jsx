import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiRefreshCw,
  FiSearch,
  FiShield,
  FiSlash,
  FiUserCheck,
} from "react-icons/fi";
import { banAdminUser, getAdminUsers, unbanAdminUser } from "../api/musicApi.js";
import ResourceState from "./ResourceState.jsx";
import ModalDialog from "./ModalDialog.jsx";
import styles from "./AdminUsersSection.module.css";

const USERS_LIMIT = 10;
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});
const statusOptions = [
  { id: "all", label: "Все" },
  { id: "active", label: "Активные" },
  { id: "banned", label: "Забаненные" },
  { id: "admin", label: "Админы" },
];

function formatDateTime(value) {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Без даты";
  }
  return dateTimeFormatter.format(timestamp);
}

export default function AdminUsersSection({ refreshToken = 0, onChanged }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [usersData, setUsersData] = useState({ users: [], total: 0, limit: USERS_LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionUserId, setActionUserId] = useState("");
  const [banDialog, setBanDialog] = useState({
    open: false,
    user: null,
    reason: "Нарушение правил платформы",
    submitting: false,
  });

  const loadUsers = useCallback(
    async ({ nextOffset = 0, nextQuery = query, nextStatus = statusFilter } = {}) => {
      setLoading(true);
      setError("");

      try {
        const response = await getAdminUsers({
          limit: USERS_LIMIT,
          offset: nextOffset,
          query: nextQuery,
          status: nextStatus,
        });
        setUsersData({
          users: response?.users ?? [],
          total: Number(response?.total ?? 0),
          limit: Number(response?.limit ?? USERS_LIMIT),
          offset: Number(response?.offset ?? nextOffset),
        });
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить список пользователей.");
      } finally {
        setLoading(false);
      }
    },
    [query, statusFilter]
  );

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) {
        return;
      }
      await loadUsers({ nextOffset: 0, nextQuery: query, nextStatus: statusFilter });
    }, query ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, statusFilter, refreshToken, loadUsers]);

  const hasMore = offset + USERS_LIMIT < usersData.total;
  const canGoBack = offset > 0;

  const summary = useMemo(() => {
    const admins = usersData.users.filter((user) => user.isAdmin).length;
    const banned = usersData.users.filter((user) => user.isBanned).length;
    return { admins, banned };
  }, [usersData.users]);

  const openBanDialog = (user) => {
    setBanDialog({
      open: true,
      user,
      reason: user.banReason || "Нарушение правил платформы",
      submitting: false,
    });
  };

  const closeBanDialog = () => {
    setBanDialog({
      open: false,
      user: null,
      reason: "Нарушение правил платформы",
      submitting: false,
    });
  };

  const handleBanUser = async () => {
    if (!banDialog.user?.id) {
      return;
    }

    const targetUser = banDialog.user;
    setBanDialog((current) => ({ ...current, submitting: true }));
    setError("");
    setFeedback("");

    try {
      await banAdminUser(targetUser.id, banDialog.reason.trim() || "Нарушение правил платформы");
      closeBanDialog();
      await loadUsers({ nextOffset: offset });
      setFeedback(`Пользователь "${targetUser.username}" заблокирован.`);
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось заблокировать пользователя.");
      setBanDialog((current) => ({ ...current, submitting: false }));
    }
  };

  const handleUnbanUser = async (user) => {
    setActionUserId(user.id);
    setError("");
    setFeedback("");

    try {
      await unbanAdminUser(user.id);
      await loadUsers({ nextOffset: offset });
      setFeedback(`Пользователь "${user.username}" снова активен.`);
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось снять блокировку.");
    } finally {
      setActionUserId("");
    }
  };

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Аккаунты и доступ</p>
          <h2 className={styles.title}>Пользователи</h2>
          <p className={styles.description}>
            Здесь видны роли, блокировки и вклад пользователей в наполнение каталога через загрузку собственных треков.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadUsers({ nextOffset: offset })}>
          <FiRefreshCw />
          Обновить
        </button>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <FiSearch />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по id, username или display name"
            autoComplete="off"
          />
        </label>
        <div className={styles.filters}>
          {statusOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`${styles.filterButton} ${statusFilter === option.id ? styles.filterButtonActive : ""}`.trim()}
              onClick={() => setStatusFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.summaryBar}>
        <span>Всего в выборке: {usersData.total}</span>
        <span>Админов на странице: {summary.admins}</span>
        <span>Забаненных на странице: {summary.banned}</span>
      </div>

      {feedback ? <p className={styles.feedback}>{feedback}</p> : null}

      {loading && !usersData.users.length ? (
        <ResourceState loading title="Загружаем пользователей" description="Собираем роли, статусы и статистику загрузок." />
      ) : null}

      {error && !usersData.users.length ? (
        <ResourceState title="Не удалось загрузить пользователей" description={error} actionLabel="Повторить" onAction={() => void loadUsers({ nextOffset: offset })} />
      ) : null}

      {!loading && !error && !usersData.users.length ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>По этим фильтрам пользователей нет</p>
          <p className={styles.emptyDescription}>Попробуй другой статус или более широкий поисковый запрос.</p>
        </div>
      ) : null}

      {usersData.users.length ? (
        <div className={styles.cardList}>
          {usersData.users.map((user) => (
            <article
              key={user.id}
              className={`${styles.card} ${user.isBanned ? styles.cardBanned : ""}`.trim()}
            >
              <div className={styles.cardHeader}>
                <div className={styles.identity}>
                  <span className={styles.avatar}>{String(user.username ?? "?").slice(0, 1).toUpperCase()}</span>
                  <div className={styles.identityText}>
                    <h3 className={styles.username}>{user.username}</h3>
                    <p className={styles.displayName}>{user.displayName || "Без display name"}</p>
                  </div>
                </div>

                <div className={styles.badges}>
                  <span
                    className={`${styles.badge} ${
                      user.isAdmin ? styles.badgeAdmin : user.isBanned ? styles.badgeBanned : styles.badgeActive
                    }`.trim()}
                  >
                    {user.isAdmin ? "Admin" : user.isBanned ? "Banned" : "Active"}
                  </span>
                  <span className={styles.badge}>Uploads: {user.uploaded_tracks_count ?? 0}</span>
                </div>
              </div>

              <div className={styles.details}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>ID</span>
                  <span className={styles.detailValue}>{user.id}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Создан</span>
                  <span className={styles.detailValue}>{formatDateTime(user.createdAt)}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Загружено треков</span>
                  <span className={styles.detailValue}>{user.uploaded_tracks_count ?? 0}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Статус роли</span>
                  <span className={styles.detailValue}>
                    {user.isAdmin ? "Администратор" : user.isBanned ? "Заблокирован" : "Обычный пользователь"}
                  </span>
                </div>
              </div>

              {user.banReason ? (
                <p className={styles.reason}>
                  <strong>Причина блокировки:</strong> {user.banReason}
                </p>
              ) : null}

              <div className={styles.cardActions}>
                {user.isAdmin ? (
                  <span className={styles.adminPill}>
                    <FiShield />
                    Служебный аккаунт
                  </span>
                ) : user.isBanned ? (
                  <button
                    type="button"
                    className={styles.actionPrimaryButton}
                    onClick={() => void handleUnbanUser(user)}
                    disabled={actionUserId === user.id}
                  >
                    <FiUserCheck />
                    Снять блокировку
                  </button>
                ) : (
                  <button type="button" className={styles.actionDangerButton} onClick={() => openBanDialog(user)}>
                    <FiSlash />
                    Заблокировать
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {error && usersData.users.length ? <p className={styles.inlineError}>{error}</p> : null}

      <footer className={styles.pagination}>
        <button type="button" className={styles.paginationButton} disabled={!canGoBack} onClick={() => void loadUsers({ nextOffset: Math.max(0, offset - USERS_LIMIT) })}>
          <FiChevronLeft />
          Назад
        </button>
        <span className={styles.paginationLabel}>
          {usersData.total ? `${offset + 1}-${Math.min(offset + USERS_LIMIT, usersData.total)} из ${usersData.total}` : "0 результатов"}
        </span>
        <button type="button" className={styles.paginationButton} disabled={!hasMore} onClick={() => void loadUsers({ nextOffset: offset + USERS_LIMIT })}>
          Вперед
          <FiChevronRight />
        </button>
      </footer>

      <ModalDialog
        open={banDialog.open}
        title="Заблокировать пользователя"
        description={
          banDialog.user
            ? `Пользователь "${banDialog.user.username}" потеряет доступ к аккаунту и активным сессиям.`
            : ""
        }
        onClose={closeBanDialog}
        actions={
          <>
            <button type="button" className={styles.dialogGhostButton} onClick={closeBanDialog}>
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogDangerButton}
              onClick={() => void handleBanUser()}
              disabled={banDialog.submitting}
            >
              <FiSlash />
              Заблокировать
            </button>
          </>
        }
      >
        <label className={styles.dialogField}>
          <span>Причина блокировки</span>
          <textarea
            className={styles.dialogTextarea}
            value={banDialog.reason}
            onChange={(event) => setBanDialog((current) => ({ ...current, reason: event.target.value }))}
            rows={4}
            maxLength={220}
            placeholder="Например: спам, тестовый аккаунт, нарушение правил"
          />
        </label>
      </ModalDialog>
    </section>
  );
}
