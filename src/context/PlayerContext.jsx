import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  fetchCatalogMap,
  fetchPlayerState,
  fetchTrackPlayback,
  updatePlayerState,
} from "../api/musicApi.js";
import useAuth from "../hooks/useAuth.js";
import { formatDuration } from "../utils/formatters.js";
import PlayerContext from "./playerContext.js";
import { buildWaveQueuePlan } from "../../shared/waveRecommendations.js";

const repeatModes = ["off", "all", "one"];
const WAVE_QUEUE_SOURCE = "wave";
const WAVE_QUEUE_LIMIT = 18;
const REMOTE_STATE_PROGRESS_STEP_SEC = 15;
const REMOTE_STATE_SAVE_DELAY_IDLE_MS = 450;
const REMOTE_STATE_SAVE_DELAY_PLAYING_MS = 1_200;
const TRAILER_STOP_TOLERANCE_SEC = 0.08;
let runtimeTracks = [];
let runtimeArtists = [];
let trackMap = Object.create(null);
let artistMap = Object.create(null);
const STORAGE_KEY = "music.player.state.v1";
let hlsLoaderPromise = null;
const CUSTOM_EQUALIZER_PRESET_ID = "custom";
const EQUALIZER_GAIN_MIN = -12;
const EQUALIZER_GAIN_MAX = 12;
const EQUALIZER_PREAMP_MIN = -12;
const EQUALIZER_PREAMP_MAX = 12;
const EQUALIZER_BANDS = [
  { id: "60", label: "60", frequency: 60, filterType: "lowshelf", q: 0.8 },
  { id: "170", label: "170", frequency: 170, filterType: "peaking", q: 1 },
  { id: "310", label: "310", frequency: 310, filterType: "peaking", q: 1 },
  { id: "600", label: "600", frequency: 600, filterType: "peaking", q: 1 },
  { id: "1k", label: "1k", frequency: 1000, filterType: "peaking", q: 1 },
  { id: "3k", label: "3k", frequency: 3000, filterType: "peaking", q: 1 },
  { id: "6k", label: "6k", frequency: 6000, filterType: "peaking", q: 1 },
  { id: "12k", label: "12k", frequency: 12000, filterType: "peaking", q: 1 },
  { id: "14k", label: "14k", frequency: 14000, filterType: "peaking", q: 1 },
  { id: "16k", label: "16k", frequency: 16000, filterType: "highshelf", q: 0.8 },
];
const EQUALIZER_PRESETS = [
  { id: "flat", label: "По умолчанию", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "classical", label: "Классическая музыка", gains: [0, 0, 0, 0, 0, 0, -2, -2, -2, -3] },
  { id: "club", label: "Клубная музыка", gains: [5, 4, 3, 0, 0, -1, 2, 4, 5, 5] },
  { id: "dance", label: "Танцевальная музыка", gains: [5, 4, 2, 0, -1, -1, 1, 4, 5, 4] },
  { id: "bass", label: "Усиление НЧ", gains: [0, 5, 5, 3, 0, -2, -5, -7, -8, -8] },
  { id: "bass_treble", label: "Усиление НЧ и ВЧ", gains: [5, 4, 3, 1, 0, 0, 2, 4, 5, 5] },
  { id: "treble", label: "Усиление ВЧ", gains: [-4, -3, -2, -1, 0, 2, 4, 5, 6, 6] },
  { id: "laptop", label: "Колонки ноутбука", gains: [3, 4, 4, 2, 1, 0, 0, 1, 2, 3] },
  { id: "large_hall", label: "Большой зал", gains: [5, 4, 3, 2, 0, -1, 1, 3, 4, 5] },
  { id: "concert", label: "Концерт", gains: [4, 3, 2, 1, 0, 0, 1, 2, 3, 4] },
  { id: "party", label: "Вечеринка", gains: [5, 5, 4, 2, 0, 0, 2, 4, 5, 5] },
  { id: "pop", label: "Поп", gains: [-1, 2, 4, 5, 3, 0, -1, -2, -2, -2] },
  { id: "reggae", label: "Регги", gains: [0, 0, -1, -3, 0, 3, 4, 3, 2, 2] },
  { id: "rock", label: "Рок", gains: [4, 3, 2, -1, -2, 1, 3, 5, 6, 6] },
  { id: "ska", label: "Ска", gains: [-2, -1, 0, 2, 3, 3, 2, 1, 0, -1] },
  { id: "soft", label: "Мягкое звучание", gains: [-3, -2, -1, 1, 2, 2, 1, 0, -1, -2] },
  { id: "soft_rock", label: "Софт-рок", gains: [2, 2, 1, 0, -1, 1, 2, 3, 4, 4] },
];
const DEFAULT_EQUALIZER_PRESET = EQUALIZER_PRESETS[0];
const DEFAULT_EQUALIZER_STATE = {
  enabled: true,
  presetId: DEFAULT_EQUALIZER_PRESET.id,
  gains: DEFAULT_EQUALIZER_PRESET.gains,
  preampDb: 0,
};

const defaultState = {
  queue: [],
  queueSource: null,
  waveQueue: [],
  waveIndex: 0,
  currentIndex: 0,
  isPlaying: false,
  volume: 70,
  progressSec: 0,
  likedIds: [],
  followedArtistIds: [],
  historyIds: [],
  savedPlaylistIds: [],
  shuffleEnabled: false,
  repeatMode: "off",
  streamQualityAvailable: false,
  streamQualityCanControl: false,
  streamQualitySelected: "auto",
  streamQualityMode: "off",
  streamQualityLevel: "",
  seekVersion: 0,
  trailerSession: null,
  toastSeq: 0,
  toastItems: [],
  catalogVersion: 0,
  equalizer: DEFAULT_EQUALIZER_STATE,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeEqualizerGain(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return clamp(Math.round(numericValue), EQUALIZER_GAIN_MIN, EQUALIZER_GAIN_MAX);
}

function normalizeEqualizerPreampDb(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return clamp(Math.round(numericValue), EQUALIZER_PREAMP_MIN, EQUALIZER_PREAMP_MAX);
}

function normalizeEqualizerGains(gains = []) {
  return EQUALIZER_BANDS.map((_, index) => normalizeEqualizerGain(gains[index]));
}

function gainsMatch(firstGains = [], secondGains = []) {
  return EQUALIZER_BANDS.every((_, index) => normalizeEqualizerGain(firstGains[index]) === normalizeEqualizerGain(secondGains[index]));
}

function findEqualizerPreset(presetId) {
  return EQUALIZER_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

function findMatchingEqualizerPresetId(gains = []) {
  return EQUALIZER_PRESETS.find((preset) => gainsMatch(preset.gains, gains))?.id ?? CUSTOM_EQUALIZER_PRESET_ID;
}

function normalizeEqualizerState(raw) {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_EQUALIZER_STATE;
  }

  const gains = normalizeEqualizerGains(raw.gains);
  const matchedPresetId = findMatchingEqualizerPresetId(gains);
  const rawPresetId = String(raw.presetId ?? "").trim();
  const presetId =
    rawPresetId === CUSTOM_EQUALIZER_PRESET_ID || findEqualizerPreset(rawPresetId)
      ? rawPresetId
      : matchedPresetId;

  return {
    enabled: true,
    presetId,
    gains,
    preampDb: normalizeEqualizerPreampDb(raw.preampDb),
  };
}

function buildEqualizerBands(equalizer) {
  const normalizedState = normalizeEqualizerState(equalizer);
  return EQUALIZER_BANDS.map((band, index) => ({
    ...band,
    gain: normalizeEqualizerGain(normalizedState.gains[index]),
  }));
}

function hasActiveEqualizerGain(equalizer) {
  const normalizedEqualizer = normalizeEqualizerState(equalizer);
  return Boolean(
    normalizedEqualizer.enabled &&
      (normalizeEqualizerGains(normalizedEqualizer.gains).some((gain) => Math.abs(gain) > 0.05) ||
        Math.abs(normalizedEqualizer.preampDb) > 0.05)
  );
}

function createEqualizerFilter(audioContext, band) {
  const filter = audioContext.createBiquadFilter();
  filter.type = band.filterType;
  filter.frequency.value = band.frequency;
  filter.Q.value = band.q;
  filter.gain.value = 0;
  return filter;
}

function dbToLinearGain(dbValue) {
  return Math.pow(10, normalizeEqualizerPreampDb(dbValue) / 20);
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

function resolveTrailerSession(track, requestedDurationSec = 18) {
  const trackDuration = Math.max(0, Number(track?.durationSec ?? 0));
  const safeDuration = clamp(Number(requestedDurationSec) || 18, 15, 20);
  if (!trackDuration) {
    return {
      trackId: track?.id ?? "",
      startSec: 0,
      endSec: safeDuration,
    };
  }

  const trailerDuration = Math.min(safeDuration, trackDuration);
  if (trackDuration <= trailerDuration + 6) {
    return {
      trackId: track.id,
      startSec: 0,
      endSec: trailerDuration,
    };
  }

  const maxStartSec = Math.max(trackDuration - trailerDuration - 4, 0);
  const preferredStartSec = Math.max(Math.floor(trackDuration * 0.22), 12);
  const startSec = clamp(preferredStartSec, 0, maxStartSec);

  return {
    trackId: track.id,
    startSec,
    endSec: Math.min(trackDuration, startSec + trailerDuration),
  };
}

function shouldStopTrailerPlayback(trailerSession, trackId, currentTimeSec) {
  const activeTrackId = String(trackId ?? "").trim();
  const trailerTrackId = String(trailerSession?.trackId ?? "").trim();
  const trailerEndSec = Number(trailerSession?.endSec);
  if (!activeTrackId || !trailerTrackId || trailerTrackId !== activeTrackId) {
    return false;
  }
  if (!Number.isFinite(trailerEndSec)) {
    return false;
  }
  return Number(currentTimeSec) + TRAILER_STOP_TOLERANCE_SEC >= trailerEndSec;
}

function pickRandomIndex(currentIndex, length) {
  if (length <= 1) return currentIndex;
  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * length);
  }
  return nextIndex;
}

