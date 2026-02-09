import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fetchCatalogMap, fetchPlayerState, updatePlayerState } from "../api/musicApi.js";
import useAuth from "../hooks/useAuth.js";
import { formatDuration } from "../utils/formatters.js";
import PlayerContext from "./playerContext.js";

const repeatModes = ["off", "all", "one"];
let runtimeTracks = [];
let runtimeArtists = [];
let trackMap = Object.create(null);
let artistMap = Object.create(null);
const STORAGE_KEY = "music.player.state.v1";

const defaultState = {
  queue: [],
  currentIndex: 0,
  isPlaying: false,
  volume: 70,
  progressSec: 0,
  likedIds: [],
  followedArtistIds: [],
  historyIds: [],
  shuffleEnabled: false,
  repeatMode: "off",
  seekVersion: 0,
  toastSeq: 0,
  toastItems: [],
  catalogVersion: 0,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function uniqueTrackIds(trackIds = []) {
  const seen = new Set();
  const validIds = [];
  for (const id of trackIds) {
    if (trackMap[id] && !seen.has(id)) {
      seen.add(id);
      validIds.push(id);
    }
  }
  return validIds;
}

function uniqueStringIds(values = []) {
  const seen = new Set();
  const ids = [];
  for (const value of values) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function uniqueArtistIds(artistIds = []) {
  const seen = new Set();
  const validIds = [];
  for (const id of artistIds) {
    if (artistMap[id] && !seen.has(id)) {
      seen.add(id);
      validIds.push(id);
    }
  }
  return validIds;
}

function enqueueToast(state, message) {
  const toastId = state.toastSeq + 1;
  const toastItems = [...state.toastItems, { id: toastId, message }].slice(-4);
  return {
    ...state,
    toastSeq: toastId,
    toastItems,
  };
}

function addHistory(historyIds, trackId) {
  if (!trackId || !trackMap[trackId]) return historyIds;
  const filtered = historyIds.filter((id) => id !== trackId);
  return [trackId, ...filtered].slice(0, 24);
}

function pickRandomIndex(currentIndex, length) {
  if (length <= 1) return currentIndex;
  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * length);
  }
  return nextIndex;
}

function getNextIndex(state, { direction = 1, fromAuto = false } = {}) {
  const queueLength = state.queue.length;
  if (!queueLength) return null;

  if (direction < 0) {
    if (state.shuffleEnabled && queueLength > 1) {
      return pickRandomIndex(state.currentIndex, queueLength);
    }
    if (state.currentIndex > 0) {
      return state.currentIndex - 1;
    }
    if (state.repeatMode === "all") {
      return queueLength - 1;
    }
    return fromAuto ? null : 0;
  }

  if (state.shuffleEnabled && queueLength > 1) {
    return pickRandomIndex(state.currentIndex, queueLength);
  }
  if (state.currentIndex < queueLength - 1) {
    return state.currentIndex + 1;
  }
  if (state.repeatMode === "all") {
    return 0;
  }
  return fromAuto ? null : state.currentIndex;
}

function normalizePersistedState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const hasQueue = Array.isArray(raw.queue);
  const hasLikedIds = Array.isArray(raw.likedIds);
  const hasFollowedArtistIds = Array.isArray(raw.followedArtistIds);
  const hasHistoryIds = Array.isArray(raw.historyIds);

  const queue = hasQueue ? uniqueStringIds(raw.queue) : defaultState.queue;
  const likedIds = hasLikedIds ? uniqueStringIds(raw.likedIds) : defaultState.likedIds;
  const followedArtistIds = hasFollowedArtistIds
    ? uniqueStringIds(raw.followedArtistIds)
    : defaultState.followedArtistIds;
  const historyIds = hasHistoryIds
    ? uniqueStringIds(raw.historyIds).slice(0, 24)
    : defaultState.historyIds;

  return {
    queue,
    currentIndex: clamp(
      Number.isInteger(raw.currentIndex) ? raw.currentIndex : defaultState.currentIndex,
      0,
      Math.max(queue.length - 1, 0)
    ),
    volume: clamp(Number.isFinite(raw.volume) ? Number(raw.volume) : defaultState.volume, 0, 100),
    likedIds,
    followedArtistIds,
    historyIds,
    shuffleEnabled: Boolean(raw.shuffleEnabled),
    repeatMode: repeatModes.includes(raw.repeatMode) ? raw.repeatMode : defaultState.repeatMode,
  };
}

