import process from "node:process";
import { exportPortableSnapshot } from "./portableSnapshot.mjs";

exportPortableSnapshot()
  .then((summary) => {
    console.log(
      `portable snapshot exported: tables=${summary.tableCount}, rows=${summary.rowCount}, mediaFiles=${summary.mediaFileCount}`
    );
    console.log(`database snapshot: ${summary.snapshotDatabasePath}`);
    console.log(`media snapshot: ${summary.snapshotMediaRoot}`);
  })
  .catch((error) => {
    console.error("Portable snapshot export failed:", error);
    process.exitCode = 1;
  });