function getPlaybackQueue(state) {
  return state.queueSource === WAVE_QUEUE_SOURCE ? state.waveQueue : state.queue;
}

function getPlaybackIndex(state) {
  return state.queueSource === WAVE_QUEUE_SOURCE ? state.waveIndex : state.currentIndex;
}

function getPlaybackTrackId(state) {
  const queue = getPlaybackQueue(state);
  return queue[getPlaybackIndex(state)] ?? "";
}

function getNextIndex(state, { direction = 1, fromAuto = false, queue = getPlaybackQueue(state), currentIndex = getPlaybackIndex(state) } = {}) {
  const queueLength = queue.length;
  if (!queueLength) return null;

  if (direction < 0) {
    if (state.shuffleEnabled && queueLength > 1) {
      return pickRandomIndex(currentIndex, queueLength);
    }
    if (currentIndex > 0) {
      return currentIndex - 1;
    }
    if (state.repeatMode === "all") {
      return queueLength - 1;
    }
    return fromAuto ? null : 0;
  }

  if (state.shuffleEnabled && queueLength > 1) {
    return pickRandomIndex(currentIndex, queueLength);
  }
  if (currentIndex < queueLength - 1) {
    return currentIndex + 1;
  }
  if (state.repeatMode === "all") {
    return 0;
  }
  return fromAuto ? null : currentIndex;
}

function buildContinuousWaveQueue(state) {
  const tracks = Object.values(trackMap).filter((track) => track?.id);
  if (!tracks.length) {
    return null;
  }

  const plan = buildWaveQueuePlan(tracks, {
    likedTrackIds: state.likedIds,
    excludeTrackIds: [...state.waveQueue, ...state.queue, ...state.historyIds],
    limit: Math.min(WAVE_QUEUE_LIMIT, tracks.length),
  });

  return plan.trackIds.length ? plan : null;
}

function buildWavePosition(state, { direction = 1 } = {}) {
  const waveQueue = uniqueTrackIds(state.waveQueue);
  if (direction < 0) {
    if (!waveQueue.length) {
      return null;
    }
    const waveIndex = Math.max(0, Math.min(state.waveIndex - 1, waveQueue.length - 1));
    return {
      waveQueue,
      waveIndex,
      trackId: waveQueue[waveIndex],
    };
  }

  if (waveQueue.length && state.waveIndex < waveQueue.length - 1) {
    const waveIndex = state.waveIndex + 1;
    return {
      waveQueue,
      waveIndex,
      trackId: waveQueue[waveIndex],
    };
  }

  const nextWavePlan = buildContinuousWaveQueue({
    ...state,
    waveQueue,
  });
  if (!nextWavePlan?.trackIds?.length) {
    return null;
  }

  return {
    waveQueue: nextWavePlan.trackIds,
    waveIndex: nextWavePlan.startIndex,
    trackId: nextWavePlan.trackIds[nextWavePlan.startIndex],
  };
}

function buildWaveResumePosition(state) {
  const waveQueue = uniqueTrackIds(state.waveQueue);
  if (waveQueue.length) {
    const waveIndex = clamp(state.waveIndex, 0, waveQueue.length - 1);
    return {
      waveQueue,
      waveIndex,
      trackId: waveQueue[waveIndex],
    };
  }

  return buildWavePosition({
    ...state,
    waveQueue: [],
    waveIndex: 0,
  });
}

function buildUserQueueStartPosition(state) {
  const queue = uniqueTrackIds(state.queue);
  if (!queue.length) {
    return null;
  }

  return {
    queue,
    currentIndex: 0,
    trackId: queue[0],
  };
}

