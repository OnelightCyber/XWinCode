use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

use crate::builder::valid_udid;
use crate::device::{self, TunnelError};
use crate::trust;

include!(concat!(env!("OUT_DIR"), "/preview_files.rs"));

const PORT: u16 = 7878;
const WIFI_PORT: u16 = 7879;
const MAX_FRAME: usize = 16 * 1024 * 1024;
const BUNDLE_ID: &str = "dev.xwincode.preview";
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const VIDEO_PREFIX: &str = "{\"type\":\"video\"";
const MAX_VIDEO: u64 = 1024 * 1024 * 1024;
const MAX_PARTS: u64 = 4096;

struct Link {
    session: u64,
    writer: OwnedWriteHalf,
    out: Option<Cipher>,
    _stop: oneshot::Sender<()>,
}

struct Cipher {
    aead: ChaCha20Poly1305,
    counter: u64,
}

impl Cipher {
    fn new(key: &[u8; 32]) -> Self {
        Self { aead: ChaCha20Poly1305::new(Key::from_slice(key)), counter: 0 }
    }

    fn nonce(counter: u64) -> [u8; 12] {
        let mut n = [0u8; 12];
        n[4..].copy_from_slice(&counter.to_be_bytes());
        n
    }

    fn seal(&mut self, plain: &[u8]) -> Option<Vec<u8>> {
        let nonce = Self::nonce(self.counter);
        let body = self.aead.encrypt(Nonce::from_slice(&nonce), plain).ok()?;
        self.counter += 1;
        let mut out = Vec::with_capacity(12 + body.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&body);
        Some(out)
    }

    fn open(&mut self, data: &[u8]) -> Option<Vec<u8>> {
        if data.len() < 28 || data[..12] != Self::nonce(self.counter) {
            return None;
        }
        let plain = self.aead.decrypt(Nonce::from_slice(&data[..12]), &data[12..]).ok()?;
        self.counter += 1;
        Some(plain)
    }
}

fn mac(key: &[u8], label: &str, a: &[u8], b: &[u8]) -> Hmac<Sha256> {
    let mut m = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    m.update(label.as_bytes());
    m.update(a);
    m.update(b);
    m
}

fn session_ciphers(key: &[u8; 32], phone: &[u8], desktop: &[u8]) -> (Cipher, Cipher) {
    let salt = [phone, desktop].concat();
    let hk = Hkdf::<Sha256>::new(Some(&salt), key);
    let mut out = [0u8; 32];
    let mut inbound = [0u8; 32];
    hk.expand(b"xwc desktop to phone", &mut out).expect("32 bytes is a valid HKDF length");
    hk.expand(b"xwc phone to desktop", &mut inbound).expect("32 bytes is a valid HKDF length");
    (Cipher::new(&out), Cipher::new(&inbound))
}

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).expect("the OS random generator is available");
    bytes
}

#[cfg(windows)]
mod sealed {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    const ENTROPY: &[u8] = b"xwincode preview pairing";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    fn run(data: &[u8], protect: bool) -> Option<Vec<u8>> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        unsafe {
            let ok = if protect {
                CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            };
            if ok == 0 || out.pbData.is_null() {
                return None;
            }
            let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(out.pbData.cast());
            Some(bytes)
        }
    }

    pub fn seal(data: &[u8]) -> Option<Vec<u8>> {
        run(data, true)
    }

    pub fn open(data: &[u8]) -> Option<Vec<u8>> {
        run(data, false)
    }
}

#[cfg(not(windows))]
mod sealed {
    pub fn seal(data: &[u8]) -> Option<Vec<u8>> {
        Some(data.to_vec())
    }

    pub fn open(data: &[u8]) -> Option<Vec<u8>> {
        Some(data.to_vec())
    }
}

#[derive(Serialize, Deserialize, Default)]
struct PairingStore {
    desktop: String,
    devices: HashMap<String, String>,
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("preview-pairing.json"))
}

