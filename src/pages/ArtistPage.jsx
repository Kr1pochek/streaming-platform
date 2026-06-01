import { useCallback, useMemo, useState } from "react";
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
import { splitArtistNames } from "../../shared/artistNameParsing.js";

const audienceForms = {
  listeners: ["слушатель", "слушателя", "слушателей"],
  followers: ["подписчик", "подписчика", "подписчиков"],
};
const releaseFilterOptions = [
  { id: "all", label: "Все" },
  { id: "album", label: "Albums" },
  { id: "ep", label: "EP" },
  { id: "single", label: "Singles" },
];
const releaseTypeLabels = {
  all: "все",
  album: "Albums",
  ep: "EP",
  single: "Singles",
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
    String(data?.tracks?.find((track) => track?.cover)?.cover ?? "").trim() ||
    String(data?.topTracks?.find((track) => track?.cover)?.cover ?? "").trim()
  );
}

function getReleaseDurationSec(release) {
  return (release?.tracks ?? []).reduce((sum, track) => sum + (track.durationSec ?? 0), 0);
}

function normalizeArtistMatchName(value = "") {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function trackBelongsToArtist(track, artist) {
  const artistId = String(artist?.id ?? "").trim();
  const artistName = normalizeArtistMatchName(artist?.name);
  if (!track?.id || (!artistId && !artistName)) {
    return false;
  }

  if (artistId && Array.isArray(track.artistIds) && track.artistIds.includes(artistId)) {
    return true;
  }

  return splitArtistNames(track.artist).some((name) => normalizeArtistMatchName(name) === artistName);
}

function uniqueTracksById(trackGroups = []) {
  const seen = new Set();
  const tracks = [];

  for (const group of trackGroups) {
    for (const track of Array.isArray(group) ? group : []) {
      const id = String(track?.id ?? "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      tracks.push(track);
    }
  }

  return tracks;
}

function collectReleaseTrackIds(releases = []) {
  const ids = [];
  const seen = new Set();

  for (const release of Array.isArray(releases) ? releases : []) {
    for (const value of [...(release?.trackIds ?? []), ...(release?.tracks ?? []).map((track) => track?.id)]) {
      const id = String(value ?? "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

export default function ArtistPage() {
  const { artistId = "" } = useParams();
  const navigate = useNavigate();

  const {
    likedIds,
    currentTrackId,
    historyIds,
    trackMap,
    catalogVersion,
    isArtistFollowed,
    toggleArtistFollow,
    playTrack,
    playQueue,
  } = usePlayer();

  const loadArtistPage = useCallback(() => fetchArtistPage(artistId, { catalogVersion }), [artistId, catalogVersion]);
  const { status, data, error, reload } = useAsyncResource(loadArtistPage);
  const [releaseFilterState, setReleaseFilterState] = useState({ artistId, value: "all" });
  const releaseFilter = releaseFilterState.artistId === artistId ? releaseFilterState.value : "all";
  const setReleaseFilter = useCallback(
    (value) => {
      setReleaseFilterState({ artistId, value });
    },
    [artistId]
  );

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const releaseTrackIds = useMemo(() => collectReleaseTrackIds(data?.allReleases), [data]);
  const artistTracks = useMemo(() => {
    const catalogTracks = Object.values(trackMap ?? {}).filter((track) => trackBelongsToArtist(track, data?.artist));
    const releaseTracks = (data?.allReleases ?? []).flatMap((release) => release?.tracks ?? []);
    return uniqueTracksById([catalogTracks, data?.tracks, releaseTracks, data?.topTracks]);
  }, [data, trackMap]);
  const artistTrackIds = useMemo(() => {
    const ids = [];
    const seen = new Set();
    for (const id of [...artistTracks.map((track) => track.id), ...releaseTrackIds]) {
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, [artistTracks, releaseTrackIds]);
  const artistTrackCount = Math.max(
    Math.trunc(Number(data?.trackCount) || 0),
    Math.trunc(Number(data?.artist?.trackCount) || 0),
    artistTrackIds.length
  );
  const artistFollowed = data?.artist ? isArtistFollowed(data.artist.id) : false;
  const artistAvatar = resolveArtistAvatar(data);
  const hasLocalArtistListen = useMemo(() => {
    const artistTrackIdSet = new Set(artistTrackIds);
    return (historyIds ?? []).some((trackId) => artistTrackIdSet.has(trackId));
  }, [artistTrackIds, historyIds]);
  const artistListeners = Math.max(audienceNumber(data?.artist?.listeners), hasLocalArtistListen ? 1 : 0);
  const artistFollowers = Math.max(audienceNumber(data?.artist?.followers), artistFollowed ? 1 : 0);
  const releaseCardWindowDays = Number(data?.releaseCardWindowDays ?? 14);
  const allArtistReleases = useMemo(() => {
    const source = data?.allReleases?.length
      ? data.allReleases
      : [...(data?.popularAlbums ?? []), ...(data?.eps ?? []), ...(data?.singles ?? [])];
    const seen = new Set();

    return source.filter((release) => {
      if (!release?.id || seen.has(release.id)) {
        return false;
      }
      seen.add(release.id);
      return true;
    });
  }, [data]);
  const artistAlbums = useMemo(
    () => allArtistReleases.filter((release) => release.type === "album").slice(0, 10),
    [allArtistReleases]
  );
  const filteredArtistReleases = useMemo(
    () =>
      releaseFilter === "all"
        ? allArtistReleases
        : allArtistReleases.filter((release) => release.type === releaseFilter),
    [allArtistReleases, releaseFilter]
  );
  const releaseFilterCounts = useMemo(
    () =>
      releaseFilterOptions.reduce((counts, option) => {
        counts[option.id] =
          option.id === "all"
            ? allArtistReleases.length
            : allArtistReleases.filter((release) => release.type === option.id).length;
        return counts;
      }, {}),
    [allArtistReleases]
  );
  const releaseFilterLabel = releaseTypeLabels[releaseFilter] ?? "релизы";

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
                <span>{artistTrackCount} {pluralizeRu(artistTrackCount, "трек", "трека", "треков")}</span>
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
                <p className={styles.emptyText}>У автора нет свежих релизов за последние {releaseCardWindowDays} дней.</p>
              )}
            </aside>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Популярные альбомы</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {artistAlbums.length ? (
              <div className={styles.albumScroller}>
                {artistAlbums.map((album) => (
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
              <p className={styles.emptyText}>У автора пока нет альбомов.</p>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionTitle}>Релизы автора</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            {allArtistReleases.length ? (
              <div className={styles.releaseTabs} role="tablist" aria-label="Фильтр релизов автора">
                {releaseFilterOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`${styles.releaseTabButton} ${releaseFilter === option.id ? styles.releaseTabButtonActive : ""}`.trim()}
                    aria-pressed={releaseFilter === option.id}
                    onClick={() => setReleaseFilter(option.id)}
                  >
                    <span>{option.label}</span>
                    <span className={styles.releaseTabCount}>{releaseFilterCounts[option.id] ?? 0}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {filteredArtistReleases.length ? (
              <div className={styles.releaseList}>
                {filteredArtistReleases.map((release) => (
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
                      {getReleaseDurationSec(release) > 0
                        ? formatDurationClock(getReleaseDurationSec(release))
                        : "--:--"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.emptyText}>
                {allArtistReleases.length ? `В категории ${releaseFilterLabel} релизов нет.` : "У автора пока нет релизов."}
              </p>
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
