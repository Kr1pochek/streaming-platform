import styles from "./HomePage.module.css";

const listeningHistory = [
  { title: "Hozier — Too Sweet", meta: "2 часа назад" },
  { title: "Хадн дадн — Ляля", meta: "Сегодня" },
  { title: "Billie Eilish — CHIHIRO", meta: "Вчера" },
  { title: "The Weeknd — Save Your Tears", meta: "Вчера" },
  { title: "Кино — Группа крови", meta: "3 дня назад" },
  { title: "Oxxxymiron — Город под подошвой", meta: "5 дней назад" },
];

export default function HomePage() {
  return (
    <div className={styles.page}>
      <div className={styles.mainCard}>
        <div className={styles.hero}>
          <div className={styles.heroBackdrop} />
          <div className={styles.heroContent}>
            <div className={styles.kicker}>Персонально для тебя</div>
            <div className={styles.title}>Моя волна</div>
            <div className={styles.subtitle}>
              Нажми, чтобы запустить поток, а ниже — история прослушиваний.
            </div>
            <div className={styles.actions}>
              <button className={styles.waveButton}>Моя волна</button>
              <button className={styles.playButton}>Play</button>
            </div>
          </div>
        </div>

        <div className={styles.scrollArea}>
          <div className={styles.sectionTitle}>История прослушивания</div>
          <div className={styles.historyList}>
            {listeningHistory.map((item) => (
              <div key={item.title} className={styles.historyCard}>
                <div className={styles.historyTitle}>{item.title}</div>
                <div className={styles.historyMeta}>{item.meta}</div>
              </div>
            ))}
          </div>
          <div className={styles.sectionTitle}>Продолжить</div>
          <div className={styles.queue}>
            <div className={styles.queueItem}>Плейлист «Сосредоточиться»</div>
            <div className={styles.queueItem}>Радио «Инди вечер»</div>
            <div className={styles.queueItem}>Mix: Для дороги</div>
          </div>
        </div>
      </div>
    </div>
  );
}