function readPersistedState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return normalizePersistedState(parsed);
  } catch {
    return null;
  }
}

function buildInitialState() {
  const persisted = readPersistedState();
  return {
    ...defaultState,
    ...(persisted ?? {}),
  };
}

function playerReducer(state, action) {
  switch (action.type) {
    case "toggle_play": {
      if (!state.queue.length) {
        return state;
      }
      return { ...state, isPlaying: !state.isPlaying };
    }

    case "catalog_hydrated": {
      const currentQueue = uniqueTrackIds(state.queue);
      const fallbackQueueIds = uniqueTrackIds(action.fallbackQueueIds ?? []);
      const nextQueue = currentQueue.length ? currentQueue : fallbackQueueIds;
      const nextCurrentIndex = clamp(state.currentIndex, 0, Math.max(nextQueue.length - 1, 0));

      return {
        ...state,
        queue: nextQueue,
        currentIndex: nextCurrentIndex,
        likedIds: uniqueTrackIds(state.likedIds),
        followedArtistIds: uniqueArtistIds(state.followedArtistIds),
        historyIds: uniqueTrackIds(state.historyIds).slice(0, 24),
        progressSec: nextQueue.length ? state.progressSec : 0,
        catalogVersion: state.catalogVersion + 1,
      };
    }

    case "hydrate_remote_state": {
      return {
        ...state,
        likedIds: uniqueTrackIds(action.likedIds ?? []),
        followedArtistIds: uniqueArtistIds(action.followedArtistIds ?? []),
        historyIds: uniqueTrackIds(action.historyIds ?? []).slice(0, 24),
      };
    }

    case "play_track": {
      if (!trackMap[action.trackId]) {
        return state;
      }

      const existingIndex = state.queue.indexOf(action.trackId);
      const nextQueue = existingIndex >= 0 ? state.queue : [action.trackId, ...state.queue.filter(Boolean)];
      const nextIndex = existingIndex >= 0 ? existingIndex : 0;

      return {
        ...state,
        queue: nextQueue,
        currentIndex: nextIndex,
        isPlaying: true,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
        historyIds: addHistory(state.historyIds, action.trackId),
      };
    }

    case "play_queue": {
      const nextQueue = uniqueTrackIds(action.trackIds);
      if (!nextQueue.length) {
        return state;
      }

      const startIndex = clamp(Number(action.startIndex ?? 0), 0, nextQueue.length - 1);
      const nextTrackId = nextQueue[startIndex];

      return {
        ...state,
        queue: nextQueue,
        currentIndex: startIndex,
        isPlaying: true,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
        historyIds: addHistory(state.historyIds, nextTrackId),
      };
    }

    case "jump_to_index": {
      if (!state.queue.length) {
        return state;
      }

      const index = clamp(Number(action.index ?? 0), 0, state.queue.length - 1);
      const trackId = state.queue[index];

      return {
        ...state,
        currentIndex: index,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, trackId),
      };
    }

    case "next_track": {
      if (!state.queue.length) {
        return state;
      }

      const nextIndex = getNextIndex(state, { direction: 1, fromAuto: false });
      const nextTrackId = state.queue[nextIndex];

      return {
        ...state,
        currentIndex: nextIndex,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, nextTrackId),
      };
    }

    case "prev_track": {
      if (!state.queue.length) {
        return state;
      }

      if (state.progressSec > 4) {
        return {
          ...state,
          progressSec: 0,
          seekVersion: state.seekVersion + 1,
        };
      }

      const prevIndex = getNextIndex(state, { direction: -1, fromAuto: false });
      const prevTrackId = state.queue[prevIndex];

      return {
        ...state,
        currentIndex: prevIndex,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, prevTrackId),
      };
    }

    case "track_finished": {
      const currentTrackId = state.queue[state.currentIndex];
      const currentTrack = trackMap[currentTrackId];
      if (!currentTrack) {
        return {
          ...state,
          isPlaying: false,
          progressSec: 0,
        };
      }

      if (state.repeatMode === "one") {
        return {
          ...state,
          progressSec: 0,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, currentTrackId),
        };
      }

      const nextIndex = getNextIndex(state, { direction: 1, fromAuto: true });
      if (nextIndex === null) {
        return {
          ...state,
          isPlaying: false,
          progressSec: currentTrack.durationSec,
        };
      }

      const nextTrackId = state.queue[nextIndex];
      return {
        ...state,
        currentIndex: nextIndex,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, nextTrackId),
      };
    }

    case "seek_percent": {
      const trackId = state.queue[state.currentIndex];
      const track = trackMap[trackId];
      if (!track) {
        return state;
      }
      const progressSec = (clamp(action.percent, 0, 100) / 100) * track.durationSec;
      return {
        ...state,
        progressSec,
        seekVersion: state.seekVersion + 1,
      };
    }

    case "sync_progress_sec": {
      const trackId = state.queue[state.currentIndex];
      const track = trackMap[trackId];
      if (!track) return state;

      const nextValue = clamp(action.progressSec, 0, track.durationSec);
      if (Math.floor(nextValue) === Math.floor(state.progressSec)) {
        return state;
      }

      return {
        ...state,
        progressSec: nextValue,
      };
    }

    case "set_volume": {
      return { ...state, volume: clamp(action.volume, 0, 100) };
    }

    case "toggle_shuffle": {
      return { ...state, shuffleEnabled: !state.shuffleEnabled };
    }

    case "cycle_repeat": {
      const currentModeIndex = repeatModes.indexOf(state.repeatMode);
      const nextMode = repeatModes[(currentModeIndex + 1) % repeatModes.length];
      return { ...state, repeatMode: nextMode };
    }

    case "remove_from_queue": {
      const index = Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) {
        return state;
      }

      const nextQueue = state.queue.filter((_, itemIndex) => itemIndex !== index);
      if (!nextQueue.length) {
        return {
          ...state,
          queue: [],
          currentIndex: 0,
          isPlaying: false,
          progressSec: 0,
          seekVersion: state.seekVersion + 1,
        };
      }

      let nextIndex = state.currentIndex;
      let nextProgress = state.progressSec;
      let nextHistory = state.historyIds;

      if (index < state.currentIndex) {
        nextIndex = state.currentIndex - 1;
      } else if (index === state.currentIndex) {
        nextIndex = Math.min(index, nextQueue.length - 1);
        nextProgress = 0;
        nextHistory = addHistory(state.historyIds, nextQueue[nextIndex]);
      }

      return {
        ...state,
        queue: nextQueue,
        currentIndex: nextIndex,
        progressSec: nextProgress,
        seekVersion: state.seekVersion + (index === state.currentIndex ? 1 : 0),
        historyIds: nextHistory,
      };
    }

    case "clear_queue": {
      const nextState = {
        ...state,
        queue: [],
        currentIndex: 0,
        isPlaying: false,
        progressSec: 0,
        seekVersion: state.seekVersion + 1,
      };
      return state.queue.length ? enqueueToast(nextState, "Очередь очищена") : nextState;
    }

    case "add_track_next": {
      if (!trackMap[action.trackId]) {
        return state;
      }

      if (!state.queue.length) {
        return enqueueToast(
          {
            ...state,
            queue: [action.trackId],
            currentIndex: 0,
          },
          "Трек добавлен в очередь"
        );
      }

      const currentTrackId = state.queue[state.currentIndex];
      if (!currentTrackId) {
        return state;
      }

      if (currentTrackId === action.trackId) {
        return enqueueToast(state, "Этот трек уже играет");
      }

      const nextQueueBase = state.queue.filter((trackId) => trackId !== action.trackId);
      const currentIndexInBase = nextQueueBase.indexOf(currentTrackId);
      const insertIndex = currentIndexInBase >= 0 ? currentIndexInBase + 1 : state.currentIndex + 1;
      const nextQueue = [
        ...nextQueueBase.slice(0, insertIndex),
        action.trackId,
        ...nextQueueBase.slice(insertIndex),
      ];
      const nextCurrentIndex = Math.max(nextQueue.indexOf(currentTrackId), 0);

      return enqueueToast(
        {
          ...state,
          queue: nextQueue,
          currentIndex: nextCurrentIndex,
        },
        "Добавлено далее в очередь"
      );
    }

    case "add_queue_next": {
      const nextTrackIds = uniqueTrackIds(action.trackIds);
      if (!nextTrackIds.length) {
        return state;
      }

      const sourceLabel = action.sourceLabel ?? "Плейлист";
      if (!state.queue.length) {
        return enqueueToast(
          {
            ...state,
            queue: nextTrackIds,
            currentIndex: 0,
          },
          `${sourceLabel} добавлен в очередь`
        );
      }

      const currentTrackId = state.queue[state.currentIndex];
      if (!currentTrackId) {
        return state;
      }

      const insertTrackIds = nextTrackIds.filter((trackId) => trackId !== currentTrackId);
      if (!insertTrackIds.length) {
        return enqueueToast(state, `${sourceLabel} уже в очереди`);
      }

      const queueWithoutNewTracks = state.queue.filter(
        (trackId) => trackId === currentTrackId || !insertTrackIds.includes(trackId)
      );
      const currentIndexInBase = queueWithoutNewTracks.indexOf(currentTrackId);
      const insertIndex = currentIndexInBase >= 0 ? currentIndexInBase + 1 : state.currentIndex + 1;
      const nextQueue = [
        ...queueWithoutNewTracks.slice(0, insertIndex),
        ...insertTrackIds,
        ...queueWithoutNewTracks.slice(insertIndex),
      ];
      const nextCurrentIndex = Math.max(nextQueue.indexOf(currentTrackId), 0);

      return enqueueToast(
        {
          ...state,
          queue: nextQueue,
          currentIndex: nextCurrentIndex,
        },
        `${sourceLabel} добавлен далее в очередь`
      );
    }

    case "move_queue_item": {
      const fromIndex = Number(action.fromIndex);
      const toIndex = Number(action.toIndex);
      const maxIndex = state.queue.length - 1;

      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex > maxIndex ||
        toIndex > maxIndex ||
        fromIndex === toIndex
      ) {
        return state;
      }

      const nextQueue = [...state.queue];
      const [movedItem] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, movedItem);

      let nextCurrentIndex = state.currentIndex;
      if (fromIndex === state.currentIndex) {
        nextCurrentIndex = toIndex;
      } else if (fromIndex < state.currentIndex && toIndex >= state.currentIndex) {
        nextCurrentIndex = state.currentIndex - 1;
      } else if (fromIndex > state.currentIndex && toIndex <= state.currentIndex) {
        nextCurrentIndex = state.currentIndex + 1;
      }

      return {
        ...state,
        queue: nextQueue,
        currentIndex: nextCurrentIndex,
      };
    }

    case "like_track": {
      if (!trackMap[action.trackId] || state.likedIds.includes(action.trackId)) {
        return state;
      }
      return enqueueToast(
        { ...state, likedIds: [action.trackId, ...state.likedIds] },
        "Трек добавлен в избранное"
      );
    }

    case "unlike_track": {
      if (!state.likedIds.includes(action.trackId)) {
        return state;
      }
      return enqueueToast(
        { ...state, likedIds: state.likedIds.filter((id) => id !== action.trackId) },
        "Трек удален из избранного"
      );
    }

    case "toggle_like_track": {
      if (!trackMap[action.trackId]) {
        return state;
      }
      const exists = state.likedIds.includes(action.trackId);
      const nextState = {
        ...state,
        likedIds: exists
          ? state.likedIds.filter((id) => id !== action.trackId)
          : [action.trackId, ...state.likedIds],
      };
      return enqueueToast(nextState, exists ? "Трек удален из избранного" : "Трек добавлен в избранное");
    }

    case "toggle_follow_artist": {
      if (!artistMap[action.artistId]) {
        return state;
      }

      const isFollowed = state.followedArtistIds.includes(action.artistId);
      const nextFollowedArtistIds = isFollowed
        ? state.followedArtistIds.filter((id) => id !== action.artistId)
        : [action.artistId, ...state.followedArtistIds];
      const artistName = artistMap[action.artistId]?.name ?? "исполнитель";
      const message = isFollowed
        ? `Вы отписались от ${artistName}`
        : `Вы подписались на ${artistName}`;

      return enqueueToast(
        {
          ...state,
          followedArtistIds: nextFollowedArtistIds,
        },
        message
      );
    }

    case "dismiss_toast": {
      return {
        ...state,
        toastItems: state.toastItems.filter((toast) => toast.id !== action.toastId),
      };
    }

    case "notify": {
      const message = String(action.message ?? "").trim();
      if (!message) {
        return state;
      }
      return enqueueToast(state, message);
    }

    case "clear_history": {
      return { ...state, historyIds: [] };
    }

    default:
      return state;
  }
}

