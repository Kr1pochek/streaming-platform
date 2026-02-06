import { useState } from "react";
import styles from "./HomePage.module.css";

const quickChips = [
  {
    id: "for-you",
    title: "Для вас",
    subtitle: "GENJUTSU, Кишлак",
    gradient: "linear-gradient(135deg, #ffffff 0%, #23252b 55%, #0f1014 100%)",
  },
  {
    id: "trends",
    title: "Тренды",
    subtitle: "Joji, J. Cole",
    gradient: "linear-gradient(135deg, #ffb6c7 0%, #6b1b1b 55%, #0f1014 100%)",
  },
];

const wideCards = [
  {
    id: "liked",
    title: "Мне нравится",
    subtitle: "482 трека",
    icon: "❤",
    cover: "linear-gradient(135deg, #ff7c5c, #ffcf84)",
  },
  {
    id: "history",
    title: "История",
    subtitle: "tuborosho, synthlove, день ото дня",
    icon: "↺",
    cover: "linear-gradient(135deg, #353a44, #10131a)",
  },
];

export default function HomePage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeChip, setActiveChip] = useState("for-you");

  return (
    <div className={styles.page}>
      <div className={styles.mainCard}>
        <div className={styles.hero}>
          <div className={styles.heroBackdrop} />
          <div className={styles.heroContent}>
            <div className={styles.titleRow}>
              <button
                className={styles.playInline}
                type="button"
                aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
                aria-pressed={isPlaying}
                onClick={() => setIsPlaying((prev) => !prev)}
              >
                <span className={styles.playIcon}>{isPlaying ? "II" : "▶"}</span>
              </button>
              <div className={styles.title}>Моя волна</div>
            </div>
          </div>
          <div className={styles.heroFooter}>
            <div className={styles.chipsRow}>
              {quickChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`${styles.chip} ${
                    activeChip === chip.id ? styles.chipActive : ""
                  }`.trim()}
                  onClick={() => setActiveChip(chip.id)}
                  aria-pressed={activeChip === chip.id}
                >
                  <span
                    className={styles.chipAvatar}
                    style={{ background: chip.gradient }}
                  />
                  <span className={styles.chipText}>
                    <span className={styles.chipTitle}>{chip.title}</span>
                    <span className={styles.chipSubtitle}>{chip.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className={styles.wideRow}>
              {wideCards.map((card) => (
                <button key={card.id} type="button" className={styles.wideCard}>
                  <span className={styles.cardIcon}>{card.icon}</span>
                  <span className={styles.cardText}>
                    <span className={styles.cardTitle}>{card.title}</span>
                    <span className={styles.cardSubtitle}>{card.subtitle}</span>
                  </span>
                  <span
                    className={styles.cardCover}
                    style={{ background: card.cover }}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
