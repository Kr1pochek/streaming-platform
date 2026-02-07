import { useCallback, useEffect, useState } from "react";

export default function useAsyncResource(loader, deps = []) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка загрузки.");
      setStatus("error");
    }
  }, [loader]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
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
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { status, data, error, reload };
}
