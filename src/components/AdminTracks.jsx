import { useEffect, useState } from "react";
import { getAdminTracks, hideAdminTrack, unhideAdminTrack } from "../api/musicApi";
import styles from "./AdminTracks.module.css";

export default function AdminTracks() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const limit = 20;

  const fetchTracks = async (off) => {
    try {
      setLoading(true);
      const data = await getAdminTracks(limit, off);
      setTracks(data.tracks || []);
      setTotal(data.total || 0);
      setOffset(off);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load tracks");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracks(0);
  }, []);

  const handleHideTrack = async (trackId) => {
    try {
      await hideAdminTrack(trackId);
      await fetchTracks(offset);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnhideTrack = async (trackId) => {
    try {
      await unhideAdminTrack(trackId);
      await fetchTracks(offset);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading tracks...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  const hasMore = offset + limit < total;

  return (
    <div className={styles.container}>
      <h2>Uploaded Tracks Moderation</h2>
      <p className={styles.count}>Total: {total}</p>

      {tracks.length === 0 ? (
        <div className={styles.empty}>No tracks found</div>
      ) : (
        <>
          <div className={styles.table}>
            <div className={styles.header}>
              <div className={styles.titleCol}>Title</div>
              <div className={styles.artistCol}>Artist</div>
              <div className={styles.statusCol}>Status</div>
              <div className={styles.reasonCol}>Reason</div>
              <div className={styles.actionCol}>Action</div>
            </div>

            {tracks.map((track) => (
              <div key={track.id} className={styles.row}>
                <div className={styles.titleCol}>{track.title}</div>
                <div className={styles.artistCol}>{track.artists || "Unknown"}</div>
                <div className={styles.statusCol}>
                  <span className={track.is_hidden ? styles.hidden : styles.visible}>
                    {track.is_hidden ? "Hidden" : "Visible"}
                  </span>
                </div>
                <div className={styles.reasonCol}>{track.hidden_reason || "-"}</div>
                <div className={styles.actionCol}>
                  {track.is_hidden ? (
                    <button
                      className={styles.btnUnhide}
                      onClick={() => handleUnhideTrack(track.id)}
                    >
                      Unhide
                    </button>
                  ) : (
                    <button
                      className={styles.btnHide}
                      onClick={() => handleHideTrack(track.id)}
                    >
                      Hide
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.pagination}>
            <button
              disabled={offset === 0}
              onClick={() => fetchTracks(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span>
              {offset + 1} - {Math.min(offset + limit, total)} of {total}
            </span>
            <button
              disabled={!hasMore}
              onClick={() => fetchTracks(offset + limit)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
