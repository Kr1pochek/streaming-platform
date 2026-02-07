import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiClock, FiExternalLink, FiHeart, FiPlus, FiUsers } from "react-icons/fi";
import styles from "./ProfilePage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchCatalogMap } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

function getTopGenres(tracks) {
  const scoreMap = new Map();
  for (const track of tracks) {
    for (const tag of track.tags ?? []) {
      scoreMap.set(tag, (scoreMap.get(tag) ?? 0) + 1);
    }
  }
  return [...scoreMap.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, 8)
    .map(([tag]) => tag);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { status, data, error, reload } = useAsyncResource(fetchCatalogMap);
  const {
    trackMap,
    likedIds,
    historyIds,
    followedArtistIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    toggleArtistFollow,
    addTrackNext,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const likedTracks = useMemo(() => likedIds.map((id) => trackMap[id]).filter(Boolean), [likedIds, trackMap]);
  const historyTracks = useMemo(() => historyIds.map((id) => trackMap[id]).filter(Boolean), [historyIds, trackMap]);
  const favoriteGenres = useMemo(() => getTopGenres(likedTracks), [likedTracks]);

  const followedArtists = useMemo(() => {
    if (!data?.artists) return [];
    const followedSet = new Set(followedArtistIds);
    return data.artists.filter((artist) => followedSet.has(artist.id));
  }, [data, followedArtistIds]);

  const recommendations = useMemo(() => {
    const excluded = new Set([...likedIds, ...historyIds]);
    return Object.values(trackMap).filter((track) => !excluded.has(track.id)).slice(0, 4);
  }, [trackMap, likedIds, historyIds]);

  const totalHistoryDuration = useMemo(
    () => historyTracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0),
    [historyTracks]
  );

  return (
    <PageShell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Профиль</h1>
          <p className={styles.subtitle}>Подписки, история и музыкальные предпочтения в одном месте.</p>
        </div>
        <div className={styles.statsRow}>
          <article className={styles.statCard}>
            <span className={styles.statLabel}>Подписок</span>
            <strong className={styles.statValue}>{followedArtists.length}</strong>
          </article>
          <article className={styles.statCard}>
            <span className={styles.statLabel}>История</span>
            <strong className={styles.statValue}>{historyTracks.length}</strong>
          </article>
          <article className={styles.statCard}>
            <span className={styles.statLabel}>Время прослушивания</span>
            <strong className={styles.statValue}>{formatDurationClock(totalHistoryDuration)}</strong>
          </article>
        </div>
      </header>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем профиль" description="Готовим статистику и персональные блоки." />
      ) : null}

      {status === "error" ? (
        <ResourceState title="Профиль недоступен" description={error} actionLabel="Повторить" onAction={reload} />
      ) : null}

      {status === "success" ? (
        <>
          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Подписки</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {followedArtists.length ? (
              <div className={styles.artistGrid}>
                {followedArtists.map((artist) => (
                  <article key={artist.id} className={styles.artistCard}>
                    <button
                      type="button"
                      className={styles.artistMainButton}
                      onClick={() => navigate(`/artist/${artist.id}`)}
                    >
                      <span className={styles.artistAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                      <span className={styles.artistMeta}>
                        <span className={styles.artistName}>{artist.name}</span>
                        <span className={styles.artistFollowers}>
                          <FiUsers />
                          {artist.followers}
                        </span>
                      </span>
                    </button>
                    <div className={styles.artistActions}>
                      <button
                        type="button"
                        className={styles.artistActionButton}
                        onClick={() => navigate(`/artist/${artist.id}`)}
                      >
                        <FiExternalLink />
                        Открыть
                      </button>
                      <button
                        type="button"
                        className={`${styles.artistActionButton} ${styles.artistUnfollowButton}`.trim()}
                        onClick={() => toggleArtistFollow(artist.id)}
                      >
                        Отписаться
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.subscriptionsEmpty}>
                <ResourceState
                  title="Пока нет подписок"
                  description="Открой страницу исполнителя и нажми “Подписаться”, чтобы собрать личную ленту."
                  actionLabel="Перейти в поиск"
                  onAction={() => navigate("/search")}
                />
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>История</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {historyTracks.length ? (
              <ul className={styles.trackList}>
                {historyTracks.map((track) => {
                  const isActive = currentTrackId === track.id;
                  const liked = likedIds.includes(track.id);
                  return (
                    <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
                      <button
                        type="button"
                        className={styles.trackMain}
                        onClick={() => playTrack(track.id)}
                        onContextMenu={(event) => openTrackMenu(event, track.id)}
                      >
                        <span className={styles.trackCover} style={{ background: track.cover }} />
                        <span className={styles.trackMeta}>
                          <span className={styles.trackTitle}>
                            {isActive ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                            {track.title}
                          </span>
                          <ArtistInlineLinks
                            artistLine={track.artist}
                            className={styles.trackArtist}
                            linkClassName={styles.trackArtistButton}
                            textClassName={styles.trackArtist}
                            onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                            stopPropagation
                          />
                        </span>
                        <span className={styles.trackDuration}>
                          <FiClock />
                          {formatDurationClock(track.durationSec)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconButton} ${liked ? styles.iconButtonActive : ""}`.trim()}
                        onClick={() => toggleLikeTrack(track.id)}
                        aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                      >
                        <FiHeart />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        onClick={() => addTrackNext(track.id)}
                        aria-label="Добавить далее в очередь"
                      >
                        <FiPlus />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ResourceState
                title="История пуста"
                description="Запусти пару треков из поиска или плейлистов, и здесь появится активность."
                actionLabel="Открыть поиск"
                onAction={() => navigate("/search")}
              />
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Любимые жанры</h2>
            </div>
            {favoriteGenres.length ? (
              <div className={styles.genreRow}>
                {favoriteGenres.map((genre) => (
                  <button key={genre} type="button" className={styles.genreTag} onClick={() => navigate("/search")}>
                    {genre}
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>Добавь треки в избранное, чтобы профиль собрал твои жанры.</p>
            )}
          </section>

          {!followedArtists.length && !historyTracks.length ? (
            <SmartRecommendations
              title="Для старта профиля"
              tracks={recommendations}
              onPlayTrack={playTrack}
              onLikeTrack={toggleLikeTrack}
              onOpenTrack={(trackId) => navigate(`/track/${trackId}`)}
            />
          ) : null}
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
