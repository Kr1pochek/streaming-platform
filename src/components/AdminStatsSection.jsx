import styles from "./AdminStatsSection.module.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function statValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function formatDateTime(value) {
  const timestamp = Number(value ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Без даты";
  }
  return dateTimeFormatter.format(timestamp);
}

function trackWord(count) {
  const safeCount = Math.max(0, Number(count ?? 0));
  const remainder100 = safeCount % 100;
  const remainder10 = safeCount % 10;
  if (remainder100 >= 11 && remainder100 <= 14) {
    return "треков";
  }
  if (remainder10 === 1) {
    return "трек";
  }
  if (remainder10 >= 2 && remainder10 <= 4) {
    return "трека";
  }
  return "треков";
}

function formatTrackCount(count) {
  const safeCount = Math.max(0, Number(count ?? 0));
  return `${safeCount} ${trackWord(safeCount)}`;
}

function buildActionItems(data) {
  const totals = data?.totals ?? {};
  const catalogHealth = data?.catalogHealth ?? {};
  const mediaHealth = data?.mediaHealth ?? {};
  const topUploaders = Array.isArray(data?.userHighlights?.topUploaders) ? data.userHighlights.topUploaders : [];
  const items = [];

  if (catalogHealth.sparseCatalog) {
    const missingTracks = Math.max(6 - statValue(catalogHealth.visibleTracks), 1);
    items.push(`Добавить еще хотя бы ${formatTrackCount(missingTracks)}, чтобы выйти из sparse-режима.`);
  }

  const mediaIssues = statValue(mediaHealth.missingLocalFiles) + statValue(mediaHealth.invalidLocalUrls);
  if (mediaIssues > 0) {
    items.push(`Разобраться с local media: сейчас ${mediaIssues} проблемных записей влияют на каталог.`);
  }

  if (statValue(catalogHealth.publicPlaylistsEmpty) > 0) {
    items.push("Проверить пустые сидовые плейлисты и решить, оставить их как скрытые или перепривязать к новым трекам.");
  }

  if (statValue(totals.hiddenTracks) > 0) {
    items.push("Просмотреть скрытые треки и вернуть в каталог то, что уже можно публиковать.");
  }

  if (!topUploaders.length) {
    items.push("Нужны хотя бы тестовые загрузки от пользователей, чтобы полноценно проверить цепочку модерации.");
  }

  if (!items.length) {
    items.push("Контур выглядит стабильно. Следующий шаг — расширять контент и проверять UX уже на большем каталоге.");
  }

  return items;
}

function StatusPill({ children, tone = "neutral" }) {
  return (
    <span className={`${styles.itemBadge} ${styles[`itemBadge${tone[0].toUpperCase()}${tone.slice(1)}`]}`.trim()}>
      {children}
    </span>
  );
}

