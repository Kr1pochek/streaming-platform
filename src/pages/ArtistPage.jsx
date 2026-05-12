import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiChevronRight,
  FiClock,
  FiExternalLink,
  FiHeadphones,
  FiHeart,
  FiMoreHorizontal,
  FiShuffle,
  FiUserPlus,
  FiUsers,
} from "react-icons/fi";
import { BsFillPlayFill } from "react-icons/bs";
import styles from "./ArtistPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchArtistPage } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import ArtistSpotlightCard from "../components/ArtistSpotlightCard.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

const audienceForms = {
  listeners: ["слушатель", "слушателя", "слушателей"],
  followers: ["подписчик", "подписчика", "подписчиков"],
};

function pluralizeRu(value, one, few, many) {
  const normalized = Math.abs(Math.trunc(Number(value) || 0));
  const mod100 = normalized % 100;
  if (mod100 >= 11 && mod100 <= 19) {
    return many;
  }

  const mod10 = normalized % 10;
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

function formatAudience(value, type) {
  const forms = audienceForms[type] ?? audienceForms.listeners;
  const safeValue = Math.max(0, Math.trunc(Number(value) || 0));
  return `${safeValue.toLocaleString("ru-RU")} ${pluralizeRu(safeValue, ...forms)}`;
}

function audienceNumber(value) {
  return Math.max(0, Math.trunc(Number(String(value ?? "").replace(",", ".")) || 0));
}

function resolveArtistAvatar(data) {
  return (
    String(data?.artist?.avatar ?? data?.artist?.avatarUrl ?? data?.artist?.cover ?? "").trim() ||
    String(data?.latestRelease?.cover ?? "").trim() ||
    String(data?.topTracks?.find((track) => track?.cover)?.cover ?? "").trim()
  );
}

export default function ArtistPage() {
  const { artistId = "" } = useParams();
  const navigate = useNavigate();
  const loadArtistPage = useCallback(() => fetchArtistPage(artistId), [artistId]);
  const { status, data, error, reload } = useAsyncResource(loadArtistPage);

  const { likedIds, currentTrackId, historyIds, isArtistFollowed, toggleArtistFollow, playTrack, playQueue } = usePlayer();

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const artistTrackIds = useMemo(() => (data?.topTracks ?? []).map((track) => track.id), [data?.topTracks]);
  const artistFollowed = data?.artist ? isArtistFollowed(data.artist.id) : false;
  const artistAvatar = resolveArtistAvatar(data);
  const hasLocalArtistListen = useMemo(() => {
    const artistTrackIdSet = new Set(artistTrackIds);
    return (historyIds ?? []).some((trackId) => artistTrackIdSet.has(trackId));
  }, [artistTrackIds, historyIds]);
  const artistListeners = Math.max(audienceNumber(data?.artist?.listeners), hasLocalArtistListen ? 1 : 0);
  const artistFollowers = Math.max(audienceNumber(data?.artist?.followers), artistFollowed ? 1 : 0);

  return (
    <PageShell>
      <button type="button" className={styles.backButton} onClick={() => navigate(-1)}>
        <FiArrowLeft />
        Назад
      </button>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем страницу автора" description="Собираем треки и релизы исполнителя." />
      ) : null}

      {status === "error" ? (
        <ResourceState title="Страница автора недоступна" description={error} actionLabel="Повторить" onAction={reload} />
      ) : null}

      {status === "success" && data ? (
        <>
          <header className={styles.hero}>
            <span
              className={`${styles.heroAvatar} ${artistAvatar ? styles.heroAvatarImage : ""}`.trim()}
              style={artistAvatar ? { background: artistAvatar } : undefined}
            >
              {artistAvatar ? null : data.artist.name.slice(0, 1).toUpperCase()}
            </span>
            <div className={styles.heroMeta}>
              <p className={styles.heroLabel}>Исполнитель</p>
              <h1 className={styles.heroTitle}>{data.artist.name}</h1>
              <div className={styles.heroStats}>
                <span>
                  <FiHeadphones />
                  {formatAudience(artistListeners, "listeners")}
                </span>
                <span>
                  <FiUsers />
                  {formatAudience(artistFollowers, "followers")}
                </span>
                <span>{data.topTracks.length} треков</span>
              </div>
              <div className={styles.heroActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!artistTrackIds.length}
                  onClick={() => playQueue(artistTrackIds, 0)}
                >
                  <BsFillPlayFill />
                  Слушать
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!artistTrackIds.length}
                  onClick={() => {
                    const shuffledIds = [...artistTrackIds].sort(() => Math.random() - 0.5);
                    playQueue(shuffledIds, 0);
                  }}
                >
                  <FiShuffle />
                  Перемешать
                </button>
                <button
                  type="button"
                  className={`${styles.followButton} ${artistFollowed ? styles.followButtonActive : ""}`.trim()}
                  onClick={() => toggleArtistFollow(data.artist.id)}
                >
                  <FiUserPlus />
                  {artistFollowed ? "Вы подписаны" : "Подписаться"}
                </button>
              </div>
            </div>
          </header>

          <section className={styles.mainSection}>
            <div className={styles.popularTracksColumn}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionTitle}>Популярные треки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              {data.topTracks.length ? (
                <ul className={styles.trackList}>
                  {data.topTracks.map((track, index) => {
                    const liked = likedIds.includes(track.id);
                    const isActive = currentTrackId === track.id;
                    return (
                      <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
                        <button
                          type="button"
                          className={styles.trackMain}
                          onClick={() => playTrack(track.id)}
                          onContextMenu={(event) => openTrackMenu(event, track.id)}
                        >
                          <span className={styles.trackIndex}>{index + 1}</span>
                          <span className={styles.trackCover} style={{ background: track.cover }} />
                          <span className={styles.trackMeta}>
                            <span className={styles.trackTitle}>
                              {track.title}
                              {liked ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
                            </span>
                            <ArtistInlineLinks
                              artistLine={track.artist}
                              className={styles.trackArtist}
                              linkClassName={styles.trackArtistLink}
                              textClassName={styles.trackArtist}
                              onOpenArtist={(nextArtistId) => navigate(`/artist/${nextArtistId}`)}
                              stopPropagation
                            />
                          </span>
                          <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label="Открыть меню трека"
                          onClick={(event) => openTrackMenu(event, track.id)}
                        >
                          <FiMoreHorizontal />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.emptyText}>У этого исполнителя пока нет треков в каталоге.</p>
              )}
            </div>

            <aside className={styles.latestReleaseColumn}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionTitle}>Новый релиз</h2>
              </div>
              {data.latestRelease ? (
                <article
                  className={styles.latestReleaseCard}
                  style={{ "--latest-release-cover": data.latestRelease.cover }}
                >
                  <button
                    type="button"
                    className={styles.latestReleaseMainButton}
                    onClick={() => navigate(`/release/${data.latestRelease.id}`)}
                  >
                    <span className={styles.latestReleaseVisual}>
                      <span className={styles.latestReleaseGlow} aria-hidden="true" />
                      <span className={styles.latestReleaseCover} style={{ background: data.latestRelease.cover }} />
                    </span>
                    <span className={styles.latestReleaseContent}>
                      <span className={styles.latestReleaseEyebrow}>Свежее у автора</span>
                      <span className={styles.latestReleaseType}>{data.latestRelease.type.toUpperCase()}</span>
                      <span className={styles.latestReleaseTitle}>{data.latestRelease.title}</span>
                      <span className={styles.latestReleaseMeta}>
                        {data.latestRelease.year} • {data.latestRelease.tracks.length} треков
                      </span>
                    </span>
                  </button>
                  <div className={styles.latestReleaseActions}>
                    <button
                      type="button"
                      className={styles.latestReleasePrimaryButton}
                      aria-label="Слушать релиз"
                      onClick={() => playQueue(data.latestRelease.trackIds, 0)}
                    >
                      <BsFillPlayFill />
                      Слушать
                    </button>
                    <button
                      type="button"
                      className={styles.latestReleaseSecondaryButton}
                      onClick={() => navigate(`/release/${data.latestRelease.id}`)}
                    >
                      <FiExternalLink />
                      Открыть
                    </button>
                  </div>
                </article>
              ) : (
                <p className={styles.emptyText}>У автора пока нет новых релизов.</p>
              )}
            </aside>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Популярные альбомы</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {data.popularAlbums.length ? (
              <div className={styles.albumScroller}>
                {data.popularAlbums.map((album) => (
                  <article key={album.id} className={styles.albumCard}>
                    <button
                      type="button"
                      className={styles.albumMainButton}
                      onClick={() => navigate(`/release/${album.id}`)}
                    >
                      <span className={styles.albumCover} style={{ background: album.cover }} />
                      <span className={styles.albumTitle}>{album.title}</span>
                      <span className={styles.albumMeta}>
                        {album.year}
                        <span className={styles.albumDot}>•</span>
                        {album.tracks.length} треков
                      </span>
                    </button>
                    <span className={styles.albumActions}>
                      <button
                        type="button"
                        className={styles.albumPlayButton}
                        onClick={() => playQueue(album.trackIds, 0)}
                      >
                        <BsFillPlayFill />
                        Слушать
                      </button>
                      <button
                        type="button"
                        className={styles.albumPlayButton}
                        onClick={(event) => {
                          if (album.trackIds[0]) {
                            openTrackMenu(event, album.trackIds[0]);
                          }
                        }}
                      >
                        <FiMoreHorizontal />
                        Меню
                      </button>
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>Пока нет альбомов в каталоге.</p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Релизы автора</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {data.eps.length || data.singles.length ? (
              <div className={styles.releaseList}>
                {[...data.eps, ...data.singles].map((release) => (
                  <button
                    key={release.id}
                    type="button"
                    className={styles.releaseRow}
                    onClick={() => navigate(`/release/${release.id}`)}
                  >
                    <span className={styles.releaseCover} style={{ background: release.cover }} />
                    <span className={styles.releaseMeta}>
                      <span className={styles.releaseTitle}>{release.title}</span>
                      <span className={styles.releaseDetails}>
                        {release.type.toUpperCase()} • {release.year}
                      </span>
                    </span>
                    <span className={styles.releaseDurationBadge}>
                      <FiClock />
                      {release.tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0) > 0
                        ? formatDurationClock(release.tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0))
                        : "--:--"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>EP и синглы пока не добавлены.</p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Похожие артисты</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {data.relatedArtists?.length ? (
              <div className={styles.relatedArtistGrid}>
                {data.relatedArtists.map((relatedArtist) => (
                  <ArtistSpotlightCard
                    key={relatedArtist.id}
                    artist={relatedArtist}
                    contextLabel="Похоже по звучанию"
                    description="Исследуй похожего автора и переключайся между близкими по атмосфере релизами."
                    isFollowed={isArtistFollowed(relatedArtist.id)}
                    onOpen={() => navigate(`/artist/${relatedArtist.id}`)}
                    onToggleFollow={() => toggleArtistFollow(relatedArtist.id)}
                    openLabel="Открыть"
                  />
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>Похожие артисты появятся, когда в каталоге станет больше совпадений.</p>
            )}
          </section>
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
