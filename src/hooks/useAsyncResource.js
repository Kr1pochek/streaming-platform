import { useCallback, useEffect, useState } from "react";

export default function useAsyncResource(loader, options = {}) {
  const { immediate = true } = options;

  const [status, setStatus] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setStatus("loading");
    setError("");

    try {
      const result = await loader();
      setData(result);
      setStatus("success");
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка загрузки.");
      setStatus("error");
      return null;
    }
  }, [loader]);

  useEffect(() => {
    if (!immediate) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      setStatus("loading");
      setError("");
      try {
        const result = await loader();
        if (cancelled) return;
        setData(result);
        setStatus("success");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Произошла ошибка загрузки.");
        setStatus("error");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [loader, immediate]);

  return { status, data, error, reload };
}
