import type { DatabaseSync } from 'node:sqlite';
import type { NoteStore } from '../notes/store.js';
/** Versioned upgrades preserve the provider's database and transaction boundaries. */
export declare function migrateKnowledgeDatabase(db: DatabaseSync, notes: NoteStore): void;
//# sourceMappingURL=migrations.d.ts.map