fn pairing(app: &AppHandle, udid: &str, create: bool) -> Option<(String, [u8; 32])> {
    let path = store_path(app)?;
    let mut store: PairingStore = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let mut dirty = false;
    if store.desktop.len() != 32 {
        store.desktop = random::<16>().iter().map(|b| format!("{b:02x}")).collect();
        dirty = true;
    }
    let existing = store.devices.get(udid).and_then(|k| B64.decode(k).ok()).and_then(|k| sealed::open(&k)).filter(|k| k.len() == 32);
    let key = match existing {
        Some(k) => k,
        None if create => {
            let k = random::<32>().to_vec();
            store.devices.insert(udid.to_string(), B64.encode(sealed::seal(&k)?));
            dirty = true;
            k
        }
        None => return None,
    };
    if dirty {
        let _ = std::fs::create_dir_all(path.parent()?);
        std::fs::write(&path, serde_json::to_string(&store).ok()?).ok()?;
    }
    Some((store.desktop, key.try_into().ok()?))
}

fn computer_name() -> String {
    std::env::var("COMPUTERNAME").ok().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "PC".into())
}

async fn write_plain(writer: &mut OwnedWriteHalf, message: &str) -> std::io::Result<()> {
    let mut frame = Vec::with_capacity(4 + message.len());
    frame.extend_from_slice(&(message.len() as u32).to_be_bytes());
    frame.extend_from_slice(message.as_bytes());
    writer.write_all(&frame).await
}

async fn read_json(reader: &mut OwnedReadHalf) -> Option<serde_json::Value> {
    let text = timeout(HELLO_TIMEOUT, read_frame(reader)).await.ok()?.ok()??;
    serde_json::from_str(&text).ok()
}

async fn handshake(reader: &mut OwnedReadHalf, writer: &mut OwnedWriteHalf, id: &str, key: &[u8; 32]) -> Option<(Cipher, Cipher)> {
    let challenge = read_json(reader).await?;
    if challenge.get("type")?.as_str()? != "challenge" {
        return None;
    }
    let phone = B64.decode(challenge.get("nonce")?.as_str()?).ok().filter(|n| n.len() == 32)?;
    let desktop = random::<32>();
    let code = mac(key, "xwc-auth1", &phone, &desktop).finalize().into_bytes();
    let auth = serde_json::json!({ "type": "auth", "id": id, "nonce": B64.encode(desktop), "mac": B64.encode(code) });
    timeout(WRITE_TIMEOUT, write_plain(writer, &auth.to_string())).await.ok()?.ok()?;
    let welcome = read_json(reader).await?;
    if welcome.get("type")?.as_str()? != "welcome" {
        return None;
    }
    let proof = B64.decode(welcome.get("mac")?.as_str()?).ok()?;
    mac(key, "xwc-auth2", &desktop, &phone).verify_slice(&proof).ok()?;
    Some(session_ciphers(key, &phone, &desktop))
}

#[derive(Default)]
pub struct PreviewState {
    link: Mutex<Option<Link>>,
    next: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    root: String,
    bundle_id: String,
}

#[derive(Serialize)]
pub struct Connected {
    session: u64,
    hello: String,
}

#[derive(Clone, Serialize)]
struct MessageEvent {
    session: u64,
    message: String,
}

