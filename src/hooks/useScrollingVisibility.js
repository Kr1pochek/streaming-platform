import { useEffect, useState } from "react";

export default function useScrollingVisibility(delay = 700) {
  const [scrollElement, setScrollElement] = useState(null);
  const [isScrolling, setIsScrolling] = useState(false);

  useEffect(() => {
    if (!scrollElement) {
      return;
    }

    let timeoutId;

    const handleScroll = () => {
      setIsScrolling(true);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setIsScrolling(false), delay);
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      clearTimeout(timeoutId);
    };
  }, [scrollElement, delay]);

  return { isScrolling, setScrollElement };
}