export default function AdminStatsSection({ data }) {
  const totals = data?.totals ?? {};
  const catalogHealth = data?.catalogHealth ?? {};
  const mediaHealth = data?.mediaHealth ?? {};
  const catalogPreview = data?.catalogPreview ?? {};
  const userHighlights = data?.userHighlights ?? {};

  const summaryCards = [
    { label: "Пользователи", value: statValue(totals.users) },
    { label: "Администраторы", value: statValue(totals.adminUsers) },
    { label: "Треки в базе", value: statValue(totals.tracks) },
    { label: "Скрытые треки", value: statValue(totals.hiddenTracks) },
    { label: "Активные сессии", value: statValue(totals.activeSessions) },
    { label: "Артисты", value: statValue(totals.artists) },
  ];

  const catalogRows = [
    ["Доступных треков", statValue(catalogHealth.visibleTracks)],
    ["Публичных плейлистов в выдаче", statValue(catalogHealth.publicPlaylistsVisible)],
    ["Пустых публичных плейлистов", statValue(catalogHealth.publicPlaylistsEmpty)],
    ["Системных fallback-плейлистов", statValue(catalogHealth.systemPlaylists)],
    ["Релизов в выдаче", statValue(catalogHealth.releasesVisible)],
    ["Пустых релизов", statValue(catalogHealth.releasesEmpty)],
  ];

  const mediaRows = [
    ["Локальные треки", statValue(mediaHealth.localTracks)],
    ["Удаленные треки", statValue(mediaHealth.remoteTracks)],
    ["Треки с HLS", statValue(mediaHealth.hlsTracks)],
    ["Без audioUrl", statValue(mediaHealth.missingAudioUrl)],
    ["Отсутствующие локальные файлы", statValue(mediaHealth.missingLocalFiles)],
    ["Некорректные local URL", statValue(mediaHealth.invalidLocalUrls)],
  ];

  const featuredPlaylists = Array.isArray(catalogPreview.featuredPlaylists) ? catalogPreview.featuredPlaylists : [];
  const latestTracks = Array.isArray(catalogPreview.latestTracks) ? catalogPreview.latestTracks : [];
  const topUploaders = Array.isArray(userHighlights.topUploaders) ? userHighlights.topUploaders : [];
  const recentUsers = Array.isArray(userHighlights.recentUsers) ? userHighlights.recentUsers : [];
  const actionItems = buildActionItems(data);

  return (
    <div className={styles.container}>
      <div className={styles.summaryGrid}>
        {summaryCards.map((card) => (
          <article key={card.label} className={styles.summaryCard}>
            <p className={styles.summaryLabel}>{card.label}</p>
            <p className={styles.summaryValue}>{card.value}</p>
          </article>
        ))}
      </div>

      <div className={styles.columns}>
        <article className={styles.detailCard}>
          <div className={styles.detailHeader}>
            <h3 className={styles.detailTitle}>Состояние каталога</h3>
            <span
              className={`${styles.statusBadge} ${
                catalogHealth.sparseCatalog ? styles.statusBadgeWarning : styles.statusBadgeSuccess
              }`.trim()}
            >
              {catalogHealth.sparseCatalog ? "Sparse mode" : "Stable"}
            </span>
          </div>
          <div className={styles.detailList}>
            {catalogRows.map(([label, value]) => (
              <div key={label} className={styles.detailRow}>
                <span className={styles.detailLabel}>{label}</span>
                <span className={styles.detailValue}>{value}</span>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.detailCard}>
          <div className={styles.detailHeader}>
            <h3 className={styles.detailTitle}>Медиа и потоковая выдача</h3>
            <span
              className={`${styles.statusBadge} ${
                statValue(mediaHealth.missingLocalFiles) > 0 || statValue(mediaHealth.invalidLocalUrls) > 0
                  ? styles.statusBadgeDanger
                  : styles.statusBadgeSuccess
              }`.trim()}
            >
              {statValue(mediaHealth.missingLocalFiles) > 0 || statValue(mediaHealth.invalidLocalUrls) > 0
                ? "Needs attention"
                : "Healthy"}
            </span>
          </div>
          <div className={styles.detailList}>
            {mediaRows.map(([label, value]) => (
              <div key={label} className={styles.detailRow}>
                <span className={styles.detailLabel}>{label}</span>
                <span className={styles.detailValue}>{value}</span>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className={styles.previewGrid}>
        <article className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <h3 className={styles.previewTitle}>Что сейчас видит пользователь</h3>
            <p className={styles.previewSubtitle}>Плейлисты, которые реально участвуют в публичной выдаче.</p>
          </div>
          {featuredPlaylists.length ? (
            <div className={styles.previewList}>
              {featuredPlaylists.map((playlist) => (
                <div key={playlist.id} className={styles.previewItem}>
                  <span className={styles.previewCover} style={{ background: playlist.cover }} />
                  <div className={styles.previewMeta}>
                    <strong className={styles.previewItemTitle}>{playlist.title}</strong>
                    <span className={styles.previewItemText}>
                      {playlist.subtitle || "Без подзаголовка"} • {formatTrackCount(playlist.trackCount)}
                    </span>
                  </div>
                  <StatusPill tone={playlist.isSystem ? "warning" : "neutral"}>
                    {playlist.isSystem ? "Система" : "Публичный"}
                  </StatusPill>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyNote}>Сейчас в публичной выдаче нет живых плейлистов.</p>
          )}
        </article>

        <article className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <h3 className={styles.previewTitle}>Свежие доступные треки</h3>
            <p className={styles.previewSubtitle}>Последние треки, которые уже можно слушать и использовать в витринах.</p>
          </div>
          {latestTracks.length ? (
            <div className={styles.previewList}>
              {latestTracks.map((track) => (
                <div key={track.id} className={styles.previewItem}>
                  <span className={styles.previewCover} style={{ background: track.cover }} />
                  <div className={styles.previewMeta}>
                    <strong className={styles.previewItemTitle}>{track.title}</strong>
                    <span className={styles.previewItemText}>{track.artist || "Неизвестный артист"}</span>
                    <span className={styles.previewItemText}>{formatDateTime(track.createdAt)}</span>
                  </div>
                  <div className={styles.badgeStack}>
                    <StatusPill tone={track.isLocalAudio ? "success" : "neutral"}>
                      {track.isLocalAudio ? "Local" : "Remote"}
                    </StatusPill>
                    <StatusPill tone={track.hasHls ? "success" : "neutral"}>
                      {track.hasHls ? "HLS" : "Без HLS"}
                    </StatusPill>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyNote}>Пока нет доступных треков для предпросмотра.</p>
          )}
        </article>

        <article className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <h3 className={styles.previewTitle}>Кто наполняет платформу</h3>
            <p className={styles.previewSubtitle}>Быстрый срез по загрузчикам и новым аккаунтам.</p>
          </div>

          <div className={styles.previewSubsection}>
            <h4 className={styles.previewSubTitle}>Топ загрузчиков</h4>
            {topUploaders.length ? (
              <div className={styles.previewList}>
                {topUploaders.map((user) => (
                  <div key={user.id} className={styles.previewItem}>
                    <div className={styles.previewMeta}>
                      <strong className={styles.previewItemTitle}>{user.displayName || user.username}</strong>
                      <span className={styles.previewItemText}>@{user.username}</span>
                    </div>
                    <StatusPill tone={user.isBanned ? "danger" : user.isAdmin ? "warning" : "success"}>
                      {user.uploadedTracksCount} upload
                    </StatusPill>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyNote}>Пока никто не загружал треки в каталог.</p>
            )}
          </div>

          <div className={styles.previewSubsection}>
            <h4 className={styles.previewSubTitle}>Новые аккаунты</h4>
            {recentUsers.length ? (
              <div className={styles.previewList}>
                {recentUsers.map((user) => (
                  <div key={user.id} className={styles.previewItem}>
                    <div className={styles.previewMeta}>
                      <strong className={styles.previewItemTitle}>{user.displayName || user.username}</strong>
                      <span className={styles.previewItemText}>
                        @{user.username} • {formatDateTime(user.createdAt)}
                      </span>
                    </div>
                    <StatusPill tone={user.isBanned ? "danger" : user.isAdmin ? "warning" : "neutral"}>
                      {user.isAdmin ? "Admin" : user.isBanned ? "Banned" : `${user.uploadedTracksCount} upload`}
                    </StatusPill>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.emptyNote}>Новых аккаунтов для превью пока нет.</p>
            )}
          </div>
        </article>

        <article className={styles.previewCard}>
          <div className={styles.previewHeader}>
            <h3 className={styles.previewTitle}>Что добить дальше</h3>
            <p className={styles.previewSubtitle}>Автоматические рекомендации по текущему состоянию проекта.</p>
          </div>
          <ul className={styles.actionList}>
            {actionItems.map((item) => (
              <li key={item} className={styles.actionItem}>
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>
    </div>
  );
}
