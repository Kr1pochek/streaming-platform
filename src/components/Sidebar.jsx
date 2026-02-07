import { NavLink, useNavigate } from "react-router-dom";
import {
  FiHome,
  FiSearch,
  FiMusic,
  FiHeart,
  FiUser,
  FiLogIn,
} from "react-icons/fi";
import styles from "./Sidebar.module.css";

export default function Sidebar() {
  const navigate = useNavigate();
  const user = null;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarTop}>
        <div className={styles.brand}>
          <div className={styles.brandLogo}>♪</div>
          <div className={styles.brandText}>
            <div className={styles.brandTitle}>MusicApp</div>
            <div className={styles.brandSub}>стриминг платформа</div>
          </div>
        </div>

        <nav className={styles.nav}>
          <NavLink
            to="/"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ""}`.trim()
            }
          >
            <FiHome className={styles.navIcon} />
            <span>Главная</span>
          </NavLink>

          <NavLink
            to="/search"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ""}`.trim()
            }
          >
            <FiSearch className={styles.navIcon} />
            <span>Поиск</span>
          </NavLink>

          <NavLink
            to="/library"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ""}`.trim()
            }
          >
            <FiMusic className={styles.navIcon} />
            <span>Моя музыка</span>
          </NavLink>

          <NavLink
            to="/liked"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ""}`.trim()
            }
          >
            <FiHeart className={styles.navIcon} />
            <span>Мне нравится</span>
          </NavLink>

          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.navItemActive : ""}`.trim()
            }
          >
            <FiUser className={styles.navIcon} />
            <span>Профиль</span>
          </NavLink>
        </nav>
      </div>

      <div className={styles.sidebarBottom}>
        {user ? (
          <button type="button" className={styles.account} onClick={() => navigate("/profile")}>
            <div className={styles.accountAvatar}>R</div>
            <div className={styles.accountMeta}>
              <div className={styles.accountName}>Роман</div>
              <div className={styles.accountHint}>Аккаунт</div>
            </div>
            <FiUser className={styles.accountChev} />
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.account} ${styles.accountGuest}`.trim()}
            onClick={() => navigate("/profile")}
          >
            <div className={`${styles.accountAvatar} ${styles.accountAvatarGhost}`.trim()}>
              <FiUser />
            </div>
            <div className={styles.accountMeta}>
              <div className={styles.accountName}>Гость</div>
              <div className={styles.accountHint}>Войти / Регистрация</div>
            </div>
            <FiLogIn className={styles.accountChev} />
          </button>
        )}
      </div>
    </aside>
  );
}
