import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiArrowDown,
  FiArrowUp,
  FiChevronLeft,
  FiChevronRight,
  FiEdit2,
  FiExternalLink,
  FiPlus,
  FiRefreshCw,
  FiSearch,
  FiTrash2,
  FiUploadCloud,
  FiX,
} from "react-icons/fi";
import {
  createAdminRelease,
  deleteAdminRelease,
  getAdminReleaseOptions,
  getAdminReleases,
  updateAdminRelease,
} from "../api/musicApi.js";
import { formatDurationClock } from "../utils/formatters.js";
import ResourceState from "./ResourceState.jsx";
import ModalDialog from "./ModalDialog.jsx";
import styles from "./AdminReleasesSection.module.css";

const RELEASES_LIMIT = 8;
const releaseFilterOptions = [
  { id: "all", label: "Все" },
  { id: "published", label: "Опубликованы" },
  { id: "draft", label: "Черновики" },
];
const releaseTypeOptions = [
  { id: "single", label: "Single" },
  { id: "ep", label: "EP" },
  { id: "album", label: "Album" },
];
const releaseStatusOptions = [
  { id: "draft", label: "Черновик" },
  { id: "published", label: "Опубликован" },
];
const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function createEmptyForm() {
  return {
    id: "",
    title: "",
    artistId: "",
    type: "single",
    year: new Date().getFullYear(),
    cover: "",
    description: "",
    status: "draft",
    trackIds: [],
  };
}

function formatDateTime(value) {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Без даты";
  }
  return dateTimeFormatter.format(timestamp);
}

