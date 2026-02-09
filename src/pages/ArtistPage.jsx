import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  FiArrowLeft,
  FiChevronRight,
  FiClock,
  FiExternalLink,
  FiHeart,
  FiPlay,
  FiPlus,
  FiShuffle,
  FiUserPlus,
  FiUsers,
} from "react-icons/fi";
import { LuHeart } from "react-icons/lu";
import styles from "./ArtistPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchArtistPage } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

export default function ArtistPage() {
  const { artistId = "" } = useParams();
  const navigate = useNavigate();
  const loadArtistPage = useCallback(() => fetchArtistPage(artistId), [artistId]);
  const { status, data, error, reload } = useAsyncResource(loadArtistPage);

  const {
    likedIds,
    followedArtistIds,
    currentTrackId,
    isArtistFollowed,
    toggleArtistFollow,
    playTrack,
    playQueue,
    toggleLikeTrack,
    addTrackNext,
  } = usePlayer();

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const artistTrackIds = useMemo(() => (data?.topTracks ?? []).map((track) => track.id), [data?.topTracks]);
  const followedCount = followedArtistIds.length;
  const artistFollowed = data?.artist ? isArtistFollowed(data.artist.id) : false;

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
            <span className={styles.heroAvatar}>{data.artist.name.slice(0, 1).toUpperCase()}</span>
            <div className={styles.heroMeta}>
              <p className={styles.heroLabel}>Исполнитель</p>
              <h1 className={styles.heroTitle}>{data.artist.name}</h1>
              <div className={styles.heroStats}>
                <span>
                  <FiUsers />
                  {data.artist.followers} слушателей
                </span>
                <span>{data.topTracks.length} треков</span>
                <span>Мои подписки: {followedCount}</span>
              </div>
              <div className={styles.heroActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={!artistTrackIds.length}
                  onClick={() => playQueue(artistTrackIds, 0)}
                >
                  <FiPlay />
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
                              {isActive ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                              {track.title}
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
                          className={`${styles.iconButton} ${liked ? styles.iconButtonActive : ""}`.trim()}
                          aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                          onClick={() => toggleLikeTrack(track.id)}
                        >
                          {liked ? <FiHeart /> : <LuHeart />}
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label="Открыть страницу трека"
                          onClick={() => navigate(`/track/${track.id}`)}
                        >
                          <FiExternalLink />
                        </button>
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label="Добавить далее в очередь"
                          onClick={() => addTrackNext(track.id)}
                        >
                          <FiPlus />
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
                <article className={styles.latestReleaseCard}>
                  <button
                    type="button"
                    className={styles.latestReleaseMainButton}
                    onClick={() => navigate(`/release/${data.latestRelease.id}`)}
                  >
                    <span className={styles.latestReleaseCover} style={{ background: data.latestRelease.cover }} />
                    <p className={styles.latestReleaseType}>{data.latestRelease.type.toUpperCase()}</p>
                    <h3 className={styles.latestReleaseTitle}>{data.latestRelease.title}</h3>
                    <p className={styles.latestReleaseMeta}>
                      {data.latestRelease.year} • {data.latestRelease.tracks.length} треков
                    </p>
                  </button>
                  <span className={styles.latestReleaseActions}>
                    <button
                      type="button"
                      className={styles.latestReleaseButton}
                      aria-label="Слушать релиз"
                      onClick={() => playQueue(data.latestRelease.trackIds, 0)}
                    >
                      <FiPlay />
                      Слушать
                    </button>
                    <span className={styles.latestReleaseOpen}>
                      <FiExternalLink />
                      Открыть
                    </span>
                  </span>
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
                        <FiPlay />
                        Слушать
                      </button>
                      <button
                        type="button"
                        className={styles.albumPlayButton}
                        onClick={() => {
                          if (album.trackIds[0]) {
                            addTrackNext(album.trackIds[0]);
                          }
                        }}
                      >
                        <FiPlus />
                        Далее
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
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
