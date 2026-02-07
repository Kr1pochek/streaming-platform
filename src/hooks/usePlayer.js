import { useContext } from "react";
import PlayerContext from "../context/playerContext.js";

export default function usePlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used inside PlayerProvider.");
  }
  return context;
}
