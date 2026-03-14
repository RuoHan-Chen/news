"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  EscalationDraft,
  MeshReport,
  NewsStory,
  RecommendationBrief,
} from "@/lib/types";
import type { MeshNewsRepository } from "@/lib/storage/repository";

interface MeshDB extends DBSchema {
  reports: { key: string; value: MeshReport };
  stories: { key: string; value: NewsStory };
  recommendations: { key: string; value: RecommendationBrief };
  escalations: { key: string; value: EscalationDraft };
}

const DB_NAME = "meshnews-v1";
const VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MeshDB>> | null = null;

function getDb(): Promise<IDBPDatabase<MeshDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MeshDB>(DB_NAME, VERSION, {
      upgrade(db) {
        db.createObjectStore("reports", { keyPath: "id" });
        db.createObjectStore("stories", { keyPath: "id" });
        db.createObjectStore("recommendations", { keyPath: "id" });
        db.createObjectStore("escalations", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export function createIndexedDBRepository(): MeshNewsRepository {
  return {
    async putReport(r: MeshReport) {
      const db = await getDb();
      await db.put("reports", r);
    },
    async listReports() {
      const db = await getDb();
      return db.getAll("reports");
    },
    async putStory(s: NewsStory) {
      const db = await getDb();
      await db.put("stories", s);
    },
    async listStories() {
      const db = await getDb();
      return db.getAll("stories");
    },
    async putRecommendation(b: RecommendationBrief) {
      const db = await getDb();
      await db.put("recommendations", b);
    },
    async listRecommendations() {
      const db = await getDb();
      return db.getAll("recommendations");
    },
    async putEscalation(e: EscalationDraft) {
      const db = await getDb();
      await db.put("escalations", e);
    },
    async listEscalations() {
      const db = await getDb();
      return db.getAll("escalations");
    },
  };
}
