import { useEffect, useState } from "react";
import { getAdminUsers, banAdminUser, unbanAdminUser } from "../api/musicApi";
import styles from "./AdminUsers.module.css";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const limit = 20;

  const fetchUsers = async (off) => {
    try {
      setLoading(true);
      const data = await getAdminUsers(limit, off);
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setOffset(off);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers(0);
  }, []);

  const handleBanUser = async (userId) => {
    try {
      await banAdminUser(userId);
      await fetchUsers(offset);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnbanUser = async (userId) => {
    try {
      await unbanAdminUser(userId);
      await fetchUsers(offset);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading users...</div>;
  }

  if (error) {
    return <div className={styles.error}>Error: {error}</div>;
  }

  const hasMore = offset + limit < total;

  return (
    <div className={styles.container}>
      <h2>User Management</h2>
      <p className={styles.count}>Total: {total}</p>

      {users.length === 0 ? (
        <div className={styles.empty}>No users found</div>
      ) : (
        <>
          <div className={styles.table}>
            <div className={styles.header}>
              <div className={styles.usernameCol}>Username</div>
              <div className={styles.displayCol}>Display Name</div>
              <div className={styles.statusCol}>Status</div>
              <div className={styles.uploadedCol}>Tracks</div>
              <div className={styles.actionCol}>Action</div>
            </div>

            {users.map((user) => (
              <div key={user.id} className={styles.row}>
                <div className={styles.usernameCol}>{user.username}</div>
                <div className={styles.displayCol}>{user.display_name}</div>
                <div className={styles.statusCol}>
                  <span className={user.is_admin ? styles.admin : user.is_banned ? styles.banned : styles.active}>
                    {user.is_admin ? "Admin" : user.is_banned ? "Banned" : "Active"}
                  </span>
                </div>
                <div className={styles.uploadedCol}>{user.uploaded_tracks_count || 0}</div>
                <div className={styles.actionCol}>
                  {user.is_admin ? (
                    <span className={styles.adminLabel}>Admin</span>
                  ) : user.is_banned ? (
                    <button
                      className={styles.btnUnban}
                      onClick={() => handleUnbanUser(user.id)}
                    >
                      Unban
                    </button>
                  ) : (
                    <button
                      className={styles.btnBan}
                      onClick={() => handleBanUser(user.id)}
                    >
                      Ban
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.pagination}>
            <button
              disabled={offset === 0}
              onClick={() => fetchUsers(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span>
              {offset + 1} - {Math.min(offset + limit, total)} of {total}
            </span>
            <button
              disabled={!hasMore}
              onClick={() => fetchUsers(offset + limit)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