function normalizeText(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function resolveOptionLabel(options, value, fallback) {
  return options.find((option) => option.id === value)?.label || fallback;
}

function resolveEditorValidationMessage(form) {
  const title = String(form?.title ?? "").trim();
  const artistId = String(form?.artistId ?? "").trim();
  const trackCount = Array.isArray(form?.trackIds) ? form.trackIds.length : 0;

  if (!title) {
    return "Добавь название релиза.";
  }
  if (!artistId) {
    return "Выбери артиста.";
  }
  if (form?.type === "single" && trackCount !== 1) {
    return "Для single нужен ровно один трек.";
  }
  if ((form?.type === "ep" || form?.type === "album") && trackCount < 2) {
    return "Для EP и album нужно минимум два трека.";
  }

  return "";
}

export default function AdminReleasesSection({ refreshToken = 0, onChanged }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [releasesData, setReleasesData] = useState({ releases: [], total: 0, limit: RELEASES_LIMIT, offset: 0 });
  const [optionsData, setOptionsData] = useState({ artists: [], tracks: [] });
  const [loading, setLoading] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionReleaseId, setActionReleaseId] = useState("");
  const [trackQuery, setTrackQuery] = useState("");
  const [editor, setEditor] = useState({
    open: false,
    mode: "create",
    submitting: false,
    form: createEmptyForm(),
  });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    release: null,
    submitting: false,
  });

  const loadReleases = useCallback(
    async ({ nextOffset = 0, nextQuery = query, nextStatus = statusFilter } = {}) => {
      setLoading(true);
      setError("");

      try {
        const response = await getAdminReleases({
          limit: RELEASES_LIMIT,
          offset: nextOffset,
          query: nextQuery,
          status: nextStatus,
        });
        setReleasesData({
          releases: response?.releases ?? [],
          total: Number(response?.total ?? 0),
          limit: Number(response?.limit ?? RELEASES_LIMIT),
          offset: Number(response?.offset ?? nextOffset),
        });
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить релизы.");
      } finally {
        setLoading(false);
      }
    },
    [query, statusFilter]
  );

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const response = await getAdminReleaseOptions();
      setOptionsData({
        artists: response?.artists ?? [],
        tracks: response?.tracks ?? [],
      });
    } catch (err) {
      setError((current) => current || (err instanceof Error ? err.message : "Не удалось загрузить данные для релизов."));
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) {
        return;
      }
      await loadReleases({ nextOffset: 0, nextQuery: query, nextStatus: statusFilter });
    }, query ? 220 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, statusFilter, refreshToken, loadReleases]);

  useEffect(() => {
    void loadOptions();
  }, [refreshToken, loadOptions]);

  const hasMore = offset + RELEASES_LIMIT < releasesData.total;
  const canGoBack = offset > 0;

  const trackById = useMemo(
    () => new Map(optionsData.tracks.map((track) => [track.id, track])),
    [optionsData.tracks]
  );

  const availableTracks = useMemo(() => {
    const normalizedQuery = normalizeText(trackQuery);
    return optionsData.tracks.filter((track) => {
      if (editor.form.artistId && !track.artistIds.includes(editor.form.artistId)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return normalizeText(`${track.title} ${track.artists}`).includes(normalizedQuery);
    });
  }, [optionsData.tracks, editor.form.artistId, trackQuery]);

  const selectedTracks = useMemo(
    () => editor.form.trackIds.map((trackId) => trackById.get(trackId)).filter(Boolean),
    [editor.form.trackIds, trackById]
  );
  const editorArtistName = useMemo(
    () => optionsData.artists.find((artist) => artist.id === editor.form.artistId)?.name || "Артист не выбран",
    [editor.form.artistId, optionsData.artists]
  );
  const editorCover = editor.form.cover || selectedTracks[0]?.cover || "linear-gradient(135deg, #303640, #14171b)";
  const editorTypeLabel = resolveOptionLabel(releaseTypeOptions, editor.form.type, "Релиз");
  const editorStatusLabel = resolveOptionLabel(releaseStatusOptions, editor.form.status, "Черновик");

  const openCreateDialog = () => {
    setTrackQuery("");
    setError("");
    setFeedback("");
    setEditor({
      open: true,
      mode: "create",
      submitting: false,
      form: createEmptyForm(),
    });
  };

  const openEditDialog = (release) => {
    setTrackQuery("");
    setError("");
    setFeedback("");
    setEditor({
      open: true,
      mode: "edit",
      submitting: false,
      form: {
        id: release.id,
        title: release.title,
        artistId: release.artistId,
        type: release.type,
        year: release.year,
        cover: release.cover,
        description: release.description || "",
        status: release.status,
        trackIds: Array.isArray(release.trackIds) ? release.trackIds : [],
      },
    });
  };

  const closeEditor = () => {
    setEditor({
      open: false,
      mode: "create",
      submitting: false,
      form: createEmptyForm(),
    });
    setTrackQuery("");
  };

  const handleArtistChange = (artistId) => {
    setEditor((current) => ({
      ...current,
      form: {
        ...current.form,
        artistId,
        trackIds: current.form.trackIds.filter((trackId) => {
          const track = trackById.get(trackId);
          return artistId ? Boolean(track?.artistIds.includes(artistId)) : true;
        }),
      },
    }));
  };

  const handleToggleTrack = (track) => {
    setEditor((current) => {
      const exists = current.form.trackIds.includes(track.id);
      const nextTrackIds = exists
        ? current.form.trackIds.filter((item) => item !== track.id)
        : [...current.form.trackIds, track.id];
      const nextCover = current.form.cover || track.cover || "";
      const nextTitle =
        current.mode === "create" && !current.form.title && !exists && nextTrackIds.length === 1
          ? track.title
          : current.form.title;

      return {
        ...current,
        form: {
          ...current.form,
          cover: nextCover,
          title: nextTitle,
          trackIds: nextTrackIds,
        },
      };
    });
  };

  const moveSelectedTrack = (index, direction) => {
    setEditor((current) => {
      const nextTrackIds = [...current.form.trackIds];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= nextTrackIds.length) {
        return current;
      }
      [nextTrackIds[index], nextTrackIds[targetIndex]] = [nextTrackIds[targetIndex], nextTrackIds[index]];
      return {
        ...current,
        form: {
          ...current.form,
          trackIds: nextTrackIds,
        },
      };
    });
  };

  const handleSaveRelease = async () => {
    if (resolveEditorValidationMessage(editor.form)) {
      return;
    }

    setEditor((current) => ({ ...current, submitting: true }));
    setError("");
    setFeedback("");

    const payload = {
      title: editor.form.title,
      artistId: editor.form.artistId,
      type: editor.form.type,
      year: editor.form.year,
      cover: editor.form.cover,
      description: editor.form.description,
      status: editor.form.status,
      trackIds: editor.form.trackIds,
    };

    try {
      if (editor.mode === "create") {
        await createAdminRelease(payload);
        setFeedback(`Релиз "${payload.title}" создан.`);
      } else {
        await updateAdminRelease(editor.form.id, payload);
        setFeedback(`Релиз "${payload.title}" обновлен.`);
      }

      closeEditor();
      await Promise.all([loadReleases({ nextOffset: offset }), loadOptions()]);
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить релиз.");
      setEditor((current) => ({ ...current, submitting: false }));
    }
  };

  const handleQuickStatusToggle = async (release) => {
    setActionReleaseId(release.id);
    setError("");
    setFeedback("");

    try {
      const nextStatus = release.isPublished ? "draft" : "published";
      await updateAdminRelease(release.id, {
        title: release.title,
        artistId: release.artistId,
        type: release.type,
        year: release.year,
        cover: release.cover,
        description: release.description,
        status: nextStatus,
        trackIds: release.trackIds,
      });
      await loadReleases({ nextOffset: offset });
      setFeedback(
        nextStatus === "published"
          ? `Релиз "${release.title}" опубликован.`
          : `Релиз "${release.title}" снят с публикации.`
      );
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить статус релиза.");
    } finally {
      setActionReleaseId("");
    }
  };

  const handleDeleteRelease = async () => {
    if (!deleteDialog.release?.id) {
      return;
    }

    setDeleteDialog((current) => ({ ...current, submitting: true }));
    setError("");
    setFeedback("");

    try {
      await deleteAdminRelease(deleteDialog.release.id);
      setFeedback(`Релиз "${deleteDialog.release.title}" удален.`);
      setDeleteDialog({ open: false, release: null, submitting: false });
      await loadReleases({ nextOffset: Math.min(offset, Math.max(releasesData.total - 1, 0)) });
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить релиз.");
      setDeleteDialog((current) => ({ ...current, submitting: false }));
    }
  };

  const summary = useMemo(() => {
    const draftCount = releasesData.releases.filter((release) => !release.isPublished).length;
    const publishedCount = releasesData.releases.filter((release) => release.isPublished).length;
    return { draftCount, publishedCount };
  }, [releasesData.releases]);

  const editorValidationMessage = useMemo(() => resolveEditorValidationMessage(editor.form), [editor.form]);
  const canSubmitEditor = !editor.submitting && !editorValidationMessage;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Публикация и витрина</p>
          <h2 className={styles.title}>Релизы и публикация</h2>
          <p className={styles.description}>
            Загруженные треки живут отдельно. Здесь из них собираются single, EP и album, которые потом появляются
            у артистов и в блоке релизов по подпискам.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.refreshButton} onClick={() => void loadReleases({ nextOffset: offset })}>
            <FiRefreshCw />
            Обновить
          </button>
          <button type="button" className={styles.actionPrimaryButton} onClick={openCreateDialog}>
            <FiPlus />
            Создать релиз
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <FiSearch />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по релизу или артисту"
            autoComplete="off"
          />
        </label>
        <div className={styles.filters}>
          {releaseFilterOptions.map((option) => (
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
        <span>Всего релизов: {releasesData.total}</span>
        <span>Опубликованы на странице: {summary.publishedCount}</span>
        <span>Черновики на странице: {summary.draftCount}</span>
      </div>

      {feedback ? <p className={styles.feedback}>{feedback}</p> : null}
      {error && !releasesData.releases.length ? (
        <ResourceState title="Не удалось загрузить релизы" description={error} actionLabel="Повторить" onAction={() => void loadReleases({ nextOffset: offset })} />
      ) : null}
      {loading && !releasesData.releases.length ? (
        <ResourceState loading title="Загружаем релизы" description="Собираем витрину публикаций и черновиков." />
      ) : null}
      {optionsLoading && !optionsData.tracks.length ? (
        <ResourceState loading title="Готовим конструктор" description="Подтягиваем артистов и треки для сборки релиза." />
      ) : null}
      {!loading && !error && !releasesData.releases.length ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Пока нет релизов</p>
          <p className={styles.emptyDescription}>
            Загрузи треки, а затем собери из них single, EP или album в этом разделе.
          </p>
        </div>
      ) : null}

      {releasesData.releases.length ? (
        <div className={styles.cardList}>
          {releasesData.releases.map((release) => (
            <article key={release.id} className={`${styles.card} ${!release.isPublished ? styles.cardDraft : ""}`.trim()}>
              <div className={styles.cardMain}>
                <div className={styles.cover} style={{ background: release.cover || "linear-gradient(135deg, #303640, #14171b)" }} />
                <div className={styles.meta}>
                  <div className={styles.titleRow}>
                    <h3 className={styles.releaseTitle}>{release.title}</h3>
                    <span
                      className={`${styles.statusBadge} ${release.isPublished ? styles.statusBadgePublished : styles.statusBadgeDraft}`.trim()}
                    >
                      {release.isPublished ? "Опубликован" : "Черновик"}
                    </span>
                    <span className={styles.smallBadge}>{String(release.type).toUpperCase()}</span>
                  </div>
                  <p className={styles.releaseArtist}>{release.artistName}</p>
                  <div className={styles.badges}>
                    <span className={styles.badge}>{release.year}</span>
                    <span className={styles.badge}>{release.trackCount} треков</span>
                    <span className={styles.badge}>ID: {release.id}</span>
                  </div>
                  {release.description ? <p className={styles.releaseDescription}>{release.description}</p> : null}
                  <div className={styles.details}>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Создан</span>
                      <span className={styles.detailValue}>{formatDateTime(release.createdAt)}</span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Опубликован</span>
                      <span className={styles.detailValue}>
                        {release.isPublished ? formatDateTime(release.publishedAt) : "Пока нет"}
                      </span>
                    </div>
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Создал</span>
                      <span className={styles.detailValue}>{release.createdByUsername || "admin"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.cardActions}>
                {release.isPublished ? (
                  <button
                    type="button"
                    className={styles.actionGhostButton}
                    onClick={() => navigate(`/release/${release.id}`)}
                  >
                    <FiExternalLink />
                    Открыть релиз
                  </button>
                ) : null}
                <button
                  type="button"
                  className={styles.actionGhostButton}
                  onClick={() => openEditDialog(release)}
                >
                  <FiEdit2 />
                  Редактировать
                </button>
                <button
                  type="button"
                  className={styles.actionPrimaryButton}
                  disabled={actionReleaseId === release.id}
                  onClick={() => void handleQuickStatusToggle(release)}
                >
                  <FiUploadCloud />
                  {release.isPublished ? "В черновик" : "Опубликовать"}
                </button>
                <button
                  type="button"
                  className={styles.actionDangerButton}
                  onClick={() => setDeleteDialog({ open: true, release, submitting: false })}
                >
                  <FiTrash2 />
                  Удалить
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {error && releasesData.releases.length ? <p className={styles.inlineError}>{error}</p> : null}

      <footer className={styles.pagination}>
        <button
          type="button"
          className={styles.paginationButton}
          disabled={!canGoBack}
          onClick={() => void loadReleases({ nextOffset: Math.max(0, offset - RELEASES_LIMIT) })}
        >
          <FiChevronLeft />
          Назад
        </button>
        <span className={styles.paginationLabel}>
          {releasesData.total
            ? `${offset + 1}-${Math.min(offset + RELEASES_LIMIT, releasesData.total)} из ${releasesData.total}`
            : "0 результатов"}
        </span>
        <button
          type="button"
          className={styles.paginationButton}
          disabled={!hasMore}
          onClick={() => void loadReleases({ nextOffset: offset + RELEASES_LIMIT })}
        >
          Вперед
          <FiChevronRight />
        </button>
      </footer>

      <ModalDialog
        open={editor.open}
        title={editor.mode === "create" ? "Создать релиз" : "Редактировать релиз"}
        description="Собери релиз из уже загруженных треков, задай статус и публикуй тогда, когда он готов."
        onClose={closeEditor}
        dialogClassName={styles.editorDialog}
        contentClassName={styles.editorDialogContent}
        actions={
          <>
            <button type="button" className={styles.dialogGhostButton} onClick={closeEditor}>
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogPrimaryButton}
              onClick={() => void handleSaveRelease()}
              disabled={!canSubmitEditor}
            >
              {editor.mode === "create" ? "Создать" : "Сохранить"}
            </button>
          </>
        }
      >
        <div className={styles.editorLayout}>
          <div className={styles.editorSidebar}>
            <div className={styles.releasePreview}>
              <div className={styles.releasePreviewCover} style={{ background: editorCover }} />
              <div className={styles.releasePreviewMeta}>
                <div className={styles.releasePreviewBadges}>
                  <span className={styles.smallBadge}>{editorTypeLabel}</span>
                  <span
                    className={`${styles.statusBadge} ${editor.form.status === "published" ? styles.statusBadgePublished : styles.statusBadgeDraft}`.trim()}
                  >
                    {editorStatusLabel}
                  </span>
                </div>
                <h3 className={styles.releasePreviewTitle}>{editor.form.title || "Название релиза"}</h3>
                <p className={styles.releasePreviewArtist}>{editorArtistName}</p>
                <p className={styles.releasePreviewDescription}>
                  {editor.form.description || "Здесь можно быстро проверить, как релиз выглядит до публикации."}
                </p>
                <div className={styles.releasePreviewFacts}>
                  <span className={styles.badge}>{editor.form.year || "Без года"}</span>
                  <span className={styles.badge}>{selectedTracks.length} треков</span>
                </div>
              </div>
            </div>

            <div className={styles.formGrid}>
          <label className={styles.dialogField}>
            <span>Название релиза</span>
            <input
              className={styles.dialogInput}
              value={editor.form.title}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  form: { ...current.form, title: event.target.value },
                }))
              }
              placeholder="Например: Мой новый сингл"
              maxLength={120}
            />
          </label>

          <label className={styles.dialogField}>
            <span>Артист</span>
            <select
              className={styles.dialogSelect}
              value={editor.form.artistId}
              onChange={(event) => handleArtistChange(event.target.value)}
            >
              <option value="">Выбери артиста</option>
              {optionsData.artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.dialogField}>
            <span>Тип релиза</span>
            <div className={styles.segmentedRow}>
              {releaseTypeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.segmentedButton} ${editor.form.type === option.id ? styles.segmentedButtonActive : ""}`.trim()}
                  onClick={() =>
                    setEditor((current) => ({
                      ...current,
                      form: { ...current.form, type: option.id },
                    }))
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.dialogField}>
            <span>Статус</span>
            <div className={styles.segmentedRow}>
              {releaseStatusOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.segmentedButton} ${editor.form.status === option.id ? styles.segmentedButtonActive : ""}`.trim()}
                  onClick={() =>
                    setEditor((current) => ({
                      ...current,
                      form: { ...current.form, status: option.id },
                    }))
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className={styles.dialogField}>
            <span>Год</span>
            <input
              className={styles.dialogInput}
              type="number"
              min="1900"
              max={String(new Date().getFullYear() + 2)}
              value={editor.form.year}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  form: { ...current.form, year: event.target.value },
                }))
              }
            />
          </label>

          <label className={`${styles.dialogField} ${styles.dialogFieldFull}`.trim()}>
            <span>Обложка</span>
            <input
              className={styles.dialogInput}
              value={editor.form.cover}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  form: { ...current.form, cover: event.target.value },
                }))
              }
              placeholder="Можно оставить обложку первого выбранного трека"
            />
          </label>

          <label className={`${styles.dialogField} ${styles.dialogFieldFull}`.trim()}>
            <span>Описание</span>
            <textarea
              className={styles.dialogTextarea}
              value={editor.form.description}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  form: { ...current.form, description: event.target.value },
                }))
              }
              rows={3}
              maxLength={280}
              placeholder="Короткое описание релиза для админки"
            />
          </label>
            </div>
          </div>

          <div className={styles.editorTracks}>
            <div className={styles.trackBuilder}>
          <div className={styles.trackBuilderHeader}>
            <div>
              <h3 className={styles.builderTitle}>Треки релиза</h3>
              <p className={styles.builderText}>
                Добавляй уже загруженные треки выбранного артиста и выставляй порядок. Single = 1 трек, EP/album = от 2 треков.
              </p>
            </div>
            <label className={styles.trackSearch}>
              <FiSearch />
              <input
                type="search"
                value={trackQuery}
                onChange={(event) => setTrackQuery(event.target.value)}
                placeholder="Поиск по трекам"
                autoComplete="off"
              />
            </label>
          </div>

          {editorValidationMessage ? <p className={styles.inlineError}>{editorValidationMessage}</p> : null}

          <div className={styles.builderGrid}>
            <div className={styles.trackPool}>
              <h4 className={styles.builderSubtitle}>Доступные треки</h4>
              <div className={styles.trackPoolList}>
                {availableTracks.length ? (
                  availableTracks.map((track) => {
                    const selected = editor.form.trackIds.includes(track.id);
                    return (
                      <button
                        key={track.id}
                        type="button"
                        className={`${styles.trackPoolItem} ${selected ? styles.trackPoolItemSelected : ""}`.trim()}
                        onClick={() => handleToggleTrack(track)}
                      >
                        <span className={styles.trackPoolCover} style={{ background: track.cover }} />
                        <span className={styles.trackPoolMeta}>
                          <span className={styles.trackPoolTitle}>{track.title}</span>
                          <span className={styles.trackPoolArtist}>
                            {track.artists} • {formatDurationClock(track.durationSec)}
                          </span>
                        </span>
                        <span className={styles.trackPoolAction}>{selected ? "Убрать" : "Добавить"}</span>
                      </button>
                    );
                  })
                ) : (
                  <p className={styles.builderEmpty}>Под выбранного артиста пока не найдено треков.</p>
                )}
              </div>
            </div>

            <div className={styles.selectedTracks}>
              <h4 className={styles.builderSubtitle}>Порядок в релизе: {selectedTracks.length}</h4>
              <div className={styles.selectedTrackList}>
                {selectedTracks.length ? (
                  selectedTracks.map((track, index) => (
                    <div key={track.id} className={styles.selectedTrackItem}>
                      <span className={styles.selectedTrackIndex}>{index + 1}</span>
                      <span className={styles.trackPoolCover} style={{ background: track.cover }} />
                      <span className={styles.trackPoolMeta}>
                        <span className={styles.trackPoolTitle}>{track.title}</span>
                        <span className={styles.trackPoolArtist}>{track.artists}</span>
                      </span>
                      <div className={styles.selectedTrackActions}>
                        <button
                          type="button"
                          className={styles.iconGhostButton}
                          onClick={() => moveSelectedTrack(index, -1)}
                          disabled={index === 0}
                        >
                          <FiArrowUp />
                        </button>
                        <button
                          type="button"
                          className={styles.iconGhostButton}
                          onClick={() => moveSelectedTrack(index, 1)}
                          disabled={index === selectedTracks.length - 1}
                        >
                          <FiArrowDown />
                        </button>
                        <button
                          type="button"
                          className={styles.iconDangerButton}
                          onClick={() => handleToggleTrack(track)}
                        >
                          <FiX />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className={styles.builderEmpty}>Добавь хотя бы один трек, чтобы собрать релиз.</p>
                )}
              </div>
            </div>
              </div>
            </div>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={deleteDialog.open}
        title="Удалить релиз?"
        description={
          deleteDialog.release
            ? `Релиз "${deleteDialog.release.title}" будет удален. Сами треки при этом останутся в каталоге.`
            : ""
        }
        onClose={() => setDeleteDialog({ open: false, release: null, submitting: false })}
        actions={
          <>
            <button
              type="button"
              className={styles.dialogGhostButton}
              onClick={() => setDeleteDialog({ open: false, release: null, submitting: false })}
            >
              Отмена
            </button>
            <button
              type="button"
              className={styles.dialogDangerButton}
              onClick={() => void handleDeleteRelease()}
              disabled={deleteDialog.submitting}
            >
              Удалить
            </button>
          </>
        }
      />
    </section>
  );
}
