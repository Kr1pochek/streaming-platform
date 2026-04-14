import process from "node:process";
import { restorePortableSnapshotIfNeeded } from "./portableSnapshot.mjs";

restorePortableSnapshotIfNeeded()
  .then((result) => {
    if (!result.restored) {
      console.log(`portable snapshot restore skipped: ${result.reason}`);
      if (Array.isArray(result.details) && result.details.length) {
        console.log(
          `existing data: ${result.details.map((entry) => `${entry.table}=${entry.count}`).join(", ")}`
        );
      }
      return;
    }

    console.log(
      `portable snapshot restored: tables=${result.tableCount}, rows=${result.rowCount}, mediaFiles=${result.mediaFileCount}`
    );
  })
  .catch((error) => {
    console.error("Portable snapshot restore failed:", error);
    process.exitCode = 1;
  });