#[derive(Clone, Serialize)]
struct ClosedEvent {
    session: u64,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct VideoEvent {
    session: u64,
    part: u64,
    parts: u64,
    path: Option<String>,
    error: Option<String>,
}

struct VideoSink {
    file: tokio::fs::File,
    partial: PathBuf,
    target: PathBuf,
    next: u64,
    parts: u64,
    written: u64,
}

fn count(v: &serde_json::Value, key: &str) -> Option<u64> {
    let n = v.get(key)?;
    n.as_u64().or_else(|| n.as_f64().filter(|f| f.fract() == 0.0 && *f >= 0.0).map(|f| f as u64))
}

async fn drop_sink(sink: &mut Option<VideoSink>) {
    if let Some(old) = sink.take() {
        drop(old.file);
        let _ = tokio::fs::remove_file(&old.partial).await;
    }
}

async fn append_video(videos: &(dyn Fn() -> Result<PathBuf, String> + Sync), name: &str, sink: &mut Option<VideoSink>, message: &str) -> Result<(u64, u64, Option<PathBuf>), String> {
    let v: serde_json::Value = serde_json::from_str(message).map_err(|e| e.to_string())?;
    let (Some(part), Some(parts)) = (count(&v, "part"), count(&v, "parts")) else {
        return Err(t!("err.failed"));
    };
    let data = v.get("data").and_then(|d| d.as_str()).and_then(|d| B64.decode(d).ok()).ok_or_else(|| t!("err.failed"))?;
    if parts == 0 || parts > MAX_PARTS || part >= parts {
        return Err(t!("err.failed"));
    }
    if part == 0 {
        drop_sink(sink).await;
        let dir = videos()?;
        tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let target = crate::capture::unique(&dir, name, "mp4");
        let partial = target.with_extension("mp4.part");
        let file = tokio::fs::File::create(&partial).await.map_err(|e| e.to_string())?;
        *sink = Some(VideoSink { file, partial, target, next: 0, parts, written: 0 });
    }
    let Some(current) = sink.as_mut() else {
        return Err(t!("err.failed"));
    };
    if current.next != part || current.parts != parts || current.written + data.len() as u64 > MAX_VIDEO {
        drop_sink(sink).await;
        return Err(t!("err.failed"));
    }
    current.file.write_all(&data).await.map_err(|e| e.to_string())?;
    current.written += data.len() as u64;
    current.next += 1;
    if current.next < parts {
        return Ok((part, parts, None));
    }
    let Some(done) = sink.take() else {
        return Err(t!("err.failed"));
    };
    let VideoSink { mut file, partial, target, .. } = done;
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&partial, &target).await.map_err(|e| e.to_string())?;
    Ok((part, parts, Some(target)))
}

fn xtool_yml() -> String {
    format!("version: 1\nbundleID: {BUNDLE_ID}\ninfoPath: Info.plist\nskipLSP: true\n")
}

fn write_if_changed(path: &Path, text: &str) -> Result<(), String> {
    if std::fs::read_to_string(path).is_ok_and(|old| old == text) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn prune(dir: &Path, base: &Path, keep: &HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            prune(&path, base, keep);
        } else if let Ok(rel) = path.strip_prefix(base) {
            if !keep.contains(&rel.to_string_lossy().replace('\\', "/")) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

fn materialize(dir: &Path) -> Result<(), String> {
    for (rel, text) in PREVIEW_FILES {
        write_if_changed(&dir.join(rel), text)?;
    }
    write_if_changed(&dir.join("xtool.yml"), &xtool_yml())?;
    let keep: HashSet<String> = PREVIEW_FILES.iter().map(|(rel, _)| rel.to_string()).collect();
    prune(&dir.join("Sources"), dir, &keep);
    Ok(())
}

async fn read_raw(reader: &mut OwnedReadHalf) -> std::io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME + 64 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    Ok(Some(body))
}

fn utf8(body: Vec<u8>) -> std::io::Result<String> {
    String::from_utf8(body).map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid UTF-8"))
}

async fn read_frame(reader: &mut OwnedReadHalf) -> std::io::Result<Option<String>> {
    match read_raw(reader).await? {
        Some(body) => utf8(body).map(Some),
        None => Ok(None),
    }
}

async fn read_secure(reader: &mut OwnedReadHalf, cipher: &mut Option<Cipher>) -> std::io::Result<Option<String>> {
    let Some(body) = read_raw(reader).await? else {
        return Ok(None);
    };
    let plain = match cipher {
        Some(c) => c.open(&body).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "rejected frame"))?,
        None => body,
    };
    utf8(plain).map(Some)
}

fn is_hello(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok_and(|v| v.get("type").and_then(|t| t.as_str()) == Some("hello"))
}

