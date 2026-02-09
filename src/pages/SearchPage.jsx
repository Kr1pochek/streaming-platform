import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiExternalLink, FiHeart, FiPlay, FiPlus, FiSearch } from "react-icons/fi";
import { LuHeart, LuHeartOff } from "react-icons/lu";
import styles from "./SearchPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchSearchFeed, searchCatalog } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import SmartRecommendations from "../components/SmartRecommendations.jsx";

const tabs = [
  { id: "popular", label: "Популярное" },
  { id: "history", label: "История" },
];

const searchFilters = [
  { id: "all", label: "Все" },
  { id: "tracks", label: "Треки" },
  { id: "artists", label: "Артисты" },
  { id: "playlists", label: "Плейлисты" },
  { id: "albums", label: "Альбомы" },
];

const PAGE_LIMIT = 12;
const defaultPagination = {
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
  nextOffset: null,
};

const emptySearchState = {
  status: "idle",
  data: { tracks: [], playlists: [], artists: [], albums: [] },
  error: "",
  pagination: defaultPagination,
  loadingMore: false,
};

function splitColumns(items) {
  const splitPoint = Math.ceil(items.length / 2);
  return [items.slice(0, splitPoint), items.slice(splitPoint)];
}

function mergeById(currentItems = [], nextItems = []) {
  const result = [...currentItems];
  const seen = new Set(currentItems.map((item) => item?.id).filter(Boolean));
  for (const item of nextItems) {
    const id = item?.id;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(item);
  }
  return result;
}

