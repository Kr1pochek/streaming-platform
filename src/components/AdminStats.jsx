import { useEffect, useState } from "react";
import { getAdminStats } from "../api/musicApi";
import styles from "./AdminStats.module.css";

export default function AdminStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const data = await getAdminStats();
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err.message || "Failed to load statistics");
        setStats(null);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return <div className={styles.loading}>Loading statistics...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  if (!stats) {
    return <div className={styles.error}>No data available</div>;
  }

  return (
    <div className={styles.container}>
      <h2>Platform Statistics</h2>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h3>Total Users</h3>
          <p className={styles.value}>{stats.total_users || 0}</p>
        </div>

        <div className={styles.card}>
          <h3>Banned Users</h3>
          <p className={styles.value}>{stats.banned_users || 0}</p>
        </div>

        <div className={styles.card}>
          <h3>Total Tracks</h3>
          <p className={styles.value}>{stats.total_tracks || 0}</p>
        </div>

        <div className={styles.card}>
          <h3>Hidden Tracks</h3>
          <p className={styles.value}>{stats.hidden_tracks || 0}</p>
        </div>

        <div className={styles.card}>
          <h3>Active Sessions</h3>
          <p className={styles.value}>{stats.active_sessions || 0}</p>
        </div>
      </div>
    </div>
  );
}
