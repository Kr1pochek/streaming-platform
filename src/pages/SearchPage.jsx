import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiHeart, FiMusic, FiSearch } from "react-icons/fi";
import { LuHeart, LuHeartOff } from "react-icons/lu";
import styles from "./SearchPage.module.css";
import useScrollingVisibility from "../hooks/useScrollingVisibility.js";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchSearchFeed, searchCatalog } from "../api/musicApi.js";
import { usePlayer } from "../context/PlayerContext.jsx";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";

const tabs = [
  { id: "popular", label: "Популярное" },
  { id: "history", label: "История" },
];

const emptySearchState = {
  status: "idle",
  data: { tracks: [], playlists: [], artists: [] },
  error: "",
};

function splitColumns(items) {
  const splitPoint = Math.ceil(items.length / 2);
  return [items.slice(0, splitPoint), items.slice(splitPoint)];
}

export default function SearchPage() {
  const navigate = useNavigate();
  const { isScrolling, setScrollElement } = useScrollingVisibility();
  const { status, data, error, reload } = useAsyncResource(fetchSearchFeed, []);

  const {
    trackMap,
    likedIds,
    historyIds,
    playTrack,
    toggleLikeTrack,
    clearHistory,
  } = usePlayer();

  const [activeTab, setActiveTab] = useState("popular");
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState(emptySearchState);

  const normalizedQuery = query.trim();

  const resetSearch = () => {
    setQuery("");
    setSearchState(emptySearchState);
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    if (!value.trim()) {
      setSearchState(emptySearchState);
      return;
    }
    setSearchState((prev) => ({ ...prev, status: "loading", error: "" }));
  };

  useEffect(() => {
    if (!normalizedQuery) {
      return;
    }

    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        const result = await searchCatalog(normalizedQuery);
        if (cancelled) return;
        setSearchState({ status: "success", data: result, error: "" });
      } catch (err) {
        if (cancelled) return;
        setSearchState({
          status: "error",
          data: { tracks: [], playlists: [], artists: [] },
          error: err instanceof Error ? err.message : "Не удалось выполнить поиск.",
        });
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [normalizedQuery]);

  const popularTracks = useMemo(
    () => (data?.newTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.newTrackIds, trackMap]
  );

  const historyTracks = useMemo(() => {
    const sourceIds = historyIds.length ? historyIds : data?.historyTrackIds ?? [];
    return sourceIds.map((id) => trackMap[id]).filter(Boolean);
  }, [historyIds, data?.historyTrackIds, trackMap]);

  const [popularLeft, popularRight] = useMemo(() => splitColumns(popularTracks), [popularTracks]);
  const [historyLeft, historyRight] = useMemo(() => splitColumns(historyTracks), [historyTracks]);

  const hasSearchQuery = normalizedQuery.length > 0;
  const searchResults = searchState.data;
  const searchEmpty =
    searchState.status === "success" &&
    !searchResults.tracks.length &&
    !searchResults.playlists.length &&
    !searchResults.artists.length;

  return (
    <div className={styles.page}>
      <section
        ref={setScrollElement}
        className={`${styles.shell} ${isScrolling ? styles.shellScrolling : ""}`.trim()}
      >
        <div className={styles.searchBlock}>
          <label htmlFor="global-search" className={styles.searchLabel}>
            Поиск по трекам, альбомам и артистам
          </label>
          <div className={styles.searchInputWrap}>
            <FiSearch className={styles.searchIcon} aria-hidden="true" />
            <input
              id="global-search"
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder="Трек, альбом, исполнитель"
              autoComplete="off"
            />
          </div>

          {!hasSearchQuery ? (
            <div className={styles.tabs}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ""}`.trim()}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {status === "loading" ? (
          <ResourceState loading title="Загружаем поиск" description="Подготавливаем подборки и списки треков." />
        ) : null}

        {status === "error" ? (
          <ResourceState
            title="Не удалось загрузить раздел поиска"
            description={error}
            actionLabel="Повторить"
            onAction={reload}
          />
        ) : null}

        {status === "success" && hasSearchQuery ? (
          <SearchResults
            query={normalizedQuery}
            searchState={searchState}
            searchResults={searchResults}
            searchEmpty={searchEmpty}
            likedIds={likedIds}
            onPlay={playTrack}
            onToggleLike={toggleLikeTrack}
            onClearQuery={resetSearch}
          />
        ) : null}

        {status === "success" && !hasSearchQuery && activeTab === "popular" ? (
          <>
            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Подборки музыки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.collectionsGrid}>
                {data.collections.map((item) => (
                  <button key={item.id} type="button" className={styles.collectionCard}>
                    <span className={styles.collectionCover} style={{ background: item.gradient }} />
                    <span className={styles.collectionTitle}>{item.title}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Мировые новинки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.tracksGrid}>
                <TrackListColumn
                  tracks={popularLeft}
                  likedIds={likedIds}
                  onPlay={playTrack}
                  onToggleLike={toggleLikeTrack}
                />
                <TrackListColumn
                  tracks={popularRight}
                  likedIds={likedIds}
                  onPlay={playTrack}
                  onToggleLike={toggleLikeTrack}
                />
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Больше новой музыки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.moreGrid}>
                {data.morePlaylists.map((playlist) => (
                  <button key={playlist.id} type="button" className={styles.moreCard} onClick={() => navigate("/library")}>
                    <span className={styles.moreCover} style={{ background: playlist.cover }} />
                    <span className={styles.moreTitle}>{playlist.title}</span>
                    <span className={styles.moreArtist}>{playlist.artist}</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {status === "success" && !hasSearchQuery && activeTab === "history" ? (
          <section className={`${styles.section} ${styles.historySection}`}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionHeading}>История поиска</h2>
            </div>

            {historyTracks.length ? (
              <>
                <div className={styles.historyGrid}>
                  <HistoryColumn tracks={historyLeft} likedIds={likedIds} onPlay={playTrack} onToggleLike={toggleLikeTrack} />
                  <HistoryColumn tracks={historyRight} likedIds={likedIds} onPlay={playTrack} onToggleLike={toggleLikeTrack} />
                </div>
                <button type="button" className={styles.clearHistoryButton} onClick={clearHistory}>
                  Очистить историю
                </button>
              </>
            ) : (
              <ResourceState
                title="История пока пустая"
                description="Запускай треки из поиска, и они появятся здесь автоматически."
                actionLabel="Перейти в популярное"
                onAction={() => setActiveTab("popular")}
              />
            )}
          </section>
        ) : null}
      </section>
    </div>
  );
}

function SearchResults({
  query,
  searchState,
  searchResults,
  searchEmpty,
  likedIds,
  onPlay,
  onToggleLike,
  onClearQuery,
}) {
  if (searchState.status === "loading") {
    return (
      <section className={styles.section}>
        <ResourceState loading title="Ищем совпадения" description={`По запросу "${query}"`} />
      </section>
    );
  }

  if (searchState.status === "error") {
    return (
      <section className={styles.section}>
        <ResourceState title="Поиск недоступен" description={searchState.error} actionLabel="Очистить" onAction={onClearQuery} />
      </section>
    );
  }

  if (searchEmpty) {
    return (
      <section className={styles.section}>
        <ResourceState
          title="Ничего не найдено"
          description={`По запросу "${query}" пока нет результатов. Попробуй другие ключевые слова.`}
          actionLabel="Сбросить"
          onAction={onClearQuery}
        />
      </section>
    );
  }

  const [resultLeft, resultRight] = splitColumns(searchResults.tracks);

  return (
    <>
      {!!searchResults.tracks.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Треки</h2>
            <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
          </div>
          <div className={styles.tracksGrid}>
            <TrackListColumn tracks={resultLeft} likedIds={likedIds} onPlay={onPlay} onToggleLike={onToggleLike} />
            <TrackListColumn tracks={resultRight} likedIds={likedIds} onPlay={onPlay} onToggleLike={onToggleLike} />
          </div>
        </section>
      )}

      {!!searchResults.playlists.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Плейлисты</h2>
          </div>
          <div className={styles.moreGrid}>
            {searchResults.playlists.map((playlist) => (
              <article key={playlist.id} className={styles.moreCard}>
                <span className={styles.moreCover} style={{ background: playlist.cover }} />
                <span className={styles.moreTitle}>{playlist.title}</span>
                <span className={styles.moreArtist}>{playlist.subtitle}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {!!searchResults.artists.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Исполнители</h2>
          </div>
          <div className={styles.artistResultsGrid}>
            {searchResults.artists.map((artist) => (
              <article key={artist.id} className={styles.artistResultCard}>
                <span className={styles.artistResultAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                <span className={styles.artistResultMeta}>
                  <span className={styles.artistResultName}>{artist.name}</span>
                  <span className={styles.artistResultFollowers}>{artist.followers} подписчиков</span>
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function TrackListColumn({ tracks, likedIds, onPlay, onToggleLike }) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        return (
          <li key={track.id}>
            <button type="button" className={styles.trackRow} onClick={() => onPlay(track.id)}>
              <span className={styles.trackCover} style={{ background: track.cover }} />
              <span className={styles.trackMeta}>
                <span className={styles.trackTitle}>
                  {track.title}
                  {track.explicit ? <span className={styles.explicitTag}>E</span> : null}
                </span>
                <span className={styles.trackArtist}>{track.artist}</span>
              </span>
              <span
                className={styles.likeButton}
                role="button"
                tabIndex={0}
                aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLike(track.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleLike(track.id);
                  }
                }}
              >
                {liked ? <FiHeart /> : <LuHeart />}
              </span>
              <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryColumn({ tracks, likedIds, onPlay, onToggleLike }) {
  return (
    <ul className={styles.historyTrackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        return (
          <li key={track.id}>
            <button type="button" className={styles.historyTrackRow} onClick={() => onPlay(track.id)}>
              <span className={styles.historyCover} style={{ background: track.cover }} />
              <span className={styles.historyMeta}>
                <span className={styles.historyTitle}>
                  {track.title}
                  {track.explicit ? <span className={styles.explicitTag}>E</span> : null}
                </span>
                <span className={styles.historySubtitle}>{track.artist}</span>
              </span>
              <span
                className={styles.historyActionButton}
                role="button"
                tabIndex={0}
                aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLike(track.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleLike(track.id);
                  }
                }}
              >
                {liked ? <FiHeart /> : <LuHeartOff />}
              </span>
              <span className={styles.historyDuration}>{formatDurationClock(track.durationSec)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
