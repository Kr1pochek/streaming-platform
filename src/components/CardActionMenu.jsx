import { useEffect, useRef, useState } from "react";
import {
  FiEdit2,
  FiExternalLink,
  FiHeart,
  FiShare2,
  FiTrash2,
  FiUserMinus,
  FiUserPlus,
} from "react-icons/fi";
import { BsFillPlayFill } from "react-icons/bs";
import styles from "./CardActionMenu.module.css";

function clampToViewport(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const iconMap = {
  open: FiExternalLink,
  share: FiShare2,
  edit: FiEdit2,
  delete: FiTrash2,
  play: BsFillPlayFill,
  save: FiHeart,
  remove: FiTrash2,
  follow: FiUserPlus,
  unfollow: FiUserMinus,
};

export default function CardActionMenu({ menuState, onClose }) {
  const menuRef = useRef(null);
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    top: 0,
  });

  useEffect(() => {
    if (!menuState || !menuRef.current || typeof window === "undefined") {
      return;
    }

    const updatePosition = () => {
      const bounds = menuRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const viewportPadding = 12;
      const nextLeft = clampToViewport(
        menuState.x,
        viewportPadding,
        window.innerWidth - bounds.width - viewportPadding
      );
      const nextTop = clampToViewport(
        menuState.y,
        viewportPadding,
        window.innerHeight - bounds.height - viewportPadding
      );

      setMenuPosition({
        left: nextLeft,
        top: nextTop,
      });
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePosition);
    };
  }, [menuState]);

  if (!menuState) {
    return null;
  }

  const handleActionSelect = async (action) => {
    if (action?.disabled) {
      return;
    }

    try {
      await action?.onSelect?.();
    } finally {
      if (action?.closeOnSelect !== false) {
        onClose?.();
      }
    }
  };

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ top: menuPosition.top, left: menuPosition.left }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.menuHeader}>
        <p className={styles.menuTitle}>{menuState.title || "Действия"}</p>
        {menuState.subtitle ? <p className={styles.menuSubtitle}>{menuState.subtitle}</p> : null}
      </div>

      <div className={styles.menuList}>
        {menuState.actions.map((action) => {
          const Icon = iconMap[action.icon] ?? FiExternalLink;
          return (
            <button
              key={action.id}
              type="button"
              className={`${styles.menuButton} ${action.tone === "danger" ? styles.menuButtonDanger : ""}`.trim()}
              onClick={() => void handleActionSelect(action)}
              disabled={action.disabled}
            >
              <span className={styles.menuIcon}>
                <Icon />
              </span>
              <span className={styles.menuLabel}>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
