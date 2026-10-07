use std::time::Duration;

use plist::{Dictionary, Value};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::bridge::USBMUXD_WINDOWS;

const LOCKDOWN_PORT: u16 = 62078;
const IO_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub udid: String,
    pub name: String,
    pub product_type: Option<String>,
    pub os_version: Option<String>,
    pub device_class: Option<String>,
    pub connection: String,
}

fn client_dict(message_type: &str) -> Dictionary {
    let mut d = Dictionary::new();
    d.insert("MessageType".into(), message_type.into());
    d.insert("ClientVersionString".into(), "xwincode-0.1".into());
    d.insert("ProgName".into(), "XWinCode".into());
    d.insert("kLibUSBMuxVersion".into(), Value::Integer(3.into()));
    d
}

fn to_xml(dict: Dictionary) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    Value::Dictionary(dict).to_writer_xml(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn from_plist(bytes: &[u8]) -> Result<Dictionary, String> {
    Value::from_reader(std::io::Cursor::new(bytes))
        .map_err(|e| e.to_string())?
        .into_dictionary()
        .ok_or_else(|| "Unexpected plist reply".to_string())
}

async fn io<T>(fut: impl std::future::Future<Output = std::io::Result<T>>) -> Result<T, String> {
    timeout(IO_TIMEOUT, fut).await.map_err(|_| t!("err.timeout"))?.map_err(|e| e.to_string())
}

async fn mux_connect() -> Result<TcpStream, String> {
    io(TcpStream::connect(USBMUXD_WINDOWS))
        .await
        .map_err(|_| t!("err.amdsUnreachable"))
}

async fn mux_send(stream: &mut TcpStream, tag: u32, dict: Dictionary) -> Result<(), String> {
    let payload = to_xml(dict)?;
    let mut msg = Vec::with_capacity(16 + payload.len());
    msg.extend_from_slice(&(16 + payload.len() as u32).to_le_bytes());
    msg.extend_from_slice(&1u32.to_le_bytes());
    msg.extend_from_slice(&8u32.to_le_bytes());
    msg.extend_from_slice(&tag.to_le_bytes());
    msg.extend_from_slice(&payload);
    io(stream.write_all(&msg)).await
}

async fn mux_recv(stream: &mut TcpStream) -> Result<Dictionary, String> {
    let mut header = [0u8; 16];
    io(stream.read_exact(&mut header)).await?;
    let len = u32::from_le_bytes(header[0..4].try_into().unwrap()) as usize;
    if !(16..=4 * 1024 * 1024).contains(&len) {
        return Err("Invalid usbmuxd frame".into());
    }
    let mut body = vec![0u8; len - 16];
    io(stream.read_exact(&mut body)).await?;
    from_plist(&body)
}

struct Attached {
    device_id: u64,
    udid: String,
    connection: String,
}

async fn list_attached() -> Result<Vec<Attached>, String> {
    let mut s = mux_connect().await?;
    mux_send(&mut s, 1, client_dict("ListDevices")).await?;
    let reply = mux_recv(&mut s).await?;
    let list = reply.get("DeviceList").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut out: Vec<Attached> = Vec::new();
    for item in list {
        let Some(props) = item.as_dictionary().and_then(|d| d.get("Properties")).and_then(Value::as_dictionary) else {
            continue;
        };
        let device_id = props.get("DeviceID").and_then(Value::as_unsigned_integer).unwrap_or(0);
        let udid = props.get("SerialNumber").and_then(Value::as_string).unwrap_or_default().to_string();
        let connection = props.get("ConnectionType").and_then(Value::as_string).unwrap_or("USB").to_string();
        if udid.is_empty() {
            continue;
        }
        if let Some(existing) = out.iter_mut().find(|a| a.udid == udid) {
            if connection == "USB" {
                existing.device_id = device_id;
                existing.connection = connection;
            }
            continue;
        }
        out.push(Attached { device_id, udid, connection });
    }
    Ok(out)
}

async fn mux_tunnel(device_id: u64, port: u16) -> Result<TcpStream, String> {
    let mut s = mux_connect().await?;
    let mut d = client_dict("Connect");
    d.insert("DeviceID".into(), Value::Integer(device_id.into()));
    d.insert("PortNumber".into(), Value::Integer((port.swap_bytes() as u64).into()));
    mux_send(&mut s, 2, d).await?;
    let reply = mux_recv(&mut s).await?;
    match reply.get("Number").and_then(Value::as_unsigned_integer) {
        Some(0) => Ok(s),
        Some(n) => Err(format!("usbmuxd Connect failed (code {n})")),
        None => Err("Unexpected usbmuxd reply".into()),
    }
}

async fn lockdown_request(s: &mut TcpStream, dict: Dictionary) -> Result<Dictionary, String> {
    let payload = to_xml(dict)?;
    io(s.write_all(&(payload.len() as u32).to_be_bytes())).await?;
    io(s.write_all(&payload)).await?;
    let mut len = [0u8; 4];
    io(s.read_exact(&mut len)).await?;
    let len = u32::from_be_bytes(len) as usize;
    if len > 4 * 1024 * 1024 {
        return Err("Invalid lockdown frame".into());
    }
    let mut body = vec![0u8; len];
    io(s.read_exact(&mut body)).await?;
    from_plist(&body)
}

async fn device_values(device_id: u64) -> Result<Dictionary, String> {
    let mut s = mux_tunnel(device_id, LOCKDOWN_PORT).await?;
    let mut req = Dictionary::new();
    req.insert("Label".into(), "XWinCode".into());
    req.insert("Request".into(), "GetValue".into());
    let reply = lockdown_request(&mut s, req).await?;
    if let Some(values) = reply.get("Value").and_then(Value::as_dictionary) {
        return Ok(values.clone());
    }
    let mut values = Dictionary::new();
    for key in ["DeviceName", "ProductType", "ProductVersion", "DeviceClass"] {
        let mut req = Dictionary::new();
        req.insert("Label".into(), "XWinCode".into());
        req.insert("Request".into(), "GetValue".into());
        req.insert("Key".into(), key.into());
        if let Ok(r) = lockdown_request(&mut s, req).await {
            if let Some(v) = r.get("Value") {
                values.insert(key.into(), v.clone());
            }
        }
    }
    Ok(values)
}

pub async fn list() -> Result<Vec<Device>, String> {
    let attached = list_attached().await?;
    let mut devices = Vec::with_capacity(attached.len());
    for a in attached {
        let values = device_values(a.device_id).await.unwrap_or_default();
        let get = |k: &str| values.get(k).and_then(Value::as_string).map(String::from);
        devices.push(Device {
            name: get("DeviceName").unwrap_or_else(|| t!("device.defaultName")),
            product_type: get("ProductType"),
            os_version: get("ProductVersion"),
            device_class: get("DeviceClass"),
            udid: a.udid,
            connection: a.connection,
        });
    }
    Ok(devices)
}

#[tauri::command]
pub async fn list_devices() -> Result<Vec<Device>, String> {
    list().await
}
