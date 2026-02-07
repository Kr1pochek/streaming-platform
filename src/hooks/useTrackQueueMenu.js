import { useEffect, useState } from "react";
import usePlayer from "./usePlayer.js";

export default function useTrackQueueMenu() {
  const { addTrackNext } = usePlayer();
  const [menuState, setMenuState] = useState(null);

  const openTrackMenu = (event, trackId) => {
    event.preventDefault();
    setMenuState({
      trackId,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const closeTrackMenu = () => {
    setMenuState(null);
  };

  const addTrackToQueueNext = () => {
    if (menuState?.trackId) {
      addTrackNext(menuState.trackId);
    }
    closeTrackMenu();
  };

  useEffect(() => {
    if (!menuState) {
      return undefined;
    }

    const handlePointerDown = () => closeTrackMenu();
    const handleScroll = () => closeTrackMenu();
    const handleResize = () => closeTrackMenu();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeTrackMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuState]);

  return {
    menuState,
    openTrackMenu,
    closeTrackMenu,
    addTrackToQueueNext,
  };
}
