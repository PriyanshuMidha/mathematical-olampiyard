import { useCallback, useEffect, useState } from "react";

// Runs an async loader on mount / when deps change and tracks loading + error state.
export function useAsync(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    return run()
      .then((result) => {
        setData(result);
        return result;
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [run]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    run()
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [run]);

  return { data, error, loading, reload, setData };
}
