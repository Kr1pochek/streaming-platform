import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiCheckCircle,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiXCircle,
} from "react-icons/fi";
import {
  approveAdminValidationRelease,
  deleteAdminValidationRelease,
  getAdminValidationQueue,
  rejectAdminValidationRelease,
} from "../api/musicApi.js";
import { formatDurationClock } from "../utils/formatters.js";
import ModalDialog from "./ModalDialog.jsx";
import ResourceState from "./ResourceState.jsx";
import styles from "./AdminValidationSection.module.css";

const VALIDATION_LIMIT = 8;
const statusOptions = [
  { id: "pending", label: "На проверке" },
  { id: "rejected", label: "Отклоненные" },
  { id: "all", label: "Все заявки" },
];
const VALIDATION_STATUS_STORAGE_KEY = "admin.validation.statusFilter.v1";
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});
let validationHlsLoaderPromise = null;

function loadValidationHlsLibrary() {
  if (!validationHlsLoaderPromise) {
    validationHlsLoaderPromise = import("hls.js").then((module) => module.default ?? module);
  }
  return validationHlsLoaderPromise;
}

function getInitialStatusFilter() {
  if (typeof window === "undefined") {
    return "pending";
  }

  try {
    const savedStatus = window.sessionStorage.getItem(VALIDATION_STATUS_STORAGE_KEY);
    return statusOptions.some((option) => option.id === savedStatus) ? savedStatus : "pending";
  } catch {
    return "pending";
  }
}

function formatDateTime(value) {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Без даты";
  }
  return dateTimeFormatter.format(timestamp);
}

function resolveStatusLabel(status = "") {
  if (status === "published") {
    return "Опубликован";
  }
  if (status === "rejected") {
    return "Отклонен";
  }
  if (status === "draft") {
    return "Черновик";
  }
  return "На проверке";
}

function ValidationAudioPreview({ track }) {
  const audioRef = useRef(null);
  const audioUrl = String(track?.audioUrl ?? "").trim();
  const hlsUrl = String(track?.hlsUrl ?? "").trim();
  const title = String(track?.title ?? "").trim() || "track";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    let cancelled = false;
    let hls = null;

    const resetAudio = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };

    const fallbackToAudio = () => {
      if (cancelled || !audioUrl) {
        return;
      }
      audio.src = audioUrl;
      audio.load();
    };

    resetAudio();

    if (!hlsUrl) {
      fallbackToAudio();
      return () => {
        cancelled = true;
        resetAudio();
      };
    }

    const canUseNativeHls = audio.canPlayType("application/vnd.apple.mpegurl") !== "";

    loadValidationHlsLibrary()
      .then((HlsLibrary) => {
        if (cancelled) {
          return;
        }

        const canUseHlsJs = Boolean(
          HlsLibrary && typeof HlsLibrary.isSupported === "function" && HlsLibrary.isSupported()
        );

        if (canUseHlsJs) {
          hls = new HlsLibrary({
            enableWorker: true,
            backBufferLength: 90,
          });
          hls.attachMedia(audio);
          hls.on(HlsLibrary.Events.MEDIA_ATTACHED, () => {
            if (!cancelled) {
              hls.loadSource(hlsUrl);
            }
          });
          hls.on(HlsLibrary.Events.ERROR, (_event, data) => {
            if (!data?.fatal || cancelled) {
              return;
            }
            hls.destroy();
            hls = null;
            fallbackToAudio();
          });
          return;
        }

        if (canUseNativeHls) {
          audio.src = hlsUrl;
          audio.load();
          return;
        }

        fallbackToAudio();
      })
      .catch(() => {
        if (canUseNativeHls && !cancelled) {
          audio.src = hlsUrl;
          audio.load();
          return;
        }
        fallbackToAudio();
      });

    return () => {
      cancelled = true;
      if (hls) {
        hls.destroy();
        hls = null;
      }
      resetAudio();
    };
  }, [audioUrl, hlsUrl]);

  return (
    <audio
      ref={audioRef}
      className={styles.audioPreview}
      controls
      preload="none"
      aria-label={`Preview ${title}`}
    />
  );
}