export default function SearchPage() {
  const navigate = useNavigate();
  const loadSearchFeed = useCallback(() => fetchSearchFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadSearchFeed);

  const {
    trackMap,
    likedIds,
    historyIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    clearHistory,
    addTrackNext,
  } = usePlayer();

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const [activeTab, setActiveTab] = useState("popular");
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchState, setSearchState] = useState(emptySearchState);

  const normalizedQuery = query.trim();

  const resetSearch = () => {
    setQuery("");
    setResultFilter("all");
    setSearchOffset(0);
    setSearchState(emptySearchState);
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    setSearchOffset(0);
    if (!value.trim()) {
      setResultFilter("all");
      setSearchState(emptySearchState);
      return;
    }
    setSearchState((prev) => ({
      ...prev,
      status: "loading",
      error: "",
      loadingMore: false,
      pagination: defaultPagination,
    }));
  };

  const handleFilterChange = (nextFilterId) => {
    setResultFilter(nextFilterId);
    setSearchOffset(0);
    setSearchState((prev) => ({
      ...prev,
      status: normalizedQuery ? "loading" : "idle",
      error: "",
      loadingMore: false,
      pagination: defaultPagination,
      data:
        normalizedQuery && prev.status === "success"
          ? { tracks: [], playlists: [], artists: [], albums: [] }
          : prev.data,
    }));
  };

  useEffect(() => {
    if (!normalizedQuery) {
      return;
    }

    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        if (searchOffset > 0) {
          setSearchState((prev) => ({ ...prev, loadingMore: true, error: "" }));
        }
        const result = await searchCatalog(normalizedQuery, {
          filter: resultFilter,
          limit: PAGE_LIMIT,
          offset: searchOffset,
        });
        if (cancelled) return;
        setSearchState((prev) => {
          if (searchOffset <= 0) {
            return {
              status: "success",
              data: {
                tracks: result?.tracks ?? [],
                playlists: result?.playlists ?? [],
                artists: result?.artists ?? [],
                albums: result?.albums ?? [],
              },
              error: "",
              loadingMore: false,
              pagination: result?.pagination ?? defaultPagination,
            };
          }

          return {
            status: "success",
            data: {
              tracks: mergeById(prev.data?.tracks ?? [], result?.tracks ?? []),
              playlists: mergeById(prev.data?.playlists ?? [], result?.playlists ?? []),
              artists: mergeById(prev.data?.artists ?? [], result?.artists ?? []),
              albums: mergeById(prev.data?.albums ?? [], result?.albums ?? []),
            },
            error: "",
            loadingMore: false,
            pagination: result?.pagination ?? defaultPagination,
          };
        });
      } catch (err) {
        if (cancelled) return;
        setSearchState((prev) => ({
          status: searchOffset > 0 ? "success" : "error",
          data: searchOffset > 0 ? prev.data : { tracks: [], playlists: [], artists: [], albums: [] },
          error: err instanceof Error ? err.message : "Не удалось выполнить поиск.",
          loadingMore: false,
          pagination: searchOffset > 0 ? prev.pagination : defaultPagination,
        }));
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [normalizedQuery, resultFilter, searchOffset]);

  const popularTracks = useMemo(
    () => (data?.newTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.newTrackIds, trackMap]
  );

  const historyTracks = useMemo(() => {
    return historyIds.map((id) => trackMap[id]).filter(Boolean);
  }, [historyIds, trackMap]);

  const recommendations = useMemo(() => {
    const source = popularTracks.length ? popularTracks : Object.values(trackMap);
    return source.slice(0, 4);
  }, [popularTracks, trackMap]);

  const [popularLeft, popularRight] = useMemo(() => splitColumns(popularTracks), [popularTracks]);
  const [historyLeft, historyRight] = useMemo(() => splitColumns(historyTracks), [historyTracks]);

  const hasSearchQuery = normalizedQuery.length > 0;
  const searchResults = searchState.data;
  const searchEmpty =
    searchState.status === "success" &&
    !searchResults.tracks.length &&
    !searchResults.playlists.length &&
    !searchResults.artists.length &&
    !searchResults.albums.length;

  return (
    <PageShell>
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

        {hasSearchQuery ? (
          <div className={styles.searchFilters}>
            {searchFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`${styles.filterButton} ${resultFilter === filter.id ? styles.filterButtonActive : ""}`.trim()}
                onClick={() => handleFilterChange(filter.id)}
              >
                {filter.label}
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
          currentTrackId={currentTrackId}
          recommendationTracks={recommendations}
          pagination={searchState.pagination}
          loadingMore={searchState.loadingMore}
          onPlay={playTrack}
          onToggleLike={toggleLikeTrack}
          onAddNext={addTrackNext}
          onOpenTrack={(id) => navigate(`/track/${id}`)}
          onOpenPlaylist={(id) => navigate(`/playlist/${id}`)}
          onOpenArtist={(id) => navigate(`/artist/${id}`)}
          onOpenRelease={(id) => navigate(`/release/${id}`)}
          onClearQuery={resetSearch}
          onLoadMore={() =>
            setSearchOffset((prev) =>
              Number.isFinite(searchState.pagination?.nextOffset)
                ? searchState.pagination.nextOffset
                : prev + PAGE_LIMIT
            )
          }
          onOpenTrackMenu={openTrackMenu}
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
                currentTrackId={currentTrackId}
                onPlay={playTrack}
                onToggleLike={toggleLikeTrack}
                onAddNext={addTrackNext}
                onOpenTrack={(id) => navigate(`/track/${id}`)}
                onOpenArtist={(id) => navigate(`/artist/${id}`)}
                onOpenTrackMenu={openTrackMenu}
              />
              <TrackListColumn
                tracks={popularRight}
                likedIds={likedIds}
                currentTrackId={currentTrackId}
                onPlay={playTrack}
                onToggleLike={toggleLikeTrack}
                onAddNext={addTrackNext}
                onOpenTrack={(id) => navigate(`/track/${id}`)}
                onOpenArtist={(id) => navigate(`/artist/${id}`)}
                onOpenTrackMenu={openTrackMenu}
              />
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionHeading}>Больше новой музыки</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            <div className={styles.moreGrid}>
              {data.morePlaylists.map((playlist) => {
                const firstTrackId = playlist.trackIds?.[0] ?? null;
                return (
                  <article key={playlist.id} className={styles.moreCard}>
                    <button
                      type="button"
                      className={styles.moreMainButton}
                      onClick={() => navigate(`/playlist/${playlist.id}`)}
                    >
                      <span className={styles.moreCover} style={{ background: playlist.cover }} />
                      <span className={styles.moreTitle}>{playlist.title}</span>
                      <span className={styles.moreArtist}>{playlist.artist}</span>
                    </button>
                    {firstTrackId ? (
                      <span className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Слушать"
                          onClick={() => playTrack(firstTrackId)}
                        >
                          <FiPlay />
                        </button>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Лайк"
                          onClick={() => toggleLikeTrack(firstTrackId)}
                        >
                          <FiHeart />
                        </button>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Добавить далее"
                          onClick={() => addTrackNext(firstTrackId)}
                        >
                          <FiPlus />
                        </button>
                      </span>
                    ) : null}
                  </article>
                );
              })}
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
                <HistoryColumn
                  tracks={historyLeft}
                  likedIds={likedIds}
                  currentTrackId={currentTrackId}
                  onPlay={playTrack}
                  onToggleLike={toggleLikeTrack}
                  onAddNext={addTrackNext}
                  onOpenTrack={(id) => navigate(`/track/${id}`)}
                  onOpenArtist={(id) => navigate(`/artist/${id}`)}
                  onOpenTrackMenu={openTrackMenu}
                />
                <HistoryColumn
                  tracks={historyRight}
                  likedIds={likedIds}
                  currentTrackId={currentTrackId}
                  onPlay={playTrack}
                  onToggleLike={toggleLikeTrack}
                  onAddNext={addTrackNext}
                  onOpenTrack={(id) => navigate(`/track/${id}`)}
                  onOpenArtist={(id) => navigate(`/artist/${id}`)}
                  onOpenTrackMenu={openTrackMenu}
                />
              </div>
              <button type="button" className={styles.clearHistoryButton} onClick={clearHistory}>
                Очистить историю
              </button>
            </>
          ) : (
            <>
              <ResourceState
                title="История пока пустая"
                description="Запускай треки из поиска, и они появятся здесь автоматически."
                actionLabel="Перейти в популярное"
                onAction={() => setActiveTab("popular")}
              />
              <SmartRecommendations
                title="Пока история пустая, попробуй это"
                tracks={recommendations}
                onPlayTrack={playTrack}
                onLikeTrack={toggleLikeTrack}
                onOpenTrack={(trackId) => navigate(`/track/${trackId}`)}
              />
            </>
          )}
        </section>
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}