async fn pump(app: AppHandle, mut reader: OwnedReadHalf, session: u64, mut inbound: Option<Cipher>, mut stop: oneshot::Receiver<()>, name: String) {
    let mut sink: Option<VideoSink> = None;
    let videos_app = app.clone();
    let videos = move || videos_app.path().video_dir().map(|d| d.join("XWinCode")).map_err(|e| e.to_string());
    loop {
        tokio::select! {
            frame = read_secure(&mut reader, &mut inbound) => match frame {
                Ok(Some(message)) if message.starts_with(VIDEO_PREFIX) => {
                    let event = match append_video(&videos, &name, &mut sink, &message).await {
                        Ok((part, parts, path)) => VideoEvent { session, part, parts, path: path.map(|p| p.to_string_lossy().into_owned()), error: None },
                        Err(error) => {
                            drop_sink(&mut sink).await;
                            VideoEvent { session, error: Some(error), ..Default::default() }
                        }
                    };
                    let _ = app.emit("preview://video", event);
                }
                Ok(Some(message)) => {
                    let _ = app.emit("preview://message", MessageEvent { session, message });
                }
                _ => break,
            },
            _ = &mut stop => break,
        }
    }
    drop_sink(&mut sink).await;
    let state = app.state::<PreviewState>();
    let mut link = state.link.lock().await;
    if link.as_ref().is_some_and(|l| l.session == session) {
        link.take();
    }
    drop(link);
    let _ = app.emit("preview://closed", ClosedEvent { session });
}

pub async fn shutdown(app: &AppHandle) {
    let link = app.state::<PreviewState>().link.lock().await.take();
    if let Some(mut link) = link {
        let _ = timeout(Duration::from_millis(300), link.writer.shutdown()).await;
    }
}

#[tauri::command(async)]
pub fn preview_prepare(app: AppHandle) -> Result<Prepared, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("XWinCodePreview");
    materialize(&dir)?;
    let root = dir.to_string_lossy().to_string();
    trust::trust(&app, &root)?;
    Ok(Prepared { root, bundle_id: BUNDLE_ID.into() })
}

#[tauri::command]
pub async fn preview_connect(app: AppHandle, state: State<'_, PreviewState>, udid: String) -> Result<Connected, String> {
    if !valid_udid(&udid) {
        return Err(t!("err.invalidDevice"));
    }
    state.link.lock().await.take();
    let (stream, network) = device::tunnel(&udid, PORT, WIFI_PORT).await.map_err(|e| match e {
        TunnelError::Gone => "gone".to_string(),
        TunnelError::Refused => "closed".to_string(),
        TunnelError::Other(msg) => msg,
    })?;
    let _ = stream.set_nodelay(true);
    let (mut reader, mut writer) = stream.into_split();
    let (out, mut inbound) = if network {
        let (id, key) = pairing(&app, &udid, false).ok_or_else(|| "pairFirst".to_string())?;
        let (out, inbound) = handshake(&mut reader, &mut writer, &id, &key).await.ok_or_else(|| "pairFirst".to_string())?;
        (Some(out), Some(inbound))
    } else {
        (None, None)
    };
    let hello = match timeout(HELLO_TIMEOUT, read_secure(&mut reader, &mut inbound)).await {
        Ok(Ok(Some(text))) if is_hello(&text) => text,
        _ => return Err("noAnswer".into()),
    };
    if !network {
        if let Some((id, key)) = pairing(&app, &udid, true) {
            let pair = serde_json::json!({ "type": "pair", "id": id, "key": B64.encode(key), "name": computer_name() });
            let _ = timeout(WRITE_TIMEOUT, write_plain(&mut writer, &pair.to_string())).await;
        }
    }
    let session = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (stop_tx, stop_rx) = oneshot::channel();
    *state.link.lock().await = Some(Link { session, writer, out, _stop: stop_tx });
    let name = serde_json::from_str::<serde_json::Value>(&hello).ok().and_then(|v| v.get("name")?.as_str().map(str::to_string)).unwrap_or_else(|| "iPhone".into());
    tauri::async_runtime::spawn(pump(app, reader, session, inbound, stop_rx, name));
    Ok(Connected { session, hello })
}

#[tauri::command]
pub async fn preview_send(state: State<'_, PreviewState>, message: String) -> Result<(), String> {
    if message.len() > MAX_FRAME {
        return Err("tooBig".into());
    }
    let mut guard = state.link.lock().await;
    let Some(link) = guard.as_mut() else {
        return Err("offline".into());
    };
    let body = match link.out.as_mut() {
        Some(cipher) => cipher.seal(message.as_bytes()).ok_or_else(|| "offline".to_string())?,
        None => message.into_bytes(),
    };
    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
    frame.extend_from_slice(&body);
    match timeout(WRITE_TIMEOUT, link.writer.write_all(&frame)).await {
        Ok(Ok(())) => Ok(()),
        _ => {
            guard.take();
            Err("offline".into())
        }
    }
}