export default function AdminValidationSection({ refreshToken = 0, onChanged }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(getInitialStatusFilter);
  const [offset, setOffset] = useState(0);
  const [queueData, setQueueData] = useState({ releases: [], total: 0, limit: VALIDATION_LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionReleaseId, setActionReleaseId] = useState("");
  const [rejectDialog, setRejectDialog] = useState({
    open: false,
    release: null,
    reason: "Не прошел модерацию",
    submitting: false,
  });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    release: null,
    submitting: false,
  });

  const loadQueue = useCallback(
    async ({ nextOffset = 0, nextQuery = query, nextStatus = statusFilter } = {}) => {
      setLoading(true);
      setError("");

      try {
        const response = await getAdminValidationQueue({
          limit: VALIDATION_LIMIT,
          offset: nextOffset,
          query: nextQuery,
          status: nextStatus,
        });
        setQueueData({
          releases: response?.releases ?? [],
          total: Number(response?.total ?? 0),
          limit: Number(response?.limit ?? VALIDATION_LIMIT),
          offset: Number(response?.offset ?? nextOffset),
        });
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить очередь валидации.");
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
      await loadQueue({ nextOffset: 0, nextQuery: query, nextStatus: statusFilter });
    }, query ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, statusFilter, refreshToken, loadQueue]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.setItem(VALIDATION_STATUS_STORAGE_KEY, statusFilter);
    } catch {
      // keep in-memory filter if sessionStorage is unavailable
    }
  }, [statusFilter]);

  const hasMore = offset + VALIDATION_LIMIT < queueData.total;
  const canGoBack = offset > 0;

  const summary = useMemo(() => {
    const pending = queueData.releases.filter((release) => release.status === "pending").length;
    const rejected = queueData.releases.filter((release) => release.status === "rejected").length;
    const tracks = queueData.releases.reduce((sum, release) => sum + Number(release.trackCount ?? 0), 0);
    return { pending, rejected, tracks };
  }, [queueData.releases]);

  const closeRejectDialog = () => {
    setRejectDialog({
      open: false,
      release: null,
      reason: "Не прошел модерацию",
      submitting: false,
    });
  };

  const closeDeleteDialog = () => {
    setDeleteDialog({
      open: false,
      release: null,
      submitting: false,
    });
  };

  const updateReleaseInQueue = (releaseId, updates) => {
    setQueueData((current) => ({
      ...current,
      releases: current.releases.map((release) => (release.id === releaseId ? { ...release, ...updates } : release)),
    }));
  };

  const handleApprove = async (release) => {
    setActionReleaseId(release.id);
    setError("");
    setFeedback("");

    try {
      const response = await approveAdminValidationRelease(release.id);
      const publishedAt = Number(response?.release?.publishedAt ?? Date.now());
      updateReleaseInQueue(release.id, {
        status: "published",
        isPublished: true,
        isPending: false,
        publishedAt,
        hiddenTrackCount: 0,
        tracks: (release.tracks ?? []).map((track) => ({
          ...track,
          isHidden: false,
          hiddenReason: "",
        })),
      });
      setFeedback(`Релиз "${release.title}" опубликован.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось одобрить релиз.");
    } finally {
      setActionReleaseId("");
    }
  };

  const handleReject = async () => {
    if (!rejectDialog.release?.id) {
      return;
    }

    const targetRelease = rejectDialog.release;
    setRejectDialog((current) => ({ ...current, submitting: true }));
    setError("");
    setFeedback("");

    try {
      await rejectAdminValidationRelease(targetRelease.id, rejectDialog.reason.trim() || "Не прошел модерацию");
      setFeedback(`Релиз "${targetRelease.title}" отклонен.`);
      closeRejectDialog();
      await loadQueue({ nextOffset: offset });
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отклонить релиз.");
      setRejectDialog((current) => ({ ...current, submitting: false }));
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.release?.id) {
      return;
    }

    const targetRelease = deleteDialog.release;
    setDeleteDialog((current) => ({ ...current, submitting: true }));
    setError("");
    setFeedback("");

    try {
      const response = await deleteAdminValidationRelease(targetRelease.id);
      const deletedTrackCount = Number(response?.deletedTrackCount ?? 0);
      setFeedback(
        deletedTrackCount > 0
          ? `Заявка "${targetRelease.title}" удалена. Убрано треков: ${deletedTrackCount}.`
          : `Заявка "${targetRelease.title}" удалена.`
      );
      closeDeleteDialog();
      await loadQueue({ nextOffset: Math.max(0, Math.min(offset, queueData.total - 1 - VALIDATION_LIMIT)) });
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить заявку.");
      setDeleteDialog((current) => ({ ...current, submitting: false }));
    }
  };

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Модерация загрузок</p>
          <h2 className={styles.title}>Валидация релизов</h2>
          <p className={styles.description}>
            Новые single, EP и album сначала попадают сюда. После одобрения треки открываются, а релиз появляется на сайте.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadQueue({ nextOffset: offset })}>
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
            placeholder="Поиск по релизу, артисту, треку или uploader"
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
        <span>Всего в фильтре: {queueData.total}</span>
        <span>На странице pending: {summary.pending}</span>
        <span>Отклонено на странице: {summary.rejected}</span>
        <span>Треков на странице: {summary.tracks}</span>
      </div>

      {feedback ? <p className={styles.feedback}>{feedback}</p> : null}

      {loading && !queueData.releases.length ? (
        <ResourceState loading title="Загружаем очередь" description="Собираем релизы и треки, ожидающие проверки." />
      ) : null}

      {error && !queueData.releases.length ? (
        <ResourceState
          title="Не удалось загрузить очередь"
          description={error}
          actionLabel="Повторить"
          onAction={() => void loadQueue({ nextOffset: offset })}
        />
      ) : null}

      {!loading && !error && !queueData.releases.length ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Очередь пуста</p>
          <p className={styles.emptyDescription}>Новые загрузки появятся здесь до публикации в релизах.</p>
        </div>
      ) : null}

      {queueData.releases.length ? (
        <div className={styles.cardList}>
          {queueData.releases.map((release) => {
            const isRejected = release.status === "rejected";
            const isPublished = release.status === "published";
            return (
              <article
                key={release.id}
                className={`${styles.card} ${isRejected ? styles.cardRejected : styles.cardPending}`.trim()}
              >
                <div className={styles.cardMain}>
                  <div
                    className={styles.cover}
                    style={{ background: release.cover || "linear-gradient(135deg, #303640, #14171b)" }}
                  />
                  <div className={styles.meta}>
                    <div className={styles.titleRow}>
                      <h3 className={styles.releaseTitle}>{release.title}</h3>
                      <span className={`${styles.statusBadge} ${isRejected ? styles.statusBadgeRejected : ""}`.trim()}>
                        {resolveStatusLabel(release.status)}
                      </span>
                      <span className={styles.smallBadge}>{String(release.type).toUpperCase()}</span>
                    </div>
                    <p className={styles.releaseArtist}>{release.artistName}</p>
                    <div className={styles.badges}>
                      <span className={styles.badge}>{release.year}</span>
                      <span className={styles.badge}>{release.trackCount} треков</span>
                      <span className={styles.badge}>ID: {release.id}</span>
                    </div>
                    <div className={styles.details}>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Загружен</span>
                        <span className={styles.detailValue}>{formatDateTime(release.createdAt)}</span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Создал</span>
                        <span className={styles.detailValue}>{release.createdByUsername || "system"}</span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>Скрытых треков</span>
                        <span className={styles.detailValue}>{release.hiddenTrackCount ?? 0}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.trackList}>
                  {(release.tracks ?? []).map((track, index) => (
                    <div key={track.id} className={styles.trackItem}>
                      <span className={styles.trackIndex}>{index + 1}</span>
                      <span className={styles.trackCover} style={{ background: track.cover }} />
                      <span className={styles.trackMeta}>
                        <span className={styles.trackTitle}>{track.title}</span>
                        <span className={styles.trackArtist}>
                          {track.artists} · {formatDurationClock(track.durationSec)} · {track.uploaderUsername}
                        </span>
                      </span>
                      {track.audioUrl || track.hlsUrl ? (
                        <ValidationAudioPreview track={track} />
                      ) : (
                        <span className={styles.audioUnavailable}>Нет аудио</span>
                      )}
                      <span className={`${styles.trackStatus} ${track.isHidden ? styles.trackStatusHidden : ""}`.trim()}>
                        {track.isHidden ? "Скрыт" : "Открыт"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className={styles.cardActions}>
                  {isPublished ? (
                    <button type="button" className={styles.actionPrimaryButton} disabled>
                      <FiCheckCircle />
                      Опубликовано
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.actionPrimaryButton}
                      disabled={actionReleaseId === release.id}
                      onClick={() => void handleApprove(release)}
                    >
                      <FiCheckCircle />
                      Одобрить и опубликовать
                    </button>
                  )}
                  {isPublished ? null : isRejected ? (
                    <button
                      type="button"
                      className={styles.actionDangerButton}
                      onClick={() => setDeleteDialog({ open: true, release, submitting: false })}
                    >
                      <FiTrash2 />
                      Удалить заявку
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.actionDangerButton}
                      onClick={() => setRejectDialog({ open: true, release, reason: "Не прошел модерацию", submitting: false })}
                    >
                      <FiXCircle />
                      Отклонить
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {error && queueData.releases.length ? <p className={styles.inlineError}>{error}</p> : null}

      <footer className={styles.pagination}>
        <button
          type="button"
          className={styles.paginationButton}
          disabled={!canGoBack}
          onClick={() => void loadQueue({ nextOffset: Math.max(0, offset - VALIDATION_LIMIT) })}
        >
          <FiChevronLeft />
          Назад
        </button>
        <span className={styles.paginationLabel}>
          {queueData.total
            ? `${offset + 1}-${Math.min(offset + VALIDATION_LIMIT, queueData.total)} из ${queueData.total}`
            : "0 результатов"}
        </span>
        <button
          type="button"
          className={styles.paginationButton}
          disabled={!hasMore}
          onClick={() => void loadQueue({ nextOffset: offset + VALIDATION_LIMIT })}
        >
          Вперед
          <FiChevronRight />
        </button>
      </footer>

      <ModalDialog
        open={rejectDialog.open}
        title="Отклонить релиз?"
        description={
          rejectDialog.release
            ? `Релиз "${rejectDialog.release.title}" останется скрытым, а его треки не попадут в публичный каталог.`
            : ""
        }
        onClose={closeRejectDialog}
        actions={
          <>
            <button type="button" className={styles.dialogGhostButton} onClick={closeRejectDialog}>
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogDangerButton}
              onClick={() => void handleReject()}
              disabled={rejectDialog.submitting}
            >
              <FiClock />
              Отклонить
            </button>
          </>
        }
      >
        <label className={styles.dialogField}>
          <span>Причина для админки</span>
          <textarea
            className={styles.dialogTextarea}
            value={rejectDialog.reason}
            onChange={(event) => setRejectDialog((current) => ({ ...current, reason: event.target.value }))}
            rows={4}
            maxLength={220}
            placeholder="Например: неверная обложка, дубликат, некорректные метаданные"
          />
        </label>
      </ModalDialog>

      <ModalDialog
        open={deleteDialog.open}
        title="Удалить заявку?"
        description={
          deleteDialog.release
            ? `Отклоненная заявка "${deleteDialog.release.title}" исчезнет из очереди валидации. Это действие нельзя отменить.`
            : ""
        }
        onClose={deleteDialog.submitting ? undefined : closeDeleteDialog}
        actions={
          <>
            <button
              type="button"
              className={styles.dialogGhostButton}
              onClick={closeDeleteDialog}
              disabled={deleteDialog.submitting}
            >
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogDangerButton}
              onClick={() => void handleDelete()}
              disabled={deleteDialog.submitting}
            >
              <FiTrash2 />
              Удалить
            </button>
          </>
        }
      />
    </section>
  );
}
