/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useReducer } from "react";
import { historySeeds, initialLikedIds, initialQueue, tracks } from "../data/musicData.js";
import { formatDuration } from "../utils/formatters.js";

const PlayerContext = createContext(null);

const trackMap = Object.fromEntries(tracks.map((track) => [track.id, track]));

const initialState = {
  queue: initialQueue,
  currentIndex: 0,
  isPlaying: false,
  volume: 70,
  progressSec: 78,
  likedIds: initialLikedIds,
  historyIds: historySeeds,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function addHistory(historyIds, trackId) {
  const filtered = historyIds.filter((id) => id !== trackId);
  return [trackId, ...filtered].slice(0, 24);
}

function playerReducer(state, action) {
  switch (action.type) {
    case "toggle_play": {
      return { ...state, isPlaying: !state.isPlaying };
    }

    case "play_track": {
      const existingIndex = state.queue.indexOf(action.trackId);
      const nextQueue =
        existingIndex >= 0 ? state.queue : [action.trackId, ...state.queue.filter(Boolean)];
      const nextIndex = existingIndex >= 0 ? existingIndex : 0;

      return {
        ...state,
        queue: nextQueue,
        currentIndex: nextIndex,
        isPlaying: true,
        progressSec: 0,
        historyIds: addHistory(state.historyIds, action.trackId),
      };
    }

    case "next_track": {
      if (!state.queue.length) {
        return state;
      }
      const nextIndex = (state.currentIndex + 1) % state.queue.length;
      const nextTrackId = state.queue[nextIndex];
      return {
        ...state,
        currentIndex: nextIndex,
        progressSec: 0,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, nextTrackId),
      };
    }

    case "prev_track": {
      if (!state.queue.length) {
        return state;
      }
      const prevIndex = state.currentIndex === 0 ? state.queue.length - 1 : state.currentIndex - 1;
      const prevTrackId = state.queue[prevIndex];
      return {
        ...state,
        currentIndex: prevIndex,
        progressSec: 0,
        isPlaying: true,
        historyIds: addHistory(state.historyIds, prevTrackId),
      };
    }

    case "seek_percent": {
      const trackId = state.queue[state.currentIndex];
      const track = trackMap[trackId];
      if (!track) {
        return state;
      }
      const progressSec = Math.round((clamp(action.percent, 0, 100) / 100) * track.durationSec);
      return { ...state, progressSec };
    }

    case "set_volume": {
      return { ...state, volume: clamp(action.volume, 0, 100) };
    }

    case "like_track": {
      if (state.likedIds.includes(action.trackId)) {
        return state;
      }
      return { ...state, likedIds: [action.trackId, ...state.likedIds] };
    }

    case "unlike_track": {
      return { ...state, likedIds: state.likedIds.filter((id) => id !== action.trackId) };
    }

    case "toggle_like_track": {
      const exists = state.likedIds.includes(action.trackId);
      return {
        ...state,
        likedIds: exists
          ? state.likedIds.filter((id) => id !== action.trackId)
          : [action.trackId, ...state.likedIds],
      };
    }

    case "clear_history": {
      return { ...state, historyIds: [] };
    }

    default:
      return state;
  }
}

export function PlayerProvider({ children }) {
  const [state, dispatch] = useReducer(playerReducer, initialState);

  const currentTrackId = state.queue[state.currentIndex];
  const currentTrack = trackMap[currentTrackId] ?? null;
  const currentDuration = currentTrack?.durationSec ?? 0;
  const clampedProgress = clamp(state.progressSec, 0, currentDuration || state.progressSec);
  const progressPercent = currentDuration ? Math.round((clampedProgress / currentDuration) * 100) : 0;

  const value = useMemo(
    () => ({
      tracks,
      trackMap,
      queue: state.queue,
      queueTracks: state.queue.map((id) => trackMap[id]).filter(Boolean),
      currentTrackId,
      currentTrack,
      isPlaying: state.isPlaying,
      volume: state.volume,
      progressSec: clampedProgress,
      progressPercent,
      progressLabel: formatDuration(clampedProgress),
      durationLabel: formatDuration(currentDuration),
      likedIds: state.likedIds,
      historyIds: state.historyIds,
      isCurrentTrackLiked: Boolean(currentTrackId && state.likedIds.includes(currentTrackId)),
      playTrack: (trackId) => dispatch({ type: "play_track", trackId }),
      togglePlay: () => dispatch({ type: "toggle_play" }),
      nextTrack: () => dispatch({ type: "next_track" }),
      prevTrack: () => dispatch({ type: "prev_track" }),
      setProgressPercent: (percent) => dispatch({ type: "seek_percent", percent }),
      setVolume: (volume) => dispatch({ type: "set_volume", volume }),
      likeTrack: (trackId) => dispatch({ type: "like_track", trackId }),
      unlikeTrack: (trackId) => dispatch({ type: "unlike_track", trackId }),
      toggleLikeTrack: (trackId) => dispatch({ type: "toggle_like_track", trackId }),
      clearHistory: () => dispatch({ type: "clear_history" }),
    }),
    [state, currentTrackId, currentTrack, clampedProgress, progressPercent, currentDuration]
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used inside PlayerProvider.");
  }
  return context;
}