function normalizePersistedState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const hasQueue = Array.isArray(raw.queue);
  const hasWaveQueue = Array.isArray(raw.waveQueue);
  const hasLikedIds = Array.isArray(raw.likedIds);
  const hasFollowedArtistIds = Array.isArray(raw.followedArtistIds);
  const hasHistoryIds = Array.isArray(raw.historyIds);
  const hasSavedPlaylistIds = Array.isArray(raw.savedPlaylistIds);

  const rawQueue = hasQueue ? uniqueStringIds(raw.queue) : defaultState.queue;
  const migrateWaveQueue = raw.queueSource === WAVE_QUEUE_SOURCE && rawQueue.length && !hasWaveQueue;
  const queue = migrateWaveQueue ? defaultState.queue : rawQueue;
  const waveQueue = hasWaveQueue ? uniqueStringIds(raw.waveQueue) : migrateWaveQueue ? rawQueue : defaultState.waveQueue;
  const likedIds = hasLikedIds ? uniqueStringIds(raw.likedIds) : defaultState.likedIds;
  const followedArtistIds = hasFollowedArtistIds
    ? uniqueStringIds(raw.followedArtistIds)
    : defaultState.followedArtistIds;
  const historyIds = hasHistoryIds
    ? uniqueStringIds(raw.historyIds).slice(0, 24)
    : defaultState.historyIds;
  const savedPlaylistIds = hasSavedPlaylistIds
    ? uniqueStringIds(raw.savedPlaylistIds)
    : defaultState.savedPlaylistIds;

  return {
    queue,
    queueSource: raw.queueSource === WAVE_QUEUE_SOURCE && waveQueue.length ? WAVE_QUEUE_SOURCE : defaultState.queueSource,
    waveQueue,
    waveIndex: clamp(
      Number.isInteger(raw.waveIndex)
        ? raw.waveIndex
        : migrateWaveQueue && Number.isInteger(raw.currentIndex)
          ? raw.currentIndex
          : defaultState.waveIndex,
      0,
      Math.max(waveQueue.length - 1, 0)
    ),
    currentIndex: clamp(
      migrateWaveQueue
        ? defaultState.currentIndex
        : Number.isInteger(raw.currentIndex)
          ? raw.currentIndex
          : defaultState.currentIndex,
      0,
      Math.max(queue.length - 1, 0)
    ),
    volume: clamp(Number.isFinite(raw.volume) ? Number(raw.volume) : defaultState.volume, 0, 100),
    likedIds,
    followedArtistIds,
    historyIds,
    savedPlaylistIds,
    shuffleEnabled: Boolean(raw.shuffleEnabled),
    repeatMode: repeatModes.includes(raw.repeatMode) ? raw.repeatMode : defaultState.repeatMode,
    equalizer: normalizeEqualizerState(raw.equalizer),
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
      if (!trackMap[getPlaybackTrackId(state)]) {
        return state;
      }
      return {
        ...state,
        isPlaying: !state.isPlaying,
        trailerSession: state.isPlaying ? null : state.trailerSession,
      };
    }

    case "catalog_hydrated": {
      const currentQueue = uniqueTrackIds(state.queue);
      const currentWaveQueue = uniqueTrackIds(state.waveQueue);
      const fallbackQueueIds = uniqueTrackIds(action.fallbackQueueIds ?? []);
      const nextQueue = currentQueue.length
        ? currentQueue
        : state.queueSource === WAVE_QUEUE_SOURCE
          ? []
          : fallbackQueueIds;
      const nextCurrentIndex = clamp(state.currentIndex, 0, Math.max(nextQueue.length - 1, 0));
      const nextWaveIndex = clamp(state.waveIndex, 0, Math.max(currentWaveQueue.length - 1, 0));
      const hasPlaybackQueue =
        state.queueSource === WAVE_QUEUE_SOURCE ? currentWaveQueue.length > 0 : nextQueue.length > 0;

      return {
        ...state,
        queue: nextQueue,
        queueSource: state.queueSource === WAVE_QUEUE_SOURCE && currentWaveQueue.length ? WAVE_QUEUE_SOURCE : null,
        waveQueue: currentWaveQueue,
        waveIndex: nextWaveIndex,
        currentIndex: nextCurrentIndex,
        likedIds: uniqueTrackIds(state.likedIds),
        followedArtistIds: uniqueArtistIds(state.followedArtistIds),
        historyIds: uniqueTrackIds(state.historyIds).slice(0, 24),
        progressSec: hasPlaybackQueue ? state.progressSec : 0,
        catalogVersion: state.catalogVersion + 1,
      };
    }

    case "hydrate_remote_state": {
      const remoteQueue = uniqueTrackIds(action.queueTrackIds ?? []);
      const hasRemoteQueue = remoteQueue.length > 0;
      const nextQueue = hasRemoteQueue ? remoteQueue : state.queue;
      const nextCurrentIndex = hasRemoteQueue
        ? clamp(Number(action.queueCurrentIndex ?? 0), 0, Math.max(nextQueue.length - 1, 0))
        : state.currentIndex;
      const nextTrackId = nextQueue[nextCurrentIndex];
      const nextTrackDuration = Number(trackMap[nextTrackId]?.durationSec ?? 0);
      const rawRemoteProgress = Number(action.queueProgressSec ?? 0);
      const nextProgress = hasRemoteQueue
        ? clamp(
            Number.isFinite(rawRemoteProgress) ? rawRemoteProgress : 0,
            0,
            Math.max(nextTrackDuration, 0) || 60 * 60 * 24
          )
        : state.progressSec;

      return {
        ...state,
        queue: nextQueue,
        queueSource: null,
        waveQueue: [],
        waveIndex: 0,
        currentIndex: nextCurrentIndex,
        progressSec: nextProgress,
        isPlaying: false,
        trailerSession: null,
        seekVersion: hasRemoteQueue ? state.seekVersion + 1 : state.seekVersion,
        likedIds: uniqueTrackIds(action.likedIds ?? []),
        followedArtistIds: uniqueArtistIds(action.followedArtistIds ?? []),
        historyIds: uniqueTrackIds(action.historyIds ?? []).slice(0, 24),
        savedPlaylistIds: uniqueStringIds(action.savedPlaylistIds ?? []),
      };
    }

    case "play_trailer": {
      const track = trackMap[action.trackId];
      if (!track) {
        return state;
      }

      const existingIndex = state.queue.indexOf(action.trackId);
      const nextQueue = existingIndex >= 0 ? state.queue : [action.trackId, ...state.queue.filter(Boolean)];
      const nextIndex = existingIndex >= 0 ? existingIndex : 0;
      const trailerSession = resolveTrailerSession(track, action.durationSec);

      return {
        ...state,
        queue: nextQueue,
        queueSource: null,
        waveQueue: [],
        waveIndex: 0,
        currentIndex: nextIndex,
        isPlaying: true,
        progressSec: trailerSession.startSec,
        trailerSession,
        seekVersion: state.seekVersion + 1,
        historyIds: addHistory(state.historyIds, action.trackId),
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
        queueSource: null,
        waveQueue: [],
        waveIndex: 0,
        currentIndex: nextIndex,
        isPlaying: true,
        progressSec: 0,
        trailerSession: null,
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

      if (action.source === WAVE_QUEUE_SOURCE) {
        return {
          ...state,
          queue: [],
          queueSource: WAVE_QUEUE_SOURCE,
          waveQueue: nextQueue,
          waveIndex: startIndex,
          currentIndex: 0,
          isPlaying: true,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          historyIds: addHistory(state.historyIds, nextTrackId),
        };
      }

      return {
        ...state,
        queue: nextQueue,
        queueSource: null,
        waveQueue: [],
        waveIndex: 0,
        currentIndex: startIndex,
        isPlaying: true,
        progressSec: 0,
        trailerSession: null,
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
      const wavePosition = state.queueSource === WAVE_QUEUE_SOURCE ? buildWavePosition(state) : null;

      return {
        ...state,
        queueSource: null,
        waveQueue: wavePosition?.waveQueue ?? state.waveQueue,
        waveIndex: wavePosition?.waveIndex ?? state.waveIndex,
        currentIndex: index,
        progressSec: 0,
        trailerSession: null,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, trackId),
      };
    }

    case "next_track": {
      const currentTrackId = getPlaybackTrackId(state);
      if (!trackMap[currentTrackId]) {
        return state;
      }

      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const queuedPosition = buildUserQueueStartPosition(state);
        if (queuedPosition) {
          const wavePosition = buildWavePosition(state);
          return {
            ...state,
            queue: queuedPosition.queue,
            queueSource: null,
            waveQueue: wavePosition?.waveQueue ?? state.waveQueue,
            waveIndex: wavePosition?.waveIndex ?? state.waveIndex,
            currentIndex: queuedPosition.currentIndex,
            progressSec: 0,
            trailerSession: null,
            seekVersion: state.seekVersion + 1,
            isPlaying: true,
            historyIds: addHistory(state.historyIds, queuedPosition.trackId),
          };
        }

        const wavePosition = buildWavePosition(state);
        if (!wavePosition?.trackId) {
          return state;
        }

        return {
          ...state,
          queue: state.queue.slice(state.currentIndex + 1),
          queueSource: WAVE_QUEUE_SOURCE,
          waveQueue: wavePosition.waveQueue,
          waveIndex: wavePosition.waveIndex,
          currentIndex: 0,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, wavePosition.trackId),
        };
      }

      if (!state.queue.length) {
        const wavePosition = buildWaveResumePosition(state);
        if (!wavePosition?.trackId) {
          return state;
        }

        return {
          ...state,
          queueSource: WAVE_QUEUE_SOURCE,
          waveQueue: wavePosition.waveQueue,
          waveIndex: wavePosition.waveIndex,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, wavePosition.trackId),
        };
      }

      const nextIndex = state.waveQueue.length
        ? state.currentIndex < state.queue.length - 1
          ? state.currentIndex + 1
          : null
        : getNextIndex(state, { direction: 1, fromAuto: true, queue: state.queue, currentIndex: state.currentIndex });
      if (nextIndex === null) {
        const wavePosition = buildWaveResumePosition(state);
        if (!wavePosition?.trackId) {
          return state;
        }

        return {
          ...state,
          queue: state.queue.slice(state.currentIndex + 1),
          queueSource: WAVE_QUEUE_SOURCE,
          waveQueue: wavePosition.waveQueue,
          waveIndex: wavePosition.waveIndex,
          currentIndex: 0,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, wavePosition.trackId),
        };
      }

      const nextTrackId = state.queue[nextIndex];

      return {
        ...state,
        queueSource: null,
        currentIndex: nextIndex,
        progressSec: 0,
        trailerSession: null,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, nextTrackId),
      };
    }

    case "prev_track": {
      const currentTrackId = getPlaybackTrackId(state);
      if (!trackMap[currentTrackId]) {
        return state;
      }

      if (state.progressSec > 4) {
        return {
          ...state,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
        };
      }

      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const wavePosition = buildWavePosition(state, { direction: -1 });
        if (!wavePosition?.trackId) {
          return state;
        }

        return {
          ...state,
          queueSource: WAVE_QUEUE_SOURCE,
          waveQueue: wavePosition.waveQueue,
          waveIndex: wavePosition.waveIndex,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, wavePosition.trackId),
        };
      }

      const prevIndex = getNextIndex(state, { direction: -1, fromAuto: false, queue: state.queue, currentIndex: state.currentIndex });
      const prevTrackId = state.queue[prevIndex];

      return {
        ...state,
        queueSource: null,
        currentIndex: prevIndex,
        progressSec: 0,
        trailerSession: null,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, prevTrackId),
      };
    }

    case "track_finished": {
      const currentTrackId = getPlaybackTrackId(state);
      const currentTrack = trackMap[currentTrackId];
      if (!currentTrack) {
        return {
          ...state,
          queueSource: null,
          isPlaying: false,
          progressSec: 0,
          trailerSession: null,
        };
      }

      if (state.repeatMode === "one" && state.queueSource !== WAVE_QUEUE_SOURCE && !state.waveQueue.length) {
        return {
          ...state,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, currentTrackId),
        };
      }

      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const queuedPosition = buildUserQueueStartPosition(state);
        if (queuedPosition) {
          const wavePosition = buildWavePosition(state);
          return {
            ...state,
            queue: queuedPosition.queue,
            queueSource: null,
            waveQueue: wavePosition?.waveQueue ?? state.waveQueue,
            waveIndex: wavePosition?.waveIndex ?? state.waveIndex,
            currentIndex: queuedPosition.currentIndex,
            progressSec: 0,
            trailerSession: null,
            seekVersion: state.seekVersion + 1,
            isPlaying: true,
            historyIds: addHistory(state.historyIds, queuedPosition.trackId),
          };
        }

        const wavePosition = buildWavePosition(state);
        if (wavePosition?.trackId) {
          return {
            ...state,
            queue: state.queue.slice(state.currentIndex + 1),
            queueSource: WAVE_QUEUE_SOURCE,
            waveQueue: wavePosition.waveQueue,
            waveIndex: wavePosition.waveIndex,
            currentIndex: 0,
            progressSec: 0,
            trailerSession: null,
            seekVersion: state.seekVersion + 1,
            isPlaying: true,
            historyIds: addHistory(state.historyIds, wavePosition.trackId),
          };
        }

        return {
          ...state,
          queueSource: null,
          waveQueue: [],
          waveIndex: 0,
          isPlaying: false,
          progressSec: currentTrack.durationSec,
          trailerSession: null,
        };
      }

      const nextIndex = state.waveQueue.length
        ? state.currentIndex < state.queue.length - 1
          ? state.currentIndex + 1
          : null
        : getNextIndex(state, { direction: 1, fromAuto: true, queue: state.queue, currentIndex: state.currentIndex });
      if (nextIndex === null) {
        const wavePosition = buildWaveResumePosition(state);
        if (wavePosition?.trackId) {
          return {
            ...state,
            queue: state.queue.slice(state.currentIndex + 1),
            queueSource: WAVE_QUEUE_SOURCE,
            waveQueue: wavePosition.waveQueue,
            waveIndex: wavePosition.waveIndex,
            currentIndex: 0,
            progressSec: 0,
            trailerSession: null,
            seekVersion: state.seekVersion + 1,
            isPlaying: true,
            historyIds: addHistory(state.historyIds, wavePosition.trackId),
          };
        }

        return {
          ...state,
          queueSource: null,
          isPlaying: false,
          progressSec: currentTrack.durationSec,
          trailerSession: null,
        };
      }

      const nextTrackId = state.queue[nextIndex];
      return {
        ...state,
        queueSource: null,
        currentIndex: nextIndex,
        progressSec: 0,
        trailerSession: null,
        seekVersion: state.seekVersion + 1,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, nextTrackId),
      };
    }

    case "seek_percent": {
      const trackId = getPlaybackTrackId(state);
      const track = trackMap[trackId];
      if (!track) {
        return state;
      }
      const progressSec = (clamp(action.percent, 0, 100) / 100) * track.durationSec;
      return {
        ...state,
        progressSec,
        trailerSession: null,
        seekVersion: state.seekVersion + 1,
      };
    }

    case "sync_progress_sec": {
      const trackId = getPlaybackTrackId(state);
      const track = trackMap[trackId];
      if (!track) return state;
      if (action.trackId && action.trackId !== trackId) {
        return state;
      }

      const nextValue = clamp(action.progressSec, 0, track.durationSec);
      if (shouldStopTrailerPlayback(state.trailerSession, trackId, nextValue)) {
        return {
          ...state,
          isPlaying: false,
          progressSec: Number(state.trailerSession.endSec),
          trailerSession: null,
        };
      }

      if (Math.abs(nextValue - state.progressSec) < 0.02) {
        return state;
      }

      return {
        ...state,
        progressSec: nextValue,
      };
    }

    case "finish_trailer": {
      const trackId = getPlaybackTrackId(state);
      if (!shouldStopTrailerPlayback(state.trailerSession, trackId, action.endSec)) {
        return state;
      }

      return {
        ...state,
        isPlaying: false,
        progressSec: Number(state.trailerSession.endSec),
        trailerSession: null,
      };
    }

    case "set_volume": {
      return { ...state, volume: clamp(action.volume, 0, 100) };
    }

    case "set_equalizer_preset": {
      if (action.presetId === CUSTOM_EQUALIZER_PRESET_ID) {
        const currentEqualizer = normalizeEqualizerState(state.equalizer);
        return {
          ...state,
          equalizer: {
            enabled: true,
            presetId: CUSTOM_EQUALIZER_PRESET_ID,
            gains: currentEqualizer.gains,
            preampDb: currentEqualizer.preampDb,
          },
        };
      }

      const preset = findEqualizerPreset(action.presetId);
      if (!preset) {
        return state;
      }
      return {
        ...state,
        equalizer: {
          enabled: true,
          presetId: preset.id,
          gains: normalizeEqualizerGains(preset.gains),
          preampDb: normalizeEqualizerPreampDb(preset.preampDb),
        },
      };
    }

    case "set_equalizer_band": {
      const bandIndex = Number(action.bandIndex);
      if (!Number.isInteger(bandIndex) || bandIndex < 0 || bandIndex >= EQUALIZER_BANDS.length) {
        return state;
      }

      const currentEqualizer = normalizeEqualizerState(state.equalizer);
      const nextGains = currentEqualizer.gains.map((gain, index) =>
        index === bandIndex ? normalizeEqualizerGain(action.gain) : gain
      );

      return {
        ...state,
        equalizer: {
          enabled: true,
          presetId:
            currentEqualizer.preampDb === 0
              ? findMatchingEqualizerPresetId(nextGains)
              : CUSTOM_EQUALIZER_PRESET_ID,
          gains: nextGains,
          preampDb: currentEqualizer.preampDb,
        },
      };
    }

    case "set_equalizer_preamp": {
      const currentEqualizer = normalizeEqualizerState(state.equalizer);
      const nextPreampDb = normalizeEqualizerPreampDb(action.preampDb);

      return {
        ...state,
        equalizer: {
          enabled: true,
          presetId: nextPreampDb === 0 ? findMatchingEqualizerPresetId(currentEqualizer.gains) : CUSTOM_EQUALIZER_PRESET_ID,
          gains: currentEqualizer.gains,
          preampDb: nextPreampDb,
        },
      };
    }

    case "reset_equalizer": {
      return {
        ...state,
        equalizer: {
          ...DEFAULT_EQUALIZER_STATE,
          gains: [...DEFAULT_EQUALIZER_STATE.gains],
        },
      };
    }

    case "toggle_shuffle": {
      return { ...state, shuffleEnabled: !state.shuffleEnabled };
    }

    case "cycle_repeat": {
      const currentModeIndex = repeatModes.indexOf(state.repeatMode);
      const nextMode = repeatModes[(currentModeIndex + 1) % repeatModes.length];
      return { ...state, repeatMode: nextMode };
    }

    case "sync_stream_quality": {
      const available =
        typeof action.available === "boolean" ? action.available : state.streamQualityAvailable;
      const canControl =
        typeof action.canControl === "boolean"
          ? action.canControl
          : state.streamQualityCanControl;
      const selected = normalizeStreamQualitySelection(
        action.selected ?? state.streamQualitySelected
      );
      const mode = String(action.mode ?? state.streamQualityMode ?? "off");
      const level = String(action.level ?? state.streamQualityLevel ?? "");
      if (
        state.streamQualityAvailable === available &&
        state.streamQualityCanControl === canControl &&
        state.streamQualitySelected === selected &&
        state.streamQualityMode === mode &&
        state.streamQualityLevel === level
      ) {
        return state;
      }
      return {
        ...state,
        streamQualityAvailable: available,
        streamQualityCanControl: canControl,
        streamQualitySelected: selected,
        streamQualityMode: mode,
        streamQualityLevel: level,
      };
    }

    case "remove_from_queue": {
      const index = Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) {
        return state;
      }

      const nextQueue = state.queue.filter((_, itemIndex) => itemIndex !== index);
      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        return {
          ...state,
          queue: nextQueue,
          currentIndex: clamp(state.currentIndex, 0, Math.max(nextQueue.length - 1, 0)),
        };
      }

      if (!nextQueue.length) {
        const wavePosition = buildWaveResumePosition(state);
        if (wavePosition?.trackId) {
          return {
            ...state,
            queue: [],
            queueSource: WAVE_QUEUE_SOURCE,
            waveQueue: wavePosition.waveQueue,
            waveIndex: wavePosition.waveIndex,
            currentIndex: 0,
            progressSec: 0,
            trailerSession: null,
            seekVersion: state.seekVersion + 1,
            isPlaying: true,
            historyIds: addHistory(state.historyIds, wavePosition.trackId),
          };
        }

        return {
          ...state,
          queue: [],
          queueSource: null,
          currentIndex: 0,
          isPlaying: false,
          progressSec: 0,
          trailerSession: null,
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
        queueSource: null,
        currentIndex: nextIndex,
        progressSec: nextProgress,
        trailerSession: index === state.currentIndex ? null : state.trailerSession,
        seekVersion: state.seekVersion + (index === state.currentIndex ? 1 : 0),
        historyIds: nextHistory,
      };
    }

    case "clear_queue": {
      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const nextState = {
          ...state,
          queue: [],
          currentIndex: 0,
        };
        return state.queue.length ? enqueueToast(nextState, "Очередь очищена") : nextState;
      }

      const wavePosition = buildWaveResumePosition(state);
      if (wavePosition?.trackId) {
        const nextState = {
          ...state,
          queue: [],
          queueSource: WAVE_QUEUE_SOURCE,
          waveQueue: wavePosition.waveQueue,
          waveIndex: wavePosition.waveIndex,
          currentIndex: 0,
          progressSec: 0,
          trailerSession: null,
          seekVersion: state.seekVersion + 1,
          isPlaying: true,
          historyIds: addHistory(state.historyIds, wavePosition.trackId),
        };
        return state.queue.length ? enqueueToast(nextState, "Очередь очищена") : nextState;
      }

      const nextState = {
        ...state,
        queue: [],
        queueSource: null,
        currentIndex: 0,
        isPlaying: false,
        progressSec: 0,
        trailerSession: null,
        seekVersion: state.seekVersion + 1,
      };
      return state.queue.length ? enqueueToast(nextState, "Очередь очищена") : nextState;
    }

    case "add_track_next": {
      if (!trackMap[action.trackId]) {
        return state;
      }

      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const currentTrackId = getPlaybackTrackId(state);
        if (currentTrackId === action.trackId) {
          return enqueueToast(state, "Этот трек уже играет");
        }

        const nextQueueBase = state.queue.filter((trackId) => trackId !== action.trackId);
        return enqueueToast(
          {
            ...state,
            queue: [action.trackId, ...nextQueueBase],
            currentIndex: 0,
          },
          "Добавлено далее в очередь"
        );
      }

      if (!state.queue.length) {
        return enqueueToast(
          {
            ...state,
            queue: [action.trackId],
            queueSource: null,
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

    case "add_track_last": {
      if (!trackMap[action.trackId]) {
        return state;
      }

      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const currentTrackId = getPlaybackTrackId(state);
        if (currentTrackId === action.trackId) {
          return enqueueToast(state, "Этот трек уже играет");
        }

        const nextQueueBase = state.queue.filter((trackId) => trackId !== action.trackId);
        return enqueueToast(
          {
            ...state,
            queue: [...nextQueueBase, action.trackId],
            currentIndex: 0,
          },
          "Добавлено в конец очереди"
        );
      }

      if (!state.queue.length) {
        return enqueueToast(
          {
            ...state,
            queue: [action.trackId],
            queueSource: null,
            currentIndex: 0,
          },
          "РўСЂРµРє РґРѕР±Р°РІР»РµРЅ РІ РѕС‡РµСЂРµРґСЊ"
        );
      }

      const currentTrackId = state.queue[state.currentIndex];
      if (!currentTrackId) {
        return state;
      }

      if (currentTrackId === action.trackId) {
        return enqueueToast(state, "Р­С‚РѕС‚ С‚СЂРµРє СѓР¶Рµ РёРіСЂР°РµС‚");
      }

      const nextQueueBase = state.queue.filter((trackId) => trackId !== action.trackId);
      const nextQueue = [...nextQueueBase, action.trackId];
      const nextCurrentIndex = Math.max(nextQueue.indexOf(currentTrackId), 0);

      return enqueueToast(
        {
          ...state,
          queue: nextQueue,
          currentIndex: nextCurrentIndex,
        },
        "Р”РѕР±Р°РІР»РµРЅРѕ РІ РєРѕРЅРµС† РѕС‡РµСЂРµРґРё"
      );
    }

    case "add_queue_next": {
      const nextTrackIds = uniqueTrackIds(action.trackIds);
      if (!nextTrackIds.length) {
        return state;
      }

      const sourceLabel = action.sourceLabel ?? "Плейлист";
      if (state.queueSource === WAVE_QUEUE_SOURCE) {
        const currentTrackId = getPlaybackTrackId(state);
        const insertTrackIds = nextTrackIds.filter((trackId) => trackId !== currentTrackId);
        if (!insertTrackIds.length) {
          return enqueueToast(state, `${sourceLabel} уже в очереди`);
        }

        const queueWithoutNewTracks = state.queue.filter((trackId) => !insertTrackIds.includes(trackId));
        return enqueueToast(
          {
            ...state,
            queue: [...insertTrackIds, ...queueWithoutNewTracks],
            currentIndex: 0,
          },
          `${sourceLabel} добавлен далее в очередь`
        );
      }

      if (!state.queue.length) {
        return enqueueToast(
          {
            ...state,
            queue: nextTrackIds,
            queueSource: null,
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

    case "toggle_save_playlist": {
      const playlistId = String(action.playlistId ?? "").trim();
      if (!playlistId) {
        return state;
      }

      const isSaved = state.savedPlaylistIds.includes(playlistId);
      const nextSavedPlaylistIds = isSaved
        ? state.savedPlaylistIds.filter((id) => id !== playlistId)
        : [playlistId, ...state.savedPlaylistIds];

      return enqueueToast(
        {
          ...state,
          savedPlaylistIds: nextSavedPlaylistIds,
        },
        isSaved ? "Плейлист убран из моей музыки" : "Плейлист сохранен в моей музыке"
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

function resolveTrackSource(track, playbackDescriptor = null) {
  const trackId = String(track?.id ?? "").trim();
  const descriptorUrl = typeof playbackDescriptor?.streamUrl === "string"
    ? playbackDescriptor.streamUrl.trim()
    : "";
  const descriptorHlsUrl = typeof playbackDescriptor?.hlsUrl === "string"
    ? playbackDescriptor.hlsUrl.trim()
    : "";
  const trackHlsUrl = typeof track?.hlsUrl === "string" ? track.hlsUrl.trim() : "";
  const remoteUrl = descriptorUrl || (typeof track?.audioUrl === "string" ? track.audioUrl.trim() : "");
  const hlsUrl = descriptorHlsUrl || trackHlsUrl;
  const durationSec = Number(track?.durationSec ?? 0);
  return {
    key: `remote:${trackId}:${remoteUrl}:${hlsUrl}:${durationSec}`,
    hlsUrl,
    url: remoteUrl,
  };
}

function shouldRefreshPlayback(track) {
  if (!track?.id) {
    return false;
  }
  if (track.isLocalAudio) {
    return true;
  }
  const rawAudioUrl = String(track.rawAudioUrl ?? "").trim();
  if (rawAudioUrl.startsWith("/api/media/")) {
    return true;
  }
  const playbackUrl = String(track.audioUrl ?? "").trim();
  return playbackUrl.startsWith("/api/stream/");
}

function loadHlsLibrary() {
  if (!hlsLoaderPromise) {
    hlsLoaderPromise = import("hls.js").then((module) => module.default ?? module);
  }
  return hlsLoaderPromise;
}

function normalizeQualityLevelName(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "";
}

function qualityLevelFromBitrate(level) {
  const bitrate = Number(level?.bitrate ?? level?.attrs?.BANDWIDTH ?? 0);
  if (!Number.isFinite(bitrate) || bitrate <= 0) {
    return "";
  }
  if (bitrate >= 180_000) {
    return "high";
  }
  if (bitrate >= 110_000) {
    return "medium";
  }
  return "low";
}

function resolveQualityLevelFromHls(hls, levelIndex) {
  if (!Array.isArray(hls?.levels)) {
    return "";
  }
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= hls.levels.length) {
    return "";
  }
  const level = hls.levels[levelIndex];
  const namedLevel = normalizeQualityLevelName(level?.name ?? level?.attrs?.NAME);
  if (namedLevel) {
    return namedLevel;
  }
  return qualityLevelFromBitrate(level);
}

function normalizeStreamQualitySelection(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "auto";
}

function resolveActiveLevelIndex(hls, explicitLevelIndex = null) {
  if (Number.isInteger(explicitLevelIndex) && explicitLevelIndex >= 0) {
    return explicitLevelIndex;
  }
  if (Number.isInteger(hls?.currentLevel) && hls.currentLevel >= 0) {
    return hls.currentLevel;
  }
  if (Number.isInteger(hls?.nextLevel) && hls.nextLevel >= 0) {
    return hls.nextLevel;
  }
  if (Number.isInteger(hls?.loadLevel) && hls.loadLevel >= 0) {
    return hls.loadLevel;
  }
  return -1;
}

function findHlsLevelIndexBySelection(hls, selection) {
  const normalizedSelection = normalizeStreamQualitySelection(selection);
  const levels = Array.isArray(hls?.levels) ? hls.levels : [];
  if (!levels.length || normalizedSelection === "auto") {
    return -1;
  }

  const exactIndex = levels.findIndex(
    (level) =>
      normalizeQualityLevelName(level?.name ?? level?.attrs?.NAME) === normalizedSelection
  );
  if (exactIndex >= 0) {
    return exactIndex;
  }

  const levelsWithBitrate = levels
    .map((level, index) => ({
      index,
      bitrate: Number(level?.bitrate ?? level?.attrs?.BANDWIDTH ?? 0),
    }))
    .filter((item) => Number.isFinite(item.bitrate) && item.bitrate > 0)
    .sort((first, second) => first.bitrate - second.bitrate);

  if (!levelsWithBitrate.length) {
    return -1;
  }

  if (normalizedSelection === "low") {
    return levelsWithBitrate[0].index;
  }
  if (normalizedSelection === "high") {
    return levelsWithBitrate[levelsWithBitrate.length - 1].index;
  }

  const mediumTargetBitrate = 128_000;
  const closestMedium = levelsWithBitrate.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }
    const bestDistance = Math.abs(best.bitrate - mediumTargetBitrate);
    const candidateDistance = Math.abs(candidate.bitrate - mediumTargetBitrate);
    return candidateDistance < bestDistance ? candidate : best;
  }, null);
  return closestMedium ? closestMedium.index : -1;
}

function applySelectionToHls(hls, selection) {
  const normalizedSelection = normalizeStreamQualitySelection(selection);
  if (!hls) {
    return;
  }
  if (normalizedSelection === "auto") {
    hls.currentLevel = -1;
    return;
  }
  const selectedLevelIndex = findHlsLevelIndexBySelection(hls, normalizedSelection);
  if (selectedLevelIndex >= 0) {
    hls.currentLevel = selectedLevelIndex;
  }
}

export function PlayerProvider({ children }) {
  const { isAuthenticated, status: authStatus } = useAuth();
  const [state, dispatch] = useReducer(playerReducer, undefined, buildInitialState);
  const [remoteStateReady, setRemoteStateReady] = useState(false);

  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const syncHlsQualityRef = useRef(null);
  const streamQualitySelectionRef = useRef(defaultState.streamQualitySelected);
  const playbackCacheRef = useRef(new Map());
  const loadedTrackIdRef = useRef(null);
  const loadedSourceKeyRef = useRef("");
  const seekVersionRef = useRef(0);
  const playbackIntentRef = useRef(defaultState.isPlaying);
  const trailerSessionRef = useRef(defaultState.trailerSession);
  const audioContextRef = useRef(null);
  const audioSourceNodeRef = useRef(null);
  const equalizerFiltersRef = useRef([]);
  const equalizerPreampGainRef = useRef(null);
  const equalizerGraphReadyRef = useRef(false);

  const updateStreamQuality = useCallback((nextState) => {
    dispatch({
      type: "sync_stream_quality",
      ...(nextState ?? {}),
    });
  }, []);

  const disposeHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    syncHlsQualityRef.current = null;
  }, []);

  const disposeAudioGraph = useCallback(() => {
    for (const filter of equalizerFiltersRef.current) {
      try {
        filter.disconnect();
      } catch {
        // noop
      }
    }
    equalizerFiltersRef.current = [];
    equalizerGraphReadyRef.current = false;

    if (equalizerPreampGainRef.current) {
      try {
        equalizerPreampGainRef.current.disconnect();
      } catch {
        // noop
      }
      equalizerPreampGainRef.current = null;
    }

    if (audioSourceNodeRef.current) {
      try {
        audioSourceNodeRef.current.disconnect();
      } catch {
        // noop
      }
      audioSourceNodeRef.current = null;
    }

    if (audioContextRef.current) {
      const audioContext = audioContextRef.current;
      audioContextRef.current = null;
      if (audioContext.state !== "closed" && typeof audioContext.close === "function") {
        const closePromise = audioContext.close();
        if (closePromise && typeof closePromise.catch === "function") {
          closePromise.catch(() => {
            // noop
          });
        }
      }
    }
  }, []);

  const setStreamQualitySelection = useCallback(
    (selection) => {
      const normalizedSelection = normalizeStreamQualitySelection(selection);
      streamQualitySelectionRef.current = normalizedSelection;
      const hls = hlsRef.current;
      if (hls) {
        applySelectionToHls(hls, normalizedSelection);
        if (typeof syncHlsQualityRef.current === "function") {
          syncHlsQualityRef.current();
        }
      } else {
        updateStreamQuality({
          selected: normalizedSelection,
        });
      }
    },
    [updateStreamQuality]
  );

  useEffect(() => {
    streamQualitySelectionRef.current = normalizeStreamQualitySelection(state.streamQualitySelected);
  }, [state.streamQualitySelected]);

  useEffect(() => {
    playbackIntentRef.current = state.isPlaying;
  }, [state.isPlaying]);

  useEffect(() => {
    trailerSessionRef.current = state.trailerSession;
  }, [state.trailerSession]);

  const applyCatalogPayload = useCallback((data) => {
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
  }, []);

  const refreshCatalog = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const data = await fetchCatalogMap();
        applyCatalogPayload(data);
      } catch (error) {
        if (!silent) {
          dispatch({
            type: "notify",
            message: "Failed to load catalog. Check API connectivity.",
          });
        }
        throw error;
      }
    },
    [applyCatalogPayload]
  );

  useEffect(() => {
    let cancelled = false;

    const loadCatalog = async () => {
      try {
        const data = await fetchCatalogMap();
        if (cancelled) return;
        applyCatalogPayload(data);
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
  }, [applyCatalogPayload]);

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
          savedPlaylistIds: remoteState?.savedPlaylistIds ?? [],
          queueTrackIds: remoteState?.queueTrackIds ?? [],
          queueCurrentIndex: remoteState?.queueCurrentIndex ?? 0,
          queueProgressSec: remoteState?.queueProgressSec ?? 0,
          queueIsPlaying: remoteState?.queueIsPlaying ?? false,
        });
        setRemoteStateReady(true);
      } catch {
        if (cancelled) return;
        setRemoteStateReady(true);
        dispatch({
          type: "notify",
          message: "Не удалось загрузить предпочтения с сервера. Используем локальное состояние.",
        });
      }
    };

    void hydrateRemoteState();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, authStatus, state.catalogVersion]);

  const remoteStateSyncProgressKey = state.isPlaying
    ? Math.floor(state.progressSec / REMOTE_STATE_PROGRESS_STEP_SEC)
    : Math.floor(state.progressSec);
  const normalizedRemoteProgressSec = Math.max(0, Math.floor(state.progressSec));
  const persistedRemoteProgressSec = state.isPlaying
    ? Math.floor(normalizedRemoteProgressSec / REMOTE_STATE_PROGRESS_STEP_SEC) * REMOTE_STATE_PROGRESS_STEP_SEC
    : normalizedRemoteProgressSec;
  const remoteStateSyncDelayMs = state.isPlaying
    ? REMOTE_STATE_SAVE_DELAY_PLAYING_MS
    : REMOTE_STATE_SAVE_DELAY_IDLE_MS;

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
          savedPlaylistIds: state.savedPlaylistIds,
          queueTrackIds: state.queue,
          queueCurrentIndex: state.currentIndex,
          queueProgressSec: persistedRemoteProgressSec,
          queueIsPlaying: state.isPlaying,
        });
      } catch {
        if (!cancelled) {
          dispatch({
            type: "notify",
            message: "Не удалось сохранить предпочтения на сервере.",
          });
        }
      }
    }, remoteStateSyncDelayMs);

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
    state.savedPlaylistIds,
    state.queue,
    state.currentIndex,
    remoteStateSyncProgressKey,
    persistedRemoteProgressSec,
    remoteStateSyncDelayMs,
    state.isPlaying,
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

  const ensureAudioGraph = useCallback((audio) => {
    if (!audio || typeof window === "undefined") {
      return null;
    }
    if (equalizerGraphReadyRef.current && audioContextRef.current) {
      return audioContextRef.current;
    }

    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      return null;
    }

    try {
      const audioContext = audioContextRef.current ?? new AudioContextConstructor();
      audioContextRef.current = audioContext;
      if (!audioSourceNodeRef.current) {
        audioSourceNodeRef.current = audioContext.createMediaElementSource(audio);
      }

      const filters = EQUALIZER_BANDS.map((band) => createEqualizerFilter(audioContext, band));
      const preampGain = audioContext.createGain();
      preampGain.gain.value = 1;
      audioSourceNodeRef.current.connect(filters[0]);
      filters.forEach((filter, index) => {
        const nextFilter = filters[index + 1];
        if (nextFilter) {
          filter.connect(nextFilter);
          return;
        }
        filter.connect(preampGain);
      });
      preampGain.connect(audioContext.destination);

      equalizerFiltersRef.current = filters;
      equalizerPreampGainRef.current = preampGain;
      equalizerGraphReadyRef.current = true;
      return audioContext;
    } catch {
      return null;
    }
  }, []);

  const applyEqualizerToGraph = useCallback(
    (equalizer) => {
      if (!hasActiveEqualizerGain(equalizer) && !equalizerGraphReadyRef.current) {
        return;
      }

      const audio = ensureAudioElement();
      const audioContext = ensureAudioGraph(audio);
      if (!audioContext || !equalizerFiltersRef.current.length) {
        return;
      }

      const normalizedEqualizer = normalizeEqualizerState(equalizer);
      const now = audioContext.currentTime;
      equalizerFiltersRef.current.forEach((filter, index) => {
        const nextGain = normalizedEqualizer.enabled
          ? normalizeEqualizerGain(normalizedEqualizer.gains[index])
          : 0;
        filter.gain.cancelScheduledValues(now);
        filter.gain.setTargetAtTime(nextGain, now, 0.015);
      });
      if (equalizerPreampGainRef.current) {
        const nextLinearGain = normalizedEqualizer.enabled ? dbToLinearGain(normalizedEqualizer.preampDb) : 1;
        equalizerPreampGainRef.current.gain.cancelScheduledValues(now);
        equalizerPreampGainRef.current.gain.setTargetAtTime(nextLinearGain, now, 0.015);
      }
    },
    [ensureAudioElement, ensureAudioGraph]
  );

  const resumeAudioGraph = useCallback(() => {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state !== "suspended") {
      return;
    }

    const resumePromise = audioContext.resume();
    if (resumePromise && typeof resumePromise.catch === "function") {
      resumePromise.catch(() => {
        // noop
      });
    }
  }, []);

  const attemptAudioPlayback = useCallback((audio) => {
    if (!audio || !playbackIntentRef.current) {
      return;
    }

    resumeAudioGraph();
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // noop
      });
    }
  }, [resumeAudioGraph]);

  const replaceAudioSource = useCallback((track) => {
    const audio = ensureAudioElement();
    if (!audio || !track?.id) {
      return audio;
    }

    const sourceDescriptor = resolveTrackSource(
      track,
      playbackCacheRef.current.get(track.id) ?? null
    );
    if (
      loadedTrackIdRef.current === track.id &&
      loadedSourceKeyRef.current === sourceDescriptor.key
    ) {
      return audio;
    }

    audio.pause();
    disposeHls();
    audio.removeAttribute("src");
    audio.load();
    updateStreamQuality({
      available: Boolean(sourceDescriptor.hlsUrl),
      canControl: false,
      selected: streamQualitySelectionRef.current,
      mode:
        sourceDescriptor.hlsUrl && streamQualitySelectionRef.current !== "auto"
          ? "manual"
          : sourceDescriptor.hlsUrl
            ? "auto"
            : "off",
      level: "",
    });
    loadedTrackIdRef.current = track.id;
    loadedSourceKeyRef.current = sourceDescriptor.key;
    if (!sourceDescriptor.url && !sourceDescriptor.hlsUrl) {
      updateStreamQuality({
        available: false,
        canControl: false,
        mode: "off",
        level: "",
      });
      audio.removeAttribute("src");
      audio.load();
      return audio;
    }

    if (sourceDescriptor.hlsUrl) {
      const canUseNativeHls = audio.canPlayType("application/vnd.apple.mpegurl") !== "";

      loadHlsLibrary()
        .then((HlsLibrary) => {
          const sourceStillCurrent =
            loadedTrackIdRef.current === track.id &&
            loadedSourceKeyRef.current === sourceDescriptor.key;
          if (!sourceStillCurrent) {
            return;
          }

          const canUseHlsJs = Boolean(HlsLibrary && typeof HlsLibrary.isSupported === "function" && HlsLibrary.isSupported());
          if (canUseHlsJs) {
            const hls = new HlsLibrary({
              enableWorker: true,
              backBufferLength: 90,
            });
            const syncHlsQuality = (explicitLevelIndex = null) => {
              if (
                loadedTrackIdRef.current !== track.id ||
                loadedSourceKeyRef.current !== sourceDescriptor.key
              ) {
                return;
              }
              const selected = normalizeStreamQualitySelection(
                streamQualitySelectionRef.current
              );
              const activeLevelIndex = resolveActiveLevelIndex(hls, explicitLevelIndex);
              const resolvedLevel = resolveQualityLevelFromHls(hls, activeLevelIndex);
              updateStreamQuality({
                available: true,
                canControl: true,
                selected,
                mode: hls.autoLevelEnabled ? "auto" : "manual",
                level: resolvedLevel || (selected !== "auto" ? selected : ""),
              });
            };
            hlsRef.current = hls;
            syncHlsQualityRef.current = () => {
              syncHlsQuality();
            };
            hls.attachMedia(audio);
            hls.on(HlsLibrary.Events.MANIFEST_PARSED, () => {
              applySelectionToHls(hls, streamQualitySelectionRef.current);
              syncHlsQuality();
              if (audio.paused) {
                attemptAudioPlayback(audio);
              }
            });
            hls.on(HlsLibrary.Events.LEVEL_SWITCHED, syncHlsQuality);
            hls.on(HlsLibrary.Events.LEVELS_UPDATED, syncHlsQuality);
            hls.on(HlsLibrary.Events.LEVEL_LOADED, (_event, data) => {
              const levelIndex = Number.isInteger(data?.level) ? data.level : -1;
              syncHlsQuality(levelIndex);
            });
            hls.on(HlsLibrary.Events.FRAG_CHANGED, (_event, data) => {
              const levelIndex = Number.isInteger(data?.frag?.level) ? data.frag.level : -1;
              syncHlsQuality(levelIndex);
            });
            hls.on(HlsLibrary.Events.MEDIA_ATTACHED, () => {
              hls.loadSource(sourceDescriptor.hlsUrl);
            });
            hls.on(HlsLibrary.Events.ERROR, (_event, data) => {
              if (!data?.fatal) {
                return;
              }
              disposeHls();
              updateStreamQuality({
                available: false,
                canControl: false,
                mode: "off",
                level: "",
              });
              if (sourceDescriptor.url) {
                audio.src = sourceDescriptor.url;
                audio.load();
                if (audio.paused) {
                  attemptAudioPlayback(audio);
                }
              }
            });
            return;
          }

          if (canUseNativeHls) {
            updateStreamQuality({
              available: true,
              canControl: false,
              mode: "auto",
              level: "",
            });
            audio.src = sourceDescriptor.hlsUrl;
            audio.load();
            if (audio.paused) {
              attemptAudioPlayback(audio);
            }
            return;
          }

          updateStreamQuality({
            available: false,
            canControl: false,
            mode: "off",
            level: "",
          });
          if (sourceDescriptor.url) {
            audio.src = sourceDescriptor.url;
            audio.load();
            if (audio.paused) {
              attemptAudioPlayback(audio);
            }
          }
        })
        .catch(() => {
          if (canUseNativeHls) {
            updateStreamQuality({
              available: true,
              canControl: false,
              mode: "auto",
              level: "",
            });
            audio.src = sourceDescriptor.hlsUrl;
            audio.load();
            if (audio.paused) {
              attemptAudioPlayback(audio);
            }
            return;
          }

          updateStreamQuality({
            available: false,
            canControl: false,
            mode: "off",
            level: "",
          });
          if (sourceDescriptor.url) {
            audio.src = sourceDescriptor.url;
            audio.load();
            if (audio.paused) {
              attemptAudioPlayback(audio);
            }
          }
        });
      return audio;
    }

    audio.src = sourceDescriptor.url || sourceDescriptor.hlsUrl;
    updateStreamQuality({
      available: false,
      canControl: false,
      mode: "off",
      level: "",
    });
    audio.load();
    if (audio.paused) {
      attemptAudioPlayback(audio);
    }

    return audio;
  }, [attemptAudioPlayback, disposeHls, ensureAudioElement, updateStreamQuality]);

  const playbackQueue = getPlaybackQueue(state);
  const playbackIndex = getPlaybackIndex(state);
  const currentTrackId = playbackQueue[playbackIndex];
  const currentTrack = trackMap[currentTrackId] ?? null;
  const currentDuration = currentTrack?.durationSec ?? 0;
  const clampedProgress = clamp(state.progressSec, 0, currentDuration || state.progressSec);
  const progressPercent = currentDuration ? (clampedProgress / currentDuration) * 100 : 0;

  const stopTrailerPlayback = useCallback(
    (audio, trailerSession = trailerSessionRef.current) => {
      const activeTrackId = loadedTrackIdRef.current;
      if (!audio || !shouldStopTrailerPlayback(trailerSession, activeTrackId, audio.currentTime)) {
        return false;
      }

      const endSec = Number(trailerSession.endSec);
      trailerSessionRef.current = null;
      audio.pause();
      try {
        audio.currentTime = endSec;
      } catch {
        // noop
      }
      dispatch({
        type: "finish_trailer",
        trackId: trailerSession.trackId,
        endSec,
      });
      return true;
    },
    []
  );

  useEffect(() => {
    if (!currentTrackId || !currentTrack || !shouldRefreshPlayback(currentTrack)) {
      return;
    }

    const cachedDescriptor = playbackCacheRef.current.get(currentTrackId);
    const cachedExpiration = Number(cachedDescriptor?.expiresAt ?? 0);
    if (
      cachedDescriptor?.streamUrl &&
      (!cachedExpiration || cachedExpiration - Date.now() > 30_000)
    ) {
      return;
    }

    let cancelled = false;

    const refreshPlayback = async () => {
      try {
        const descriptor = await fetchTrackPlayback(currentTrackId);
        if (cancelled || !descriptor?.streamUrl) {
          return;
        }
        playbackCacheRef.current.set(currentTrackId, descriptor);
        if (loadedTrackIdRef.current === currentTrackId) {
          const audio = replaceAudioSource(currentTrack);
          if (audio && state.isPlaying && audio.paused) {
            attemptAudioPlayback(audio);
          }
        }
      } catch {
        // Keep fallback URL from catalog if playback metadata request fails.
      }
    };

    void refreshPlayback();

    return () => {
      cancelled = true;
    };
  }, [attemptAudioPlayback, currentTrackId, currentTrack, replaceAudioSource, state.isPlaying]);

  useEffect(() => {
    const audio = ensureAudioElement();
    if (!audio) return undefined;

    const handleTimeUpdate = () => {
      if (stopTrailerPlayback(audio)) {
        return;
      }
      dispatch({ type: "sync_progress_sec", trackId: loadedTrackIdRef.current, progressSec: audio.currentTime });
    };
    const handleSeeked = () => {
      if (stopTrailerPlayback(audio)) {
        return;
      }
      dispatch({ type: "sync_progress_sec", trackId: loadedTrackIdRef.current, progressSec: audio.currentTime });
    };
    const handleEnded = () => {
      dispatch({ type: "track_finished" });
    };
    const handleCanPlay = () => {
      if (!audio.paused) {
        return;
      }
      attemptAudioPlayback(audio);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("seeked", handleSeeked);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("loadedmetadata", handleCanPlay);
    audio.addEventListener("canplay", handleCanPlay);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("seeked", handleSeeked);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("loadedmetadata", handleCanPlay);
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [attemptAudioPlayback, ensureAudioElement, stopTrailerPlayback]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = volumeToElement(state.volume);
  }, [state.volume]);

  useEffect(() => {
    applyEqualizerToGraph(state.equalizer);
  }, [applyEqualizerToGraph, state.equalizer]);

  useEffect(() => {
    const audio = ensureAudioElement();
    if (!audio) {
      return;
    }

    if (!currentTrack || !currentTrackId) {
      audio.pause();
      disposeHls();
      loadedTrackIdRef.current = null;
      loadedSourceKeyRef.current = "";
      seekVersionRef.current = 0;
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    const sourceDescriptor = resolveTrackSource(
      currentTrack,
      playbackCacheRef.current.get(currentTrack.id) ?? null
    );
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
        attemptAudioPlayback(audio);
      }
    } else {
      audio.pause();
    }
  }, [
    disposeHls,
    ensureAudioElement,
    replaceAudioSource,
    currentTrack,
    currentTrackId,
    attemptAudioPlayback,
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
      disposeHls();
      disposeAudioGraph();
      loadedTrackIdRef.current = null;
      loadedSourceKeyRef.current = "";
    },
    [disposeAudioGraph, disposeHls]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const payload = {
      queue: state.queue,
      queueSource: state.queueSource,
      waveQueue: state.waveQueue,
      waveIndex: state.waveIndex,
      currentIndex: state.currentIndex,
      volume: state.volume,
      likedIds: state.likedIds,
      followedArtistIds: state.followedArtistIds,
      historyIds: state.historyIds,
      savedPlaylistIds: state.savedPlaylistIds,
      shuffleEnabled: state.shuffleEnabled,
      repeatMode: state.repeatMode,
      equalizer: normalizeEqualizerState(state.equalizer),
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // noop
    }
  }, [
    state.queue,
    state.queueSource,
    state.waveQueue,
    state.waveIndex,
    state.currentIndex,
    state.volume,
    state.likedIds,
    state.followedArtistIds,
    state.historyIds,
    state.savedPlaylistIds,
    state.shuffleEnabled,
    state.repeatMode,
    state.equalizer,
  ]);

  const persistRemoteStateNow = useCallback(
    async (overrides = {}) => {
      if (!isAuthenticated || !remoteStateReady) {
        return true;
      }

      try {
        await updatePlayerState({
          likedTrackIds: overrides.likedTrackIds ?? state.likedIds,
          followedArtistIds: overrides.followedArtistIds ?? state.followedArtistIds,
          historyTrackIds: overrides.historyTrackIds ?? state.historyIds,
          savedPlaylistIds: overrides.savedPlaylistIds ?? state.savedPlaylistIds,
          queueTrackIds: overrides.queueTrackIds ?? state.queue,
          queueCurrentIndex: overrides.queueCurrentIndex ?? state.currentIndex,
          queueProgressSec: overrides.queueProgressSec ?? persistedRemoteProgressSec,
          queueIsPlaying: overrides.queueIsPlaying ?? state.isPlaying,
        });
        return true;
      } catch {
        dispatch({
          type: "notify",
          message: "Не удалось сохранить изменения в моей музыке.",
        });
        return false;
      }
    },
    [
      isAuthenticated,
      remoteStateReady,
      state.likedIds,
      state.followedArtistIds,
      state.historyIds,
      state.savedPlaylistIds,
      state.queue,
      state.currentIndex,
      persistedRemoteProgressSec,
      state.isPlaying,
    ]
  );

  const normalizedEqualizer = useMemo(
    () => normalizeEqualizerState(state.equalizer),
    [state.equalizer]
  );
  const activeEqualizerPreset = useMemo(
    () => findEqualizerPreset(normalizedEqualizer.presetId),
    [normalizedEqualizer.presetId]
  );

  const value = useMemo(
    () => ({
      tracks: runtimeTracks,
      artists: runtimeArtists,
      trackMap,
      queue: state.queue,
      queueSource: state.queueSource,
      waveQueue: state.waveQueue,
      waveIndex: state.waveIndex,
      isWaveActive: state.queueSource === WAVE_QUEUE_SOURCE || state.waveQueue.length > 0,
      queueTracks: state.queue.map((id) => trackMap[id]).filter(Boolean),
      currentIndex: state.queueSource === WAVE_QUEUE_SOURCE ? -1 : state.currentIndex,
      playbackIndex,
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
      streamQuality: {
        available: state.streamQualityAvailable,
        canControl: state.streamQualityCanControl,
        selected: state.streamQualitySelected,
        mode: state.streamQualityMode,
        level: state.streamQualityLevel,
      },
      equalizer: {
        enabled: normalizedEqualizer.enabled,
        presetId: normalizedEqualizer.presetId,
        presetLabel: activeEqualizerPreset?.label ?? "Своя настройка",
        customPresetId: CUSTOM_EQUALIZER_PRESET_ID,
        gains: normalizedEqualizer.gains,
        preampDb: normalizedEqualizer.preampDb,
        preampMinDb: EQUALIZER_PREAMP_MIN,
        preampMaxDb: EQUALIZER_PREAMP_MAX,
        bands: buildEqualizerBands(normalizedEqualizer),
      },
      equalizerPresets: EQUALIZER_PRESETS,
      likedIds: state.likedIds,
      followedArtistIds: state.followedArtistIds,
      historyIds: state.historyIds,
      savedPlaylistIds: state.savedPlaylistIds,
      toastItems: state.toastItems,
      isCurrentTrackLiked: Boolean(currentTrackId && state.likedIds.includes(currentTrackId)),
      isArtistFollowed: (artistId) => state.followedArtistIds.includes(artistId),
      isPlaylistSaved: (playlistId) => state.savedPlaylistIds.includes(playlistId),
      playTrack: (trackId) => {
        if (trackId === currentTrackId) {
          dispatch({ type: "toggle_play" });
          return;
        }
        dispatch({ type: "play_track", trackId });
      },
      playTrackTrailer: (trackId, durationSec = 18) =>
        dispatch({ type: "play_trailer", trackId, durationSec }),
      playQueue: (trackIds, startIndex = 0, options = {}) =>
        dispatch({ type: "play_queue", trackIds, startIndex, source: options.source }),
      jumpToQueueIndex: (index) => dispatch({ type: "jump_to_index", index }),
      nextTrack: () => dispatch({ type: "next_track" }),
      prevTrack: () => dispatch({ type: "prev_track" }),
      togglePlay: () => dispatch({ type: "toggle_play" }),
      setProgressPercent: (percent) => dispatch({ type: "seek_percent", percent }),
      setVolume: (volume) => dispatch({ type: "set_volume", volume }),
      setEqualizerPreset: (presetId) => dispatch({ type: "set_equalizer_preset", presetId }),
      setEqualizerBand: (bandIndex, gain) =>
        dispatch({ type: "set_equalizer_band", bandIndex, gain }),
      setEqualizerPreamp: (preampDb) => dispatch({ type: "set_equalizer_preamp", preampDb }),
      resetEqualizer: () => dispatch({ type: "reset_equalizer" }),
      toggleShuffle: () => dispatch({ type: "toggle_shuffle" }),
      cycleRepeatMode: () => dispatch({ type: "cycle_repeat" }),
      removeQueueItem: (index) => dispatch({ type: "remove_from_queue", index }),
      moveQueueItem: (fromIndex, toIndex) => dispatch({ type: "move_queue_item", fromIndex, toIndex }),
      addTrackNext: (trackId) => dispatch({ type: "add_track_next", trackId }),
      addTrackLast: (trackId) => dispatch({ type: "add_track_last", trackId }),
      addQueueNext: (trackIds, sourceLabel = "Плейлист") =>
        dispatch({ type: "add_queue_next", trackIds, sourceLabel }),
      clearQueue: () => dispatch({ type: "clear_queue" }),
      likeTrack: (trackId) => dispatch({ type: "like_track", trackId }),
      unlikeTrack: (trackId) => dispatch({ type: "unlike_track", trackId }),
      toggleLikeTrack: (trackId) => dispatch({ type: "toggle_like_track", trackId }),
      toggleArtistFollow: async (artistId) => {
        const normalizedArtistId = String(artistId ?? "").trim();
        if (!normalizedArtistId || !artistMap[normalizedArtistId]) {
          return false;
        }
        const nextFollowedArtistIds = state.followedArtistIds.includes(normalizedArtistId)
          ? state.followedArtistIds.filter((id) => id !== normalizedArtistId)
          : [normalizedArtistId, ...state.followedArtistIds];
        dispatch({ type: "toggle_follow_artist", artistId: normalizedArtistId });
        const saved = await persistRemoteStateNow({ followedArtistIds: nextFollowedArtistIds });
        if (saved) {
          void refreshCatalog({ silent: true });
        }
        return saved;
      },
      togglePlaylistSave: async (playlistId) => {
        const normalizedPlaylistId = String(playlistId ?? "").trim();
        if (!normalizedPlaylistId) {
          return false;
        }
        const nextSavedPlaylistIds = state.savedPlaylistIds.includes(normalizedPlaylistId)
          ? state.savedPlaylistIds.filter((id) => id !== normalizedPlaylistId)
          : [normalizedPlaylistId, ...state.savedPlaylistIds];
        dispatch({ type: "toggle_save_playlist", playlistId: normalizedPlaylistId });
        return persistRemoteStateNow({ savedPlaylistIds: nextSavedPlaylistIds });
      },
      clearHistory: () => dispatch({ type: "clear_history" }),
      dismissToast: (toastId) => dispatch({ type: "dismiss_toast", toastId }),
      notify: (message) => dispatch({ type: "notify", message }),
      setStreamQuality: (selection) => setStreamQualitySelection(selection),
      refreshCatalog,
    }),
    [
      state,
      playbackIndex,
      currentTrackId,
      currentTrack,
      clampedProgress,
      progressPercent,
      currentDuration,
      normalizedEqualizer,
      activeEqualizerPreset,
      setStreamQualitySelection,
      persistRemoteStateNow,
      refreshCatalog,
    ]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
