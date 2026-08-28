use anyhow::Result;
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookRecord {
  pub id: String,
  pub title: String,
  pub author: Option<String>,
  pub genres: Vec<String>,
  pub cover_url: Option<String>,
  pub local_path: String,
  pub file_hash: String,
  pub progress: f32,
  pub last_opened: Option<String>,
  pub created_at: String,
  /// When metadata enrichment last ran for this book, successful or not. Used to
  /// stop the library re-querying the same upstream lookups on every launch.
  #[serde(default)]
  pub metadata_checked_at: Option<String>
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStats {
  pub streak_days: i64,
  pub total_days: i64,
  pub last_read_at: Option<String>,
  pub days_last_7: i64
}

pub struct Database {
  conn: Connection,
  path: PathBuf
}

impl Database {
  pub fn new() -> Result<Self> {
    let path = db_path()?;
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(&path)?;
    let db = Self { conn, path };
    db.init_schema()?;
    Ok(db)
  }

  pub fn path(&self) -> &Path {
    &self.path
  }

  fn init_schema(&self) -> Result<()> {
    apply_schema(&self.conn)
  }

  fn row_to_book(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookRecord> {
    let genres_json: Option<String> = row.get(3)?;
    let genres = genres_json
      .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
      .unwrap_or_default();
    Ok(BookRecord {
      id: row.get(0)?,
      title: row.get(1)?,
      author: row.get(2)?,
      genres,
      cover_url: row.get(4)?,
      local_path: row.get(5)?,
      file_hash: row.get(6)?,
      progress: row.get(7)?,
      last_opened: row.get(8)?,
      created_at: row.get(9)?,
      metadata_checked_at: row.get(10)?
    })
  }

  pub fn list_books(&self) -> Result<Vec<BookRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at FROM books"
    )?;
    let rows = stmt.query_map([], Self::row_to_book)?;

    let mut books = Vec::new();
    for row in rows {
      books.push(row?);
    }
    Ok(books)
  }

  pub fn find_by_id(&self, id: &str) -> Result<Option<BookRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at FROM books WHERE id = ?1"
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(Self::row_to_book(row)?));
    }
    Ok(None)
  }

  pub fn find_by_hash(&self, hash: &str) -> Result<Option<BookRecord>> {
    let mut stmt = self.conn.prepare(
      "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at FROM books WHERE file_hash = ?1"
    )?;
    let mut rows = stmt.query(params![hash])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(Self::row_to_book(row)?));
    }
    Ok(None)
  }

  pub fn upsert_book(&self, book: &BookRecord) -> Result<()> {
    let genres_json = serde_json::to_string(&book.genres).ok();
    self.conn.execute(
      "INSERT INTO books (id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        genres = excluded.genres,
        cover_url = excluded.cover_url,
        local_path = excluded.local_path,
        file_hash = excluded.file_hash,
        progress = excluded.progress,
        last_opened = excluded.last_opened,
        created_at = excluded.created_at",
      params![
        book.id,
        book.title,
        book.author,
        genres_json,
        book.cover_url,
        book.local_path,
        book.file_hash,
        book.progress,
        book.last_opened,
        book.created_at
      ]
    )?;
    Ok(())
  }

  pub fn update_metadata(&self, book: &BookRecord) -> Result<()> {
    let genres_json = serde_json::to_string(&book.genres).ok();
    self.conn.execute(
      "UPDATE books SET title = ?1, author = ?2, genres = ?3, cover_url = ?4, metadata_checked_at = ?5 WHERE id = ?6",
      params![
        book.title,
        book.author,
        genres_json,
        book.cover_url,
        book.metadata_checked_at,
        book.id
      ]
    )?;
    Ok(())
  }

  pub fn update_cover(&self, book_id: &str, cover_url: Option<String>) -> Result<()> {
    self.conn.execute(
      "UPDATE books SET cover_url = ?1 WHERE id = ?2",
      params![cover_url, book_id]
    )?;
    Ok(())
  }

  pub fn update_progress(&self, book_id: &str, progress: f32, last_opened: Option<String>) -> Result<()> {
    self.conn.execute(
      "UPDATE books SET progress = ?1, last_opened = ?2 WHERE id = ?3",
      params![progress, last_opened, book_id]
    )?;
    if let Some(opened_at) = last_opened {
      self.log_reading_session(book_id, &opened_at)?;
    }
    Ok(())
  }

  pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
    self.conn.execute(
      "INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      params![key, value]
    )?;
    Ok(())
  }

  pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
    let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
      return Ok(Some(row.get(0)?));
    }
    Ok(None)
  }

  pub fn log_reading_session(&self, book_id: &str, opened_at: &str) -> Result<()> {
    let date_key = DateTime::parse_from_rfc3339(opened_at)
      .map(|dt| dt.date_naive().to_string())
      .unwrap_or_else(|_| Utc::now().date_naive().to_string());
    self.conn.execute(
      "INSERT INTO reading_sessions (book_id, opened_at, date_key)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(book_id, date_key) DO UPDATE SET opened_at = excluded.opened_at",
      params![book_id, opened_at, date_key]
    )?;
    Ok(())
  }

  pub fn reading_stats(&self) -> Result<ReadingStats> {
    let mut stmt = self.conn.prepare(
      "SELECT date_key FROM reading_sessions GROUP BY date_key ORDER BY date_key DESC"
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut dates: Vec<NaiveDate> = Vec::new();
    for row in rows {
      if let Ok(date) = NaiveDate::parse_from_str(&row?, "%Y-%m-%d") {
        dates.push(date);
      }
    }

    let today = Utc::now().date_naive();
    let mut streak_days = 0;
    if let Some(first) = dates.first() {
      if *first == today {
        streak_days = 1;
        let mut expected = today.pred_opt().unwrap_or(today);
        for date in dates.iter().skip(1) {
          if *date == expected {
            streak_days += 1;
            expected = expected.pred_opt().unwrap_or(*date);
          } else {
            break;
          }
        }
      }
    }

    let cutoff = today - chrono::Duration::days(6);
    let days_last_7 = dates.iter().filter(|date| **date >= cutoff).count() as i64;

    let last_read_at: Option<String> = self
      .conn
      .query_row("SELECT MAX(opened_at) FROM reading_sessions", [], |row| row.get(0))
      .unwrap_or(None);

    Ok(ReadingStats {
      streak_days,
      total_days: dates.len() as i64,
      last_read_at,
      days_last_7
    })
  }

  pub fn clear_all(&self) -> Result<()> {
    self.conn.execute_batch(
      "DELETE FROM book_collections;
       DELETE FROM collections;
       DELETE FROM books;
       DELETE FROM settings;
       DELETE FROM reading_sessions;"
    )?;
    Ok(())
  }
}