#[tauri::command]
pub async fn preview_disconnect(state: State<'_, PreviewState>) -> Result<(), String> {
    let link = state.link.lock().await.take();
    if let Some(mut link) = link {
        let _ = timeout(Duration::from_secs(1), link.writer.shutdown()).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(part: u64, parts: u64, data: &[u8]) -> String {
        format!("{{\"type\":\"video\",\"part\":{part},\"parts\":{parts},\"data\":\"{}\"}}", B64.encode(data))
    }

    #[tokio::test]
    async fn assembles_videos_in_order_and_rejects_the_rest() {
        let dir = std::env::temp_dir().join(format!("xwc-video-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.clone();
        let videos = move || Ok(root.clone());
        let mut sink = None;
        assert!(chunk(0, 1, b"").starts_with(VIDEO_PREFIX));
        assert_eq!(append_video(&videos, "iPhone", &mut sink, &chunk(0, 3, b"ab")).await.unwrap(), (0, 3, None));
        assert_eq!(append_video(&videos, "iPhone", &mut sink, &chunk(1, 3, b"cd")).await.unwrap(), (1, 3, None));
        let (_, _, path) = append_video(&videos, "iPhone", &mut sink, &chunk(2, 3, b"ef")).await.unwrap();
        let path = path.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"abcdef");
        assert_eq!(path.extension().unwrap(), "mp4");
        assert!(sink.is_none());

        assert!(append_video(&videos, "iPhone", &mut sink, &chunk(0, 3, b"ab")).await.is_ok());
        assert!(append_video(&videos, "iPhone", &mut sink, &chunk(2, 3, b"ef")).await.is_err());
        drop_sink(&mut sink).await;
        assert!(append_video(&videos, "iPhone", &mut sink, &chunk(1, 3, b"cd")).await.is_err());
        assert!(append_video(&videos, "iPhone", &mut sink, &chunk(0, MAX_PARTS + 1, b"x")).await.is_err());
        assert!(append_video(&videos, "iPhone", &mut sink, r#"{"type":"video","part":0,"parts":1,"data":"%%%"}"#).await.is_err());
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left.len(), 1, "{left:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pairing_keys_are_sealed_at_rest() {
        let key = [9u8; 32];
        let blob = sealed::seal(&key).unwrap();
        assert_eq!(sealed::open(&blob).unwrap(), key);
        #[cfg(windows)]
        {
            assert!(!blob.windows(key.len()).any(|w| w == key));
            let mut bad = blob.clone();
            let last = bad.len() - 1;
            bad[last] ^= 1;
            assert!(sealed::open(&bad).is_none());
        }
    }

    #[test]
    fn embeds_the_companion_app() {
        let names: Vec<&str> = PREVIEW_FILES.iter().map(|(rel, _)| *rel).collect();
        assert!(names.contains(&"Package.swift"));
        assert!(names.contains(&"Info.plist"));
        assert!(names.iter().any(|n| n.starts_with("Sources/XWinCodePreview/") && n.ends_with(".swift")));
        assert!(!names.iter().any(|n| n.starts_with('.') || n.contains("/.") || *n == "xtool.yml"));
    }

    #[test]
    fn materializes_and_prunes() {
        let dir = std::env::temp_dir().join(format!("xwc-preview-test-{}", std::process::id()));
        let stale = dir.join("Sources").join("XWinCodePreview").join("Old.swift");
        std::fs::create_dir_all(stale.parent().unwrap()).unwrap();
        std::fs::write(&stale, "old").unwrap();
        materialize(&dir).unwrap();
        assert!(!stale.exists());
        assert!(dir.join("Package.swift").is_file());
        assert!(std::fs::read_to_string(dir.join("xtool.yml")).unwrap().contains("bundleID: dev.xwincode.preview"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    async fn pair() -> (tokio::net::TcpStream, OwnedReadHalf, OwnedWriteHalf) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = tokio::net::TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();
        let (reader, writer) = server.into_split();
        (client, reader, writer)
    }

    #[tokio::test]
    async fn reads_frames_until_eof() {
        let (mut client, mut reader, _writer) = pair().await;
        for text in [r#"{"type":"hello"}"#, "é"] {
            client.write_all(&(text.len() as u32).to_be_bytes()).await.unwrap();
            client.write_all(text.as_bytes()).await.unwrap();
        }
        drop(client);
        assert_eq!(read_frame(&mut reader).await.unwrap().as_deref(), Some(r#"{"type":"hello"}"#));
        assert_eq!(read_frame(&mut reader).await.unwrap().as_deref(), Some("é"));
        assert_eq!(read_frame(&mut reader).await.unwrap(), None);
    }

    #[tokio::test]
    async fn rejects_oversized_and_invalid_frames() {
        let (mut client, mut reader, _writer) = pair().await;
        client.write_all(&((MAX_FRAME + 1024) as u32).to_be_bytes()).await.unwrap();
        assert!(read_frame(&mut reader).await.is_err());
        let (mut client, mut reader, _writer) = pair().await;
        client.write_all(&2u32.to_be_bytes()).await.unwrap();
        client.write_all(&[0xff, 0xfe]).await.unwrap();
        assert!(read_frame(&mut reader).await.is_err());
    }

    #[test]
    fn ciphers_round_trip_and_reject_replays() {
        let key = [7u8; 32];
        let (mut out, _) = session_ciphers(&key, &[1u8; 32], &[2u8; 32]);
        let mut phone_in = {
            let salt = [[1u8; 32].as_slice(), [2u8; 32].as_slice()].concat();
            let hk = Hkdf::<Sha256>::new(Some(&salt), &key);
            let mut k = [0u8; 32];
            hk.expand(b"xwc desktop to phone", &mut k).unwrap();
            Cipher::new(&k)
        };
        let first = out.seal(b"hello").unwrap();
        let second = out.seal(b"world").unwrap();
        assert_eq!(phone_in.open(&first).unwrap(), b"hello");
        assert!(phone_in.open(&first).is_none());
        assert_eq!(phone_in.open(&second).unwrap(), b"world");
        let mut tampered = out.seal(b"x").unwrap();
        tampered[20] ^= 1;
        assert!(phone_in.open(&tampered).is_none());
    }

    #[test]
    fn wire_vectors() {
        let key = [7u8; 32];
        let code = mac(&key, "xwc-auth1", &[1u8; 32], &[2u8; 32]).finalize().into_bytes();
        let (mut out, mut inbound) = session_ciphers(&key, &[1u8; 32], &[2u8; 32]);
        let sealed = out.seal(b"hello").unwrap();
        let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        println!("VEC mac {}", hex(&code));
        println!("VEC d2p {}", hex(&sealed));
        let mut phone_out = {
            let salt = [[1u8; 32].as_slice(), [2u8; 32].as_slice()].concat();
            let hk = Hkdf::<Sha256>::new(Some(&salt), &key);
            let mut k = [0u8; 32];
            hk.expand(b"xwc phone to desktop", &mut k).unwrap();
            Cipher::new(&k)
        };
        let reply = phone_out.seal(b"world").unwrap();
        assert_eq!(inbound.open(&reply).unwrap(), b"world");
        println!("VEC p2d {}", hex(&reply));
    }

    #[test]
    fn macs_bind_label_and_order() {
        let key = [9u8; 32];
        let a = mac(&key, "xwc-auth1", b"aa", b"bb").finalize().into_bytes();
        assert!(mac(&key, "xwc-auth1", b"aa", b"bb").verify_slice(&a).is_ok());
        assert!(mac(&key, "xwc-auth2", b"aa", b"bb").verify_slice(&a).is_err());
        assert!(mac(&[8u8; 32], "xwc-auth1", b"aa", b"bb").verify_slice(&a).is_err());
    }

    #[test]
    fn recognises_hello() {
        assert!(is_hello(r#"{"type":"hello","version":1}"#));
        assert!(!is_hello(r#"{"type":"stats"}"#));
        assert!(!is_hello("HTTP/1.1 400"));
    }
}
