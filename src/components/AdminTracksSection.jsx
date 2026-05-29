import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronLeft,
  FiChevronRight,
  FiExternalLink,
  FiEye,
  FiEyeOff,
  FiHardDrive,
  FiRefreshCw,
  FiSearch,
  FiRadio,
} from "react-icons/fi";
import { formatDurationClock } from "../utils/formatters.js";
import { getAdminTracks, hideAdminTrack, unhideAdminTrack } from "../api/musicApi.js";
import ResourceState from "./ResourceState.jsx";
import ModalDialog from "./ModalDialog.jsx";
import styles from "./AdminTracksSection.module.css";

const TRACKS_LIMIT = 8;
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});
const statusOptions = [
  { id: "all", label: "Все" },
  { id: "visible", label: "В каталоге" },
  { id: "hidden", label: "Скрытые" },
  { id: "local", label: "Local media" },
  { id: "remote", label: "Remote" },
];

function formatDateTime(value) {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Без даты";
  }
  return dateTimeFormatter.format(timestamp);
}

function formatReason(reason = "") {
  return String(reason ?? "").trim() || "Без причины";
}

export default function AdminTracksSection({ refreshToken = 0 }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [tracksData, setTracksData] = useState({ tracks: [], total: 0, limit: TRACKS_LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionTrackId, setActionTrackId] = useState("");
  const [hideDialog, setHideDialog] = useState({
    open: false,
    track: null,
    reason: "Контент требует проверки",
    submitting: false,
  });

  const loadTracks = useCallback(
    async ({ nextOffset = 0, nextQuery = query, nextStatus = statusFilter } = {}) => {
      setLoading(true);
      setError("");

      try {
        const response = await getAdminTracks({
          limit: TRACKS_LIMIT,
          offset: nextOffset,
          query: nextQuery,
          status: nextStatus,
        });
        setTracksData({
          tracks: response?.tracks ?? [],
          total: Number(response?.total ?? 0),
          limit: Number(response?.limit ?? TRACKS_LIMIT),
          offset: Number(response?.offset ?? nextOffset),
        });
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить список треков.");
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
      await loadTracks({ nextOffset: 0, nextQuery: query, nextStatus: statusFilter });
    }, query ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, statusFilter, refreshToken, loadTracks]);

  const hasMore = offset + TRACKS_LIMIT < tracksData.total;
  const canGoBack = offset > 0;

  const badgeSummary = useMemo(() => {
    const hidden = tracksData.tracks.filter((track) => track.isHidden).length;
    const local = tracksData.tracks.filter((track) => track.isLocalAudio).length;
    const hls = tracksData.tracks.filter((track) => track.hasHls).length;
    return { hidden, local, hls };
  }, [tracksData.tracks]);

  const openHideDialog = (track) => {
    setHideDialog({
      open: true,
      track,
      reason: track.hiddenReason || "Контент требует проверки",
      submitting: false,
    });
  };

  const closeHideDialog = () => {
    setHideDialog({
      open: false,
      track: null,
      reason: "Контент требует проверки",
      submitting: false,
    });
  };

  const updateTrackVisibility = (trackId, updates) => {
    setTracksData((current) => ({
      ...current,
      tracks: current.tracks.map((track) => (track.id === trackId ? { ...track, ...updates } : track)),
    }));
  };

  const handleHideTrack = async () => {
    if (!hideDialog.track?.id) {
      return;
    }

    const targetTrack = hideDialog.track;
    const reason = hideDialog.reason.trim() || "Контент требует проверки";
    setHideDialog((current) => ({ ...current, submitting: true }));
    setError("");
    setFeedback("");

    try {
      await hideAdminTrack(targetTrack.id, reason);
      closeHideDialog();
      updateTrackVisibility(targetTrack.id, {
        isHidden: true,
        hiddenReason: reason,
        hiddenByName: targetTrack.hiddenByName,
        hiddenAt: Date.now(),
      });
      setFeedback(`Трек "${targetTrack.title}" скрыт из публичного каталога.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось скрыть трек.");
      setHideDialog((current) => ({ ...current, submitting: false }));
    }
  };

  const handleUnhideTrack = async (track) => {
    setActionTrackId(track.id);
    setError("");
    setFeedback("");

    try {
      await unhideAdminTrack(track.id);
      updateTrackVisibility(track.id, {
        isHidden: false,
        hiddenReason: "",
        hiddenByName: "",
        hiddenAt: 0,
      });
      setFeedback(`Трек "${track.title}" снова доступен в публичном каталоге.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось вернуть трек в каталог.");
    } finally {
      setActionTrackId("");
    }
  };

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Контент и доступность</p>
          <h2 className={styles.title}>Треки и модерация</h2>
          <p className={styles.description}>
            Секция показывает, какие треки реально стримятся, у каких есть HLS и что сейчас скрыто из публичного каталога.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadTracks({ nextOffset: offset })}>
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
            placeholder="Поиск по id, названию, артисту или uploader"
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
        <span>Всего в выборке: {tracksData.total}</span>
        <span>Скрытых на странице: {badgeSummary.hidden}</span>
        <span>Local media: {badgeSummary.local}</span>
        <span>HLS-ready: {badgeSummary.hls}</span>
      </div>

      {feedback ? <p className={styles.feedback}>{feedback}</p> : null}

      {loading && !tracksData.tracks.length ? (
        <ResourceState loading title="Загружаем треки" description="Собираем список контента и статусы модерации." />
      ) : null}

      {error && !tracksData.tracks.length ? (
        <ResourceState title="Не удалось загрузить треки" description={error} actionLabel="Повторить" onAction={() => void loadTracks({ nextOffset: offset })} />
      ) : null}

      {!loading && !error && !tracksData.tracks.length ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>По этим фильтрам ничего не найдено</p>
          <p className={styles.emptyDescription}>Смени статус или поисковый запрос, чтобы увидеть нужные записи.</p>
        </div>
      ) : null}

      {tracksData.tracks.length ? (
        <div className={styles.cardList}>
          {tracksData.tracks.map((track) => (
            <article
              key={track.id}
              className={`${styles.card} ${track.isHidden ? styles.cardHidden : ""}`.trim()}
            >
              <div className={styles.cardMain}>
                <div className={styles.cover} style={{ background: track.cover || "linear-gradient(135deg, #303640, #14171b)" }} />

                <div className={styles.meta}>
                  <div className={styles.titleRow}>
                    <h3 className={styles.trackTitle}>{track.title}</h3>
                    {track.explicit ? <span className={styles.smallBadge}>Explicit</span> : null}
                  </div>

                  <p className={styles.trackArtist}>{track.artists}</p>

                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${track.isHidden ? styles.badgeHidden : styles.badgeVisible}`.trim()}>
                      {track.isHidden ? "Скрыт" : "В каталоге"}
                    </span>
                    <span className={styles.badge}>{track.isLocalAudio ? "Local" : "Remote"}</span>
                    <span className={styles.badge}>{track.hasHls ? "HLS" : "No HLS"}</span>
                    <span className={`${styles.badge} ${track.isStreamable ? styles.badgeHealthy : styles.badgeBroken}`.trim()}>
                      {track.isStreamable ? "Стримится" : "Нужно проверить"}
                    </span>
                  </div>

                  <div className={styles.details}>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>ID</span>
                      <span className={styles.detailValue}>{track.id}</span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Uploader</span>
                      <span className={styles.detailValue}>{track.uploaderUsername}</span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Добавлен</span>
                      <span className={styles.detailValue}>{formatDateTime(track.createdAt)}</span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Длительность</span>
                      <span className={styles.detailValue}>{formatDurationClock(track.durationSec)}</span>
                    </div>
                  </div>

                  {track.hiddenReason ? (
                    <p className={styles.reason}>
                      <strong>Причина модерации:</strong> {formatReason(track.hiddenReason)}
                      {track.hiddenByName ? ` • ${track.hiddenByName}` : ""}
                    </p>
                  ) : null}

                  {track.tags?.length ? (
                    <div className={styles.tags}>
                      {track.tags.map((tag) => (
                        <span key={tag} className={styles.tag}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={styles.cardActions}>
                {!track.isHidden ? (
                  <button type="button" className={styles.actionGhostButton} onClick={() => navigate(`/track/${track.id}`)}>
                    <FiExternalLink />
                    Открыть трек
                  </button>
                ) : null}

                <button
                  type="button"
                  className={styles.actionGhostButton}
                  onClick={() => navigate("/profile")}
                >
                  <FiHardDrive />
                  Открыть загрузки
                </button>

                {track.isHidden ? (
                  <button
                    type="button"
                    className={styles.actionPrimaryButton}
                    onClick={() => void handleUnhideTrack(track)}
                    disabled={actionTrackId === track.id}
                  >
                    <FiEye />
                    Вернуть в каталог
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.actionDangerButton}
                    onClick={() => openHideDialog(track)}
                  >
                    <FiEyeOff />
                    Скрыть из каталога
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {error && tracksData.tracks.length ? <p className={styles.inlineError}>{error}</p> : null}

      <footer className={styles.pagination}>
        <button type="button" className={styles.paginationButton} disabled={!canGoBack} onClick={() => void loadTracks({ nextOffset: Math.max(0, offset - TRACKS_LIMIT) })}>
          <FiChevronLeft />
          Назад
        </button>
        <span className={styles.paginationLabel}>
          {tracksData.total ? `${offset + 1}-${Math.min(offset + TRACKS_LIMIT, tracksData.total)} из ${tracksData.total}` : "0 результатов"}
        </span>
        <button type="button" className={styles.paginationButton} disabled={!hasMore} onClick={() => void loadTracks({ nextOffset: offset + TRACKS_LIMIT })}>
          Вперед
          <FiChevronRight />
        </button>
      </footer>

      <ModalDialog
        open={hideDialog.open}
        title="Скрыть трек из публичного каталога"
        description={
          hideDialog.track
            ? `Трек "${hideDialog.track.title}" перестанет попадать в каталог, подборки и поиск.`
            : ""
        }
        onClose={closeHideDialog}
        actions={
          <>
            <button type="button" className={styles.dialogGhostButton} onClick={closeHideDialog}>
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogDangerButton}
              onClick={() => void handleHideTrack()}
              disabled={hideDialog.submitting}
            >
              <FiRadio />
              Скрыть трек
            </button>
          </>
        }
      >
        <label className={styles.dialogField}>
          <span>Причина для админки</span>
          <textarea
            className={styles.dialogTextarea}
            value={hideDialog.reason}
            onChange={(event) => setHideDialog((current) => ({ ...current, reason: event.target.value }))}
            rows={4}
            maxLength={220}
            placeholder="Например: дубль, тестовая загрузка, некорректные метаданные"
          />
        </label>
      </ModalDialog>
    </section>
  );
}