fn apply_schema(conn: &Connection) -> Result<()> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        genres TEXT,
        cover_url TEXT,
        local_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        progress REAL DEFAULT 0,
        last_opened TEXT,
        created_at TEXT NOT NULL,
        metadata_checked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS book_collections (
        book_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        PRIMARY KEY (book_id, collection_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        date_key TEXT NOT NULL,
        UNIQUE(book_id, date_key)
      );
      CREATE INDEX IF NOT EXISTS reading_sessions_date_idx ON reading_sessions (date_key);
      CREATE INDEX IF NOT EXISTS books_file_hash_idx ON books (file_hash);"
  )?;
  // Fails harmlessly when the column is already present, which is the point:
  // existing libraries gain it once, new ones already have it.
  let _ = conn.execute("ALTER TABLE books ADD COLUMN metadata_checked_at TEXT", []);
  Ok(())
}

fn db_path() -> Result<PathBuf> {
  let base = dirs::data_dir().ok_or_else(|| anyhow::anyhow!("missing app data dir"))?;
  Ok(base.join("leaflet").join("library.db"))
}

pub fn now_iso() -> String {
  DateTime::<Utc>::from(Utc::now()).to_rfc3339()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn column_names(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
      .prepare(&format!("PRAGMA table_info({table})"))
      .expect("pragma");
    let names = stmt
      .query_map([], |row| row.get::<_, String>(1))
      .expect("query")
      .map(|value| value.expect("column name"))
      .collect();
    names
  }

  /// The shape of `books` as shipped before metadata_checked_at existed.
  fn legacy_schema(conn: &Connection) {
    conn
      .execute_batch(
        "CREATE TABLE books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author TEXT,
          genres TEXT,
          cover_url TEXT,
          local_path TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          progress REAL DEFAULT 0,
          last_opened TEXT,
          created_at TEXT NOT NULL
        );"
      )
      .expect("legacy schema");
  }

  #[test]
  fn migrates_an_existing_library_without_losing_rows() {
    let conn = Connection::open_in_memory().expect("open");
    legacy_schema(&conn);
    conn
      .execute(
        "INSERT INTO books (id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at)
         VALUES ('h1', 'Old Book', 'Someone', '[]', NULL, '/books/h1.epub', 'h1', 0.5, NULL, '2026-01-01T00:00:00Z')",
        []
      )
      .expect("seed row");

    apply_schema(&conn).expect("migrate");

    assert!(column_names(&conn, "books").contains(&"metadata_checked_at".to_string()));

    let mut stmt = conn
      .prepare(
        "SELECT id, title, author, genres, cover_url, local_path, file_hash, progress, last_opened, created_at, metadata_checked_at FROM books"
      )
      .expect("prepare");
    let books: Vec<BookRecord> = stmt
      .query_map([], Database::row_to_book)
      .expect("query")
      .map(|row| row.expect("row"))
      .collect();

    assert_eq!(books.len(), 1, "the existing row must survive the migration");
    assert_eq!(books[0].title, "Old Book");
    assert_eq!(books[0].progress, 0.5);
    assert_eq!(
      books[0].metadata_checked_at, None,
      "migrated books start unchecked so enrichment runs once"
    );
  }

  #[test]
  fn applying_the_schema_twice_is_a_no_op() {
    let conn = Connection::open_in_memory().expect("open");
    apply_schema(&conn).expect("first");
    apply_schema(&conn).expect("second");

    let columns = column_names(&conn, "books");
    assert_eq!(
      columns.iter().filter(|name| *name == "metadata_checked_at").count(),
      1
    );
  }

  #[test]
  fn a_fresh_database_already_has_the_column() {
    let conn = Connection::open_in_memory().expect("open");
    apply_schema(&conn).expect("schema");
    assert!(column_names(&conn, "books").contains(&"metadata_checked_at".to_string()));
  }

  /// Drive manifests written before this field existed must still deserialize.
  #[test]
  fn legacy_sync_payloads_deserialize() {
    let json = r#"{
      "id": "h1",
      "title": "Old Book",
      "author": null,
      "genres": [],
      "coverUrl": null,
      "localPath": "/books/h1.epub",
      "fileHash": "h1",
      "progress": 0.25,
      "lastOpened": null,
      "createdAt": "2026-01-01T00:00:00Z"
    }"#;
    let book: BookRecord = serde_json::from_str(json).expect("legacy payload");
    assert_eq!(book.metadata_checked_at, None);
  }
}