function volumeToElement(volume) {
  return clamp(volume, 0, 100) / 100;
}

function resolveTrackSource(track) {
  const trackId = String(track?.id ?? "").trim();
  const remoteUrl = typeof track?.audioUrl === "string" ? track.audioUrl.trim() : "";
  const durationSec = Number(track?.durationSec ?? 0);
  return {
    key: `remote:${trackId}:${remoteUrl}:${durationSec}`,
    url: remoteUrl,
  };
}

export function PlayerProvider({ children }) {
  const { isAuthenticated, status: authStatus } = useAuth();
  const [state, dispatch] = useReducer(playerReducer, undefined, buildInitialState);
  const [remoteStateReady, setRemoteStateReady] = useState(false);

  const audioRef = useRef(null);
  const loadedTrackIdRef = useRef(null);
  const loadedSourceKeyRef = useRef("");
  const seekVersionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const data = await fetchCatalogMap();
        if (cancelled) return;

        const nextTracks = Array.isArray(data?.tracks) ? data.tracks : [];
        const nextArtists = Array.isArray(data?.artists) ? data.artists : [];
        runtimeTracks = nextTracks;
        runtimeArtists = nextArtists;
        trackMap = Object.fromEntries(nextTracks.map((track) => [track.id, track]));
        artistMap = Object.fromEntries(nextArtists.map((artist) => [artist.id, artist]));

        dispatch({
          type: "catalog_hydrated",
          fallbackQueueIds: nextTracks.slice(0, 7).map((track) => track.id),
        });
      } catch {
        dispatch({
          type: "notify",
          message: "Не удалось загрузить каталог. Проверь подключение к API.",
        });
      }
    };

    void loadCatalog();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateRemoteState = async () => {
      if (authStatus === "loading") {
        return;
      }

      if (!isAuthenticated) {
        setRemoteStateReady(false);
        return;
      }

      if (state.catalogVersion <= 0) {
        return;
      }

      setRemoteStateReady(false);

      try {
        const remoteState = await fetchPlayerState();
        if (cancelled) return;
        dispatch({
          type: "hydrate_remote_state",
          likedIds: remoteState?.likedTrackIds ?? [],
          followedArtistIds: remoteState?.followedArtistIds ?? [],
          historyIds: remoteState?.historyTrackIds ?? [],
        });
        setRemoteStateReady(true);
      } catch {
        if (cancelled) return;
        dispatch({
          type: "notify",
          message: "Не удалось синхронизировать музыкальные предпочтения с сервером.",
        });
      }
    };

    void hydrateRemoteState();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, authStatus, state.catalogVersion]);

  useEffect(() => {
    if (!isAuthenticated || !remoteStateReady) {
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      try {
        await updatePlayerState({
          likedTrackIds: state.likedIds,
          followedArtistIds: state.followedArtistIds,
          historyTrackIds: state.historyIds,
        });
      } catch {
        if (!cancelled) {
          dispatch({
            type: "notify",
            message: "Не удалось сохранить предпочтения на сервере.",
          });
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    isAuthenticated,
    remoteStateReady,
    state.likedIds,
    state.followedArtistIds,
    state.historyIds,
  ]);

  const ensureAudioElement = useCallback(() => {
    if (typeof window === "undefined") {
      return null;
    }

    if (!audioRef.current) {
      const audio = new window.Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }

    return audioRef.current;
  }, []);

  const replaceAudioSource = useCallback((track) => {
    const audio = ensureAudioElement();
    if (!audio || !track?.id) {
      return audio;
    }

    const sourceDescriptor = resolveTrackSource(track);
    if (
      loadedTrackIdRef.current === track.id &&
      loadedSourceKeyRef.current === sourceDescriptor.key
    ) {
      return audio;
    }

    audio.pause();
    loadedTrackIdRef.current = track.id;
    loadedSourceKeyRef.current = sourceDescriptor.key;
    if (!sourceDescriptor.url) {
      audio.removeAttribute("src");
      audio.load();
      return audio;
    }

    audio.src = sourceDescriptor.url;
    audio.load();

    return audio;
  }, [ensureAudioElement]);

  const currentTrackId = state.queue[state.currentIndex];
  const currentTrack = trackMap[currentTrackId] ?? null;
  const currentDuration = currentTrack?.durationSec ?? 0;
  const clampedProgress = clamp(state.progressSec, 0, currentDuration || state.progressSec);
  const progressPercent = currentDuration ? Math.round((clampedProgress / currentDuration) * 100) : 0;

  useEffect(() => {
    const audio = ensureAudioElement();
    if (!audio) return undefined;

    const handleTimeUpdate = () => {
      dispatch({ type: "sync_progress_sec", progressSec: audio.currentTime });
    };
    const handleEnded = () => {
      dispatch({ type: "track_finished" });
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [ensureAudioElement]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = volumeToElement(state.volume);
  }, [state.volume]);

  useEffect(() => {
    const audio = ensureAudioElement();
    if (!audio) {
      return;
    }

    if (!currentTrack || !currentTrackId) {
      audio.pause();
      loadedTrackIdRef.current = null;
      loadedSourceKeyRef.current = "";
      seekVersionRef.current = 0;
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    const sourceDescriptor = resolveTrackSource(currentTrack);
    if (
      loadedTrackIdRef.current !== currentTrackId ||
      loadedSourceKeyRef.current !== sourceDescriptor.key
    ) {
      replaceAudioSource(currentTrack);
    }

    const desiredTime = clamp(state.progressSec, 0, currentTrack.durationSec);
    if (
      loadedTrackIdRef.current === currentTrackId &&
      (seekVersionRef.current !== state.seekVersion || Math.abs(audio.currentTime - desiredTime) > 0.35)
    ) {
      try {
        audio.currentTime = desiredTime;
      } catch {
        // noop
      }
    }
    seekVersionRef.current = state.seekVersion;

    if (state.isPlaying) {
      if (audio.paused) {
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            // noop
          });
        }
      }
    } else {
      audio.pause();
    }
  }, [
    ensureAudioElement,
    replaceAudioSource,
    currentTrack,
    currentTrackId,
    state.isPlaying,
    state.seekVersion,
    state.progressSec,
  ]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audioRef.current = null;
      }
      loadedTrackIdRef.current = null;
      loadedSourceKeyRef.current = "";
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const payload = {
      queue: state.queue,
      currentIndex: state.currentIndex,
      volume: state.volume,
      likedIds: state.likedIds,
      followedArtistIds: state.followedArtistIds,
      historyIds: state.historyIds,
      shuffleEnabled: state.shuffleEnabled,
      repeatMode: state.repeatMode,
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // noop
    }
  }, [
    state.queue,
    state.currentIndex,
    state.volume,
    state.likedIds,
    state.followedArtistIds,
    state.historyIds,
    state.shuffleEnabled,
    state.repeatMode,
  ]);

  const value = useMemo(
    () => ({
      tracks: runtimeTracks,
      artists: runtimeArtists,
      trackMap,
      queue: state.queue,
      queueTracks: state.queue.map((id) => trackMap[id]).filter(Boolean),
      currentIndex: state.currentIndex,
      currentTrackId,
      currentTrack,
      isPlaying: state.isPlaying,
      shuffleEnabled: state.shuffleEnabled,
      repeatMode: state.repeatMode,
      volume: state.volume,
      progressSec: clampedProgress,
      progressPercent,
      progressLabel: formatDuration(clampedProgress),
      durationLabel: formatDuration(currentDuration),
      likedIds: state.likedIds,
      followedArtistIds: state.followedArtistIds,
      historyIds: state.historyIds,
      toastItems: state.toastItems,
      isCurrentTrackLiked: Boolean(currentTrackId && state.likedIds.includes(currentTrackId)),
      isArtistFollowed: (artistId) => state.followedArtistIds.includes(artistId),
      playTrack: (trackId) => dispatch({ type: "play_track", trackId }),
      playQueue: (trackIds, startIndex = 0) => dispatch({ type: "play_queue", trackIds, startIndex }),
      jumpToQueueIndex: (index) => dispatch({ type: "jump_to_index", index }),
      nextTrack: () => dispatch({ type: "next_track" }),
      prevTrack: () => dispatch({ type: "prev_track" }),
      togglePlay: () => dispatch({ type: "toggle_play" }),
      setProgressPercent: (percent) => dispatch({ type: "seek_percent", percent }),
      setVolume: (volume) => dispatch({ type: "set_volume", volume }),
      toggleShuffle: () => dispatch({ type: "toggle_shuffle" }),
      cycleRepeatMode: () => dispatch({ type: "cycle_repeat" }),
      removeQueueItem: (index) => dispatch({ type: "remove_from_queue", index }),
      moveQueueItem: (fromIndex, toIndex) => dispatch({ type: "move_queue_item", fromIndex, toIndex }),
      addTrackNext: (trackId) => dispatch({ type: "add_track_next", trackId }),
      addQueueNext: (trackIds, sourceLabel = "Плейлист") =>
        dispatch({ type: "add_queue_next", trackIds, sourceLabel }),
      clearQueue: () => dispatch({ type: "clear_queue" }),
      likeTrack: (trackId) => dispatch({ type: "like_track", trackId }),
      unlikeTrack: (trackId) => dispatch({ type: "unlike_track", trackId }),
      toggleLikeTrack: (trackId) => dispatch({ type: "toggle_like_track", trackId }),
      toggleArtistFollow: (artistId) => dispatch({ type: "toggle_follow_artist", artistId }),
      clearHistory: () => dispatch({ type: "clear_history" }),
      dismissToast: (toastId) => dispatch({ type: "dismiss_toast", toastId }),
      notify: (message) => dispatch({ type: "notify", message }),
    }),
    [state, currentTrackId, currentTrack, clampedProgress, progressPercent, currentDuration]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}


