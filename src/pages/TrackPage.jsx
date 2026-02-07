import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FiArrowLeft, FiExternalLink, FiHeart, FiMusic, FiPlay, FiPlus } from "react-icons/fi";
import { LuHeart } from "react-icons/lu";
import styles from "./TrackPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import {
  addTrackToUserPlaylist,
  fetchTrackPage,
  removeTrackFromUserPlaylist,
} from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";

export default function TrackPage() {
  const { trackId = "" } = useParams();
  const navigate = useNavigate();
  const loadTrackPage = useCallback(() => fetchTrackPage(trackId), [trackId]);
  const { status, data, error, reload } = useAsyncResource(loadTrackPage);

  const { likedIds, currentTrackId, playTrack, playQueue, toggleLikeTrack, addTrackNext } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const isLiked = useMemo(() => likedIds.includes(trackId), [likedIds, trackId]);

  const handleToggleTrackInPlaylist = async (playlist) => {
    if (!data?.track?.id) {
      return;
    }

    try {
      if (playlist.hasTrack) {
        await removeTrackFromUserPlaylist(playlist.id, data.track.id);
      } else {
        await addTrackToUserPlaylist(playlist.id, data.track.id);
      }
      await reload();
    } catch {
      // noop
    }
  };

  return (
    <PageShell>
      <button type="button" className={styles.backButton} onClick={() => navigate(-1)}>
        <FiArrowLeft />
        Назад
      </button>

      {status === "loading" ? (
        <ResourceState loading title="Загружаем трек" description="Собираем информацию и связанные подборки." />
      ) : null}

      {status === "error" ? (
        <ResourceState title="Трек недоступен" description={error} actionLabel="Повторить" onAction={reload} />
      ) : null}

      {status === "success" && data ? (
        <>
          <header className={styles.hero}>
            <div className={styles.cover} style={{ background: data.track.cover }} />
            <div className={styles.heroMeta}>
              <p className={styles.heroLabel}>Трек</p>
              <h1 className={styles.heroTitle}>{data.track.title}</h1>
              <ArtistInlineLinks
                artistLine={data.track.artist}
                className={styles.heroSubtitle}
                linkClassName={styles.heroArtistButton}
                textClassName={styles.heroSubtitle}
                onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
              />
              <div className={styles.trackBadges}>
                <span>{formatDurationClock(data.track.durationSec)}</span>
                {data.track.explicit ? <span>E</span> : null}
                {data.track.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className={styles.heroActions}>
                <button type="button" className={styles.primaryButton} onClick={() => playTrack(data.track.id)}>
                  <FiPlay />
                  Слушать
                </button>
                <button
                  type="button"
                  className={`${styles.secondaryButton} ${isLiked ? styles.secondaryButtonActive : ""}`.trim()}
                  onClick={() => toggleLikeTrack(data.track.id)}
                >
                  {isLiked ? <FiHeart /> : <LuHeart />}
                  {isLiked ? "В избранном" : "В избранное"}
                </button>
                {data.artist ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => navigate(`/artist/${data.artist.id}`)}
                  >
                    <FiExternalLink />
                    Страница автора
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Входит в плейлисты</h2>
            {data.inPlaylists.length ? (
              <div className={styles.playlistGrid}>
                {data.inPlaylists.map((playlist) => {
                  const firstTrackId = playlist.trackIds?.[0] ?? null;
                  return (
                    <button
                      key={playlist.id}
                      type="button"
                      className={styles.playlistCard}
                      onClick={() => navigate(`/playlist/${playlist.id}`)}
                    >
                      <span className={styles.playlistCover} style={{ background: playlist.cover }} />
                      <span className={styles.playlistTitle}>{playlist.title}</span>
                      <span className={styles.playlistSubtitle}>{playlist.subtitle}</span>
                      {firstTrackId ? (
                        <span className={styles.cardActions}>
                          <span
                            className={styles.cardActionButton}
                            role="button"
                            tabIndex={0}
                            aria-label="Слушать"
                            onClick={(event) => {
                              event.stopPropagation();
                              playTrack(firstTrackId);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                playTrack(firstTrackId);
                              }
                            }}
                          >
                            <FiPlay />
                          </span>
                          <span
                            className={styles.cardActionButton}
                            role="button"
                            tabIndex={0}
                            aria-label="Лайк"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleLikeTrack(firstTrackId);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleLikeTrack(firstTrackId);
                              }
                            }}
                          >
                            <FiHeart />
                          </span>
                          <span
                            className={styles.cardActionButton}
                            role="button"
                            tabIndex={0}
                            aria-label="Добавить далее"
                            onClick={(event) => {
                              event.stopPropagation();
                              addTrackNext(firstTrackId);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                addTrackNext(firstTrackId);
                              }
                            }}
                          >
                            <FiPlus />
                          </span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className={styles.emptyText}>Этот трек пока не входит в готовые плейлисты.</p>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Мои плейлисты</h2>
            {data.playlistToggles.length ? (
              <div className={styles.userPlaylistList}>
                {data.playlistToggles.map((playlist) => (
                  <article key={playlist.id} className={styles.userPlaylistRow}>
                    <span className={styles.userPlaylistMeta}>
                      <span className={styles.userPlaylistTitle}>{playlist.title}</span>
                      <span className={styles.userPlaylistSubtitle}>{playlist.trackIds.length} треков</span>
                    </span>
                    <button
                      type="button"
                      className={`${styles.userPlaylistButton} ${playlist.hasTrack ? styles.userPlaylistButtonActive : ""}`.trim()}
                      onClick={() => handleToggleTrackInPlaylist(playlist)}
                    >
                      {playlist.hasTrack ? "Удалить" : "Добавить"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <ResourceState
                title="Нет пользовательских плейлистов"
                description="Создай плейлист в разделе “Моя музыка”, чтобы добавлять в него треки отсюда."
                actionLabel="Открыть библиотеку"
                onAction={() => navigate("/library")}
              />
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Похожие треки</h2>
            <ul className={styles.trackList}>
              {data.relatedTracks.map((track) => {
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
                      <span className={styles.trackCoverMini} style={{ background: track.cover }} />
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
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Еще от исполнителя</h2>
            {data.moreByArtist.length ? (
              <div className={styles.moreArtistRow}>
                {data.moreByArtist.map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    className={styles.artistTrackCard}
                    onClick={() => playQueue([data.track.id, track.id], 1)}
                  >
                    <FiMusic />
                    <span>{track.title}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>Это единственный трек этого артиста в текущем каталоге.</p>
            )}
          </section>
        </>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}
