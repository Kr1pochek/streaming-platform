import { useEffect, useState } from "react";

export default function useCardActionMenu() {
  const [menuState, setMenuState] = useState(null);

  const openCardMenu = (event, config) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const hasPointerCoordinates =
      Number.isFinite(event?.clientX) &&
      Number.isFinite(event?.clientY) &&
      (event.clientX !== 0 || event.clientY !== 0);

    let x = hasPointerCoordinates ? event.clientX : null;
    let y = hasPointerCoordinates ? event.clientY : null;

    if ((!Number.isFinite(x) || !Number.isFinite(y)) && event?.currentTarget?.getBoundingClientRect) {
      const bounds = event.currentTarget.getBoundingClientRect();
      x = bounds.right - 12;
      y = bounds.bottom + 8;
    }

    if ((!Number.isFinite(x) || !Number.isFinite(y)) && typeof window !== "undefined") {
      x = window.innerWidth / 2;
      y = window.innerHeight / 2;
    }

    setMenuState({
      x: x ?? 0,
      y: y ?? 0,
      title: config?.title ?? "",
      subtitle: config?.subtitle ?? "",
      actions: Array.isArray(config?.actions) ? config.actions : [],
    });
  };

  const closeCardMenu = () => {
    setMenuState(null);
  };

  useEffect(() => {
    if (!menuState) {
      return undefined;
    }

    const handlePointerDown = () => closeCardMenu();
    const handleScroll = () => closeCardMenu();
    const handleResize = () => closeCardMenu();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeCardMenu();
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
    openCardMenu,
    closeCardMenu,
  };
}