function SearchResults({
  query,
  searchState,
  searchResults,
  searchEmpty,
  likedIds,
  currentTrackId,
  recommendationTracks,
  pagination,
  loadingMore,
  onPlay,
  onToggleLike,
  onAddNext,
  onOpenTrack,
  onOpenPlaylist,
  onOpenArtist,
  onOpenRelease,
  onClearQuery,
  onLoadMore,
  onOpenTrackMenu,
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
        <ResourceState
          title="Поиск недоступен"
          description={searchState.error}
          actionLabel="Очистить"
          onAction={onClearQuery}
        />
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
        <SmartRecommendations
          title="Пока нет совпадений, можно включить"
          tracks={recommendationTracks}
          onPlayTrack={onPlay}
          onLikeTrack={onToggleLike}
          onOpenTrack={onOpenTrack}
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
            <TrackListColumn
              tracks={resultLeft}
              likedIds={likedIds}
              currentTrackId={currentTrackId}
              onPlay={onPlay}
              onToggleLike={onToggleLike}
              onAddNext={onAddNext}
              onOpenTrack={onOpenTrack}
              onOpenArtist={onOpenArtist}
              onOpenTrackMenu={onOpenTrackMenu}
            />
            <TrackListColumn
              tracks={resultRight}
              likedIds={likedIds}
              currentTrackId={currentTrackId}
              onPlay={onPlay}
              onToggleLike={onToggleLike}
              onAddNext={onAddNext}
              onOpenTrack={onOpenTrack}
              onOpenArtist={onOpenArtist}
              onOpenTrackMenu={onOpenTrackMenu}
            />
          </div>
        </section>
      )}

      {!!searchResults.playlists.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Плейлисты</h2>
          </div>
          <div className={styles.moreGrid}>
            {searchResults.playlists.map((playlist) => {
              const firstTrackId = playlist.trackIds?.[0] ?? null;
              return (
                <article key={playlist.id} className={styles.moreCard}>
                  <button
                    type="button"
                    className={styles.moreMainButton}
                    onClick={() => onOpenPlaylist(playlist.id)}
                  >
                    <span className={styles.moreCover} style={{ background: playlist.cover }} />
                    <span className={styles.moreTitle}>{playlist.title}</span>
                    <span className={styles.moreArtist}>{playlist.subtitle}</span>
                  </button>
                  {firstTrackId ? (
                    <span className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.cardActionButton}
                        aria-label="Слушать"
                        onClick={() => onPlay(firstTrackId)}
                      >
                        <FiPlay />
                      </button>
                      <button
                        type="button"
                        className={styles.cardActionButton}
                        aria-label="Лайк"
                        onClick={() => onToggleLike(firstTrackId)}
                      >
                        <FiHeart />
                      </button>
                      <button
                        type="button"
                        className={styles.cardActionButton}
                        aria-label="Добавить далее"
                        onClick={() => onAddNext(firstTrackId)}
                      >
                        <FiPlus />
                      </button>
                    </span>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!!searchResults.albums.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Альбомы</h2>
          </div>
          <div className={styles.moreGrid}>
            {searchResults.albums.map((album) => (
              <button key={album.id} type="button" className={styles.moreCard} onClick={() => onOpenRelease(album.id)}>
                <span className={styles.moreCover} style={{ background: album.cover }} />
                <span className={styles.moreTitle}>{album.title}</span>
                <span className={styles.moreArtist}>
                  {album.artistName} • {album.year}
                </span>
              </button>
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
              <button
                key={artist.id}
                type="button"
                className={styles.artistResultCard}
                onClick={() => onOpenArtist(artist.id)}
              >
                <span className={styles.artistResultAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                <span className={styles.artistResultMeta}>
                  <span className={styles.artistResultName}>{artist.name}</span>
                  <span className={styles.artistResultFollowers}>{artist.followers} подписчиков</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {pagination?.hasMore ? (
        <section className={styles.section}>
          <button
            type="button"
            className={styles.loadMoreButton}
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Загружаем..." : "Показать еще"}
          </button>
        </section>
      ) : null}
    </>
  );
}

function TrackListColumn({
  tracks,
  likedIds,
  currentTrackId,
  onPlay,
  onToggleLike,
  onAddNext,
  onOpenTrack,
  onOpenArtist,
  onOpenTrackMenu,
}) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        const isActive = currentTrackId === track.id;
        return (
          <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
            <button
              type="button"
              className={styles.trackMainButton}
              onClick={() => onPlay(track.id)}
              onContextMenu={(event) => onOpenTrackMenu(event, track.id)}
            >
              <span className={styles.trackCover} style={{ background: track.cover }} />
              <span className={styles.trackMeta}>
                <span className={styles.trackTitle}>
                  {isActive ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                  {track.title}
                  {track.explicit ? <span className={styles.explicitTag}>E</span> : null}
                </span>
                <ArtistInlineLinks
                  artistLine={track.artist}
                  className={styles.trackArtist}
                  linkClassName={styles.trackArtistButton}
                  textClassName={styles.trackArtist}
                  onOpenArtist={onOpenArtist}
                  stopPropagation
                />
              </span>
            </button>
            <button
              type="button"
              className={styles.likeButton}
              aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
              onClick={() => onToggleLike(track.id)}
            >
              {liked ? <FiHeart /> : <LuHeart />}
            </button>
            <button
              type="button"
              className={styles.queueButton}
              aria-label="Добавить далее в очередь"
              onClick={() => onAddNext(track.id)}
            >
              <FiPlus />
            </button>
            <button
              type="button"
              className={styles.openButton}
              aria-label="Открыть страницу трека"
              onClick={() => onOpenTrack(track.id)}
            >
              <FiExternalLink />
            </button>
            <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryColumn({
  tracks,
  likedIds,
  currentTrackId,
  onPlay,
  onToggleLike,
  onAddNext,
  onOpenTrack,
  onOpenArtist,
  onOpenTrackMenu,
}) {
  return (
    <ul className={styles.historyTrackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        const isActive = currentTrackId === track.id;
        return (
          <li
            key={track.id}
            className={`${styles.historyTrackRow} ${isActive ? styles.historyTrackRowActive : ""}`.trim()}
          >
            <button
              type="button"
              className={styles.historyMainButton}
              onClick={() => onPlay(track.id)}
              onContextMenu={(event) => onOpenTrackMenu(event, track.id)}
            >
              <span className={styles.historyCover} style={{ background: track.cover }} />
              <span className={styles.historyMeta}>
                <span className={styles.historyTitle}>
                  {isActive ? <span className={styles.currentDot} aria-hidden="true" /> : null}
                  {track.title}
                  {track.explicit ? <span className={styles.explicitTag}>E</span> : null}
                </span>
                <ArtistInlineLinks
                  artistLine={track.artist}
                  className={styles.historySubtitle}
                  linkClassName={styles.historyArtistButton}
                  textClassName={styles.historySubtitle}
                  onOpenArtist={onOpenArtist}
                  stopPropagation
                />
              </span>
            </button>
            <button
              type="button"
              className={styles.historyActionButton}
              aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
              onClick={() => onToggleLike(track.id)}
            >
              {liked ? <FiHeart /> : <LuHeartOff />}
            </button>
            <button
              type="button"
              className={styles.historyQueueButton}
              aria-label="Добавить далее в очередь"
              onClick={() => onAddNext(track.id)}
            >
              <FiPlus />
            </button>
            <button
              type="button"
              className={styles.historyOpenButton}
              aria-label="Открыть страницу трека"
              onClick={() => onOpenTrack(track.id)}
            >
              <FiExternalLink />
            </button>
            <span className={styles.historyDuration}>{formatDurationClock(track.durationSec)}</span>
          </li>
        );
      })}
    </ul>
  );
}
