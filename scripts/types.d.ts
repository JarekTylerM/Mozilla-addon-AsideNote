/**
 * types.d.ts — centralne typy domenowe (ambient, globalne)
 *
 * Bez importu/eksportu → interfejsy są globalne; każdy plik z `// @ts-check`
 * widzi Note/Task/Tag bez `import`. To tylko typy (checkJs), zero runtime.
 */

interface TagColor {
  bg: string;
  fg: string;
  darkBg?: string;
  darkFg?: string;
}

interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

/**
 * Notatka lub zadanie. Pola task-only są opcjonalne na bazie — kod sprawdza
 * `type === "task"` w runtime; single-interface (zamiast unii dyskryminowanej)
 * upraszcza dostęp w checkJs bez ciągłego zawężania.
 */
interface Note {
  id: string;
  type: "note" | "task";
  title: string;
  content: string;
  created: number;
  tags: string[];

  // task-only
  completed?: boolean;
  focus?: boolean;
  important?: boolean;
  due?: number | null;
  time?: string | null;
  reminder?: number;
  recurrence?: string | null;
  recurrenceDays?: number[] | null;
  /** id notatki-następcy zrodzonej z powtarzalnego zadania */
  spawnedNextId?: string;
  /** timestamp ukończenia zadania */
  completedAt?: number | null;
}

/** Notatka w koszu — Note + znacznik czasu usunięcia. */
interface DeletedNote extends Note {
  deletedAt: number;
}
