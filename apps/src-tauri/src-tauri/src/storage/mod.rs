use anyhow::Result;
use quick_xml::events::Event;
use quick_xml::Reader;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

pub struct BasicMetadata {
  pub title: Option<String>,
  pub author: Option<String>
}

pub fn app_data_dir() -> Result<PathBuf> {
  let base = dirs::data_dir().ok_or_else(|| anyhow::anyhow!("missing app data dir"))?;
  Ok(base.join("dudereader"))
}

pub fn books_dir() -> Result<PathBuf> {
  Ok(app_data_dir()?.join("books"))
}

pub fn covers_dir() -> Result<PathBuf> {
  Ok(app_data_dir()?.join("covers"))
}

pub fn hash_file(path: &Path) -> Result<String> {
  let mut file = fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 8192];
  loop {
    let n = file.read(&mut buffer)?;
    if n == 0 {
      break;
    }
    hasher.update(&buffer[..n]);
  }
  Ok(hex::encode(hasher.finalize()))
}

pub fn store_book_file(source: &Path, hash: &str) -> Result<PathBuf> {
  let ext = source.extension().and_then(|v| v.to_str()).unwrap_or("bin");
  let dir = books_dir()?;
  fs::create_dir_all(&dir)?;
  let dest = dir.join(format!("{}.{}", hash, ext));
  if !dest.exists() {
    fs::copy(source, &dest)?;
  }
  Ok(dest)
}

pub async fn store_cover(url: &str, hash: &str) -> Result<PathBuf> {
  let dir = covers_dir()?;
  fs::create_dir_all(&dir)?;
  let dest = dir.join(format!("{}-cover.jpg", hash));
  if dest.exists() {
    return Ok(dest);
  }
  let bytes = reqwest::get(url).await?.bytes().await?;
  fs::write(&dest, bytes)?;
  Ok(dest)
}

pub fn extract_basic_metadata(path: &Path) -> Result<BasicMetadata> {
  let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("").to_lowercase();
  if ext == "epub" {
    if let Ok(metadata) = extract_epub_metadata(path) {
      return Ok(metadata);
    }
  }
  Ok(BasicMetadata {
    title: None,
    author: None
  })
}

fn extract_epub_metadata(path: &Path) -> Result<BasicMetadata> {
  let file = fs::File::open(path)?;
  let mut archive = ZipArchive::new(file)?;
  let mut opf_index = None;
  for i in 0..archive.len() {
    let file = archive.by_index(i)?;
    let name = file.name().to_lowercase();
    if name.ends_with("content.opf") || name.ends_with("package.opf") {
      opf_index = Some(i);
      break;
    }
  }
  let index = opf_index.ok_or_else(|| anyhow::anyhow!("missing opf"))?;
  let mut opf_file = archive.by_index(index)?;
  let mut contents = String::new();
  opf_file.read_to_string(&mut contents)?;

  let mut reader = Reader::from_str(&contents);
  reader.trim_text(true);
  let mut buf = Vec::new();
  let mut title: Option<String> = None;
  let mut author: Option<String> = None;
  let mut capture = None;

  loop {
    match reader.read_event_into(&mut buf) {
      Ok(Event::Start(e)) => {
        let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
        if name.ends_with("title") {
          capture = Some("title".to_string());
        } else if name.ends_with("creator") {
          capture = Some("creator".to_string());
        }
      }
      Ok(Event::Text(e)) => {
        if let Some(kind) = capture.as_deref() {
          let value = e.unescape()?.to_string();
          if kind == "title" && title.is_none() {
            title = Some(value.clone());
          }
          if kind == "creator" && author.is_none() {
            author = Some(value);
          }
        }
      }
      Ok(Event::End(_)) => {
        capture = None;
      }
      Ok(Event::Eof) => break,
      Err(_) => break,
      _ => {}
    }
    buf.clear();
  }

  Ok(BasicMetadata { title, author })
}